/**
 * Thin GitHub helpers for Pi Web agents — prefer authenticated `gh` CLI.
 * Virtual refs: pr://N, pr://owner/repo/N, pr://N/diff, issue://N, issue://owner/repo/N
 */
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type GithubRef =
  | { kind: "pr"; owner?: string; repo?: string; number: number; part?: "body" | "diff" | "checks" | "files" | "comments" }
  | { kind: "issue"; owner?: string; repo?: string; number: number; part?: "body" | "comments" };

export type GithubRunResult = {
  ok: boolean;
  text: string;
  details?: unknown;
};

const MAX_OUT = 200_000;

function truncate(s: string, max = MAX_OUT): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n\n… truncated (${s.length} chars total)`;
}

export async function runGh(
  args: string[],
  cwd: string,
  options?: { timeoutMs?: number; env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string; code: number }> {
  // A connected Pi Web GitHub account is the effective identity for gh
  // features (pr:// reads, linked PR, repo view) without touching the user's
  // own `gh auth login` in hosts.yml. The store wins while connected so
  // Settings login, publish, and gh features stay on one account.
  const accountEnv = options?.env ?? process.env;
  let env = { ...accountEnv };
  try {
    const { getGithubAccount } = await import("./accounts-store");
    const account = getGithubAccount();
    if (account) env = { ...env, GH_TOKEN: account.token };
  } catch {
    // accounts store unreadable — fall back to the caller's env
  }
  try {
    const { stdout, stderr } = await execFileAsync("gh", args, {
      cwd,
      maxBuffer: 8 * 1024 * 1024,
      timeout: options?.timeoutMs ?? 60_000,
      env,
      encoding: "utf8",
    });
    return { stdout: stdout ?? "", stderr: stderr ?? "", code: 0 };
  } catch (error) {
    const err = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      message?: string;
      killed?: boolean;
    };
    const code = typeof err.code === "number" ? err.code : 1;
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr || err.message || String(error),
      code: err.killed ? 124 : code,
    };
  }
}

export async function ghAvailable(cwd: string): Promise<{ ok: boolean; version?: string; error?: string }> {
  const r = await runGh(["--version"], cwd, { timeoutMs: 8_000 });
  if (r.code !== 0) return { ok: false, error: r.stderr || "gh not found" };
  return { ok: true, version: r.stdout.trim().split("\n")[0] };
}

export async function resolveRepo(cwd: string): Promise<{ owner: string; repo: string; nameWithOwner: string } | null> {
  const r = await runGh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], cwd, { timeoutMs: 15_000 });
  if (r.code !== 0) return null;
  const nameWithOwner = r.stdout.trim();
  const m = nameWithOwner.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]!, nameWithOwner };
}

/**
 * Parse virtual GitHub refs used by read/github tools.
 * Examples:
 *   pr://42
 *   pr://42/diff
 *   pr://owner/repo/42
 *   pr://owner/repo/42/checks
 *   issue://7
 *   issue://owner/repo/7/comments
 */
export function parseGithubRef(raw: string): GithubRef | null {
  const s = raw.trim();
  const m = s.match(/^(pr|issue):\/\/(.+)$/i);
  if (!m) return null;
  const kind = m[1]!.toLowerCase() as "pr" | "issue";
  const rest = m[2]!.replace(/^\/+/, "").replace(/\/+$/, "");
  const parts = rest.split("/").filter(Boolean);
  if (parts.length === 0) return null;

  const asNum = (x: string) => {
    const n = Number(x);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  // N or N/part
  if (parts.length === 1) {
    const n = asNum(parts[0]!);
    if (!n) return null;
    return { kind, number: n };
  }
  if (parts.length === 2 && asNum(parts[0]!)) {
    const n = asNum(parts[0]!)!;
    const part = parts[1]!.toLowerCase();
    if (kind === "pr" && ["body", "diff", "checks", "files", "comments"].includes(part)) {
      return { kind, number: n, part: part as GithubRef extends { kind: "pr" } ? NonNullable<Extract<GithubRef, { kind: "pr" }>["part"]> : never };
    }
    if (kind === "issue" && ["body", "comments"].includes(part)) {
      return { kind, number: n, part: part as "body" | "comments" };
    }
    return null;
  }
  // owner/repo/N[ /part ]
  if (parts.length >= 3) {
    const owner = parts[0]!;
    const repo = parts[1]!;
    const n = asNum(parts[2]!);
    if (!n) return null;
    const part = parts[3]?.toLowerCase();
    if (kind === "pr") {
      if (part && !["body", "diff", "checks", "files", "comments"].includes(part)) return null;
      return {
        kind,
        owner,
        repo,
        number: n,
        part: part as Extract<GithubRef, { kind: "pr" }>["part"],
      };
    }
    if (part && !["body", "comments"].includes(part)) return null;
    return {
      kind,
      owner,
      repo,
      number: n,
      part: part as "body" | "comments" | undefined,
    };
  }
  return null;
}

function repoArgs(ref: { owner?: string; repo?: string }, cwdRepo: string | null): string[] {
  if (ref.owner && ref.repo) return ["-R", `${ref.owner}/${ref.repo}`];
  if (cwdRepo) return ["-R", cwdRepo];
  return [];
}

export async function fetchGithubRef(cwd: string, ref: GithubRef): Promise<GithubRunResult> {
  const avail = await ghAvailable(cwd);
  if (!avail.ok) {
    return {
      ok: false,
      text: `gh CLI unavailable: ${avail.error ?? "not found"}. Install GitHub CLI and run gh auth login.`,
    };
  }
  const cwdRepo = (await resolveRepo(cwd))?.nameWithOwner ?? null;
  const R = repoArgs(ref, cwdRepo);

  if (ref.kind === "pr") {
    const part = ref.part ?? "body";
    if (part === "diff") {
      const r = await runGh(["pr", "diff", String(ref.number), ...R], cwd);
      if (r.code !== 0) return { ok: false, text: truncate(r.stderr || r.stdout || `gh pr diff failed (${r.code})`) };
      return { ok: true, text: truncate(r.stdout), details: { kind: "pr", number: ref.number, part } };
    }
    if (part === "checks") {
      const r = await runGh(["pr", "checks", String(ref.number), ...R], cwd);
      // gh pr checks exits non-zero when checks failed — still return output
      const text = (r.stdout || r.stderr || "").trim() || "(no checks)";
      return { ok: true, text: truncate(text), details: { kind: "pr", number: ref.number, part, exitCode: r.code } };
    }
    if (part === "files") {
      const r = await runGh([
        "pr", "view", String(ref.number), ...R,
        "--json", "files",
        "--jq", ".files[] | [.path, (.additions|tostring), (.deletions|tostring)] | @tsv",
      ], cwd);
      if (r.code !== 0) return { ok: false, text: truncate(r.stderr || r.stdout) };
      return { ok: true, text: truncate(r.stdout || "(no files)"), details: { kind: "pr", number: ref.number, part } };
    }
    if (part === "comments") {
      const r = await runGh([
        "pr", "view", String(ref.number), ...R,
        "--json", "comments,reviews",
        "--jq",
        '(.comments // [])[] | "### \\(.author.login) · \\(.createdAt)\\n\\(.body)\\n"',
      ], cwd);
      if (r.code !== 0) return { ok: false, text: truncate(r.stderr || r.stdout) };
      return { ok: true, text: truncate(r.stdout || "(no comments)"), details: { kind: "pr", number: ref.number, part } };
    }
    // body / default: rich view
    const r = await runGh([
      "pr", "view", String(ref.number), ...R,
      "--json", "number,title,state,author,baseRefName,headRefName,url,body,additions,deletions,changedFiles,labels,mergeable",
    ], cwd);
    if (r.code !== 0) return { ok: false, text: truncate(r.stderr || r.stdout) };
    try {
      const j = JSON.parse(r.stdout) as Record<string, unknown>;
      const labels = Array.isArray(j.labels)
        ? (j.labels as Array<{ name?: string }>).map((l) => l.name).filter(Boolean).join(", ")
        : "";
      const author = (j.author as { login?: string } | undefined)?.login ?? "";
      const text = [
        `# PR #${j.number}: ${j.title}`,
        `state: ${j.state} · author: ${author} · ${j.baseRefName} ← ${j.headRefName}`,
        `+${j.additions}/-${j.deletions} · files: ${j.changedFiles} · mergeable: ${j.mergeable ?? "?"}`,
        labels ? `labels: ${labels}` : null,
        `url: ${j.url}`,
        "",
        String(j.body ?? "").trim() || "(no body)",
        "",
        "Tip: read pr://N/diff · pr://N/checks · pr://N/files · pr://N/comments",
      ].filter((line) => line !== null).join("\n");
      return { ok: true, text: truncate(text), details: j };
    } catch {
      return { ok: true, text: truncate(r.stdout) };
    }
  }

  // issue
  const part = ref.part ?? "body";
  if (part === "comments") {
    const r = await runGh([
      "issue", "view", String(ref.number), ...R,
      "--json", "comments",
      "--jq",
      '(.comments // [])[] | "### \\(.author.login) · \\(.createdAt)\\n\\(.body)\\n"',
    ], cwd);
    if (r.code !== 0) return { ok: false, text: truncate(r.stderr || r.stdout) };
    return { ok: true, text: truncate(r.stdout || "(no comments)"), details: { kind: "issue", number: ref.number, part } };
  }
  const r = await runGh([
    "issue", "view", String(ref.number), ...R,
    "--json", "number,title,state,author,url,body,labels,comments",
  ], cwd);
  if (r.code !== 0) return { ok: false, text: truncate(r.stderr || r.stdout) };
  try {
    const j = JSON.parse(r.stdout) as Record<string, unknown>;
    const labels = Array.isArray(j.labels)
      ? (j.labels as Array<{ name?: string }>).map((l) => l.name).filter(Boolean).join(", ")
      : "";
    const author = (j.author as { login?: string } | undefined)?.login ?? "";
    const commentCount = Array.isArray(j.comments) ? j.comments.length : 0;
    const text = [
      `# Issue #${j.number}: ${j.title}`,
      `state: ${j.state} · author: ${author}${labels ? ` · labels: ${labels}` : ""} · comments: ${commentCount}`,
      `url: ${j.url}`,
      "",
      String(j.body ?? "").trim() || "(no body)",
      "",
      "Tip: read issue://N/comments",
    ].join("\n");
    return { ok: true, text: truncate(text), details: j };
  } catch {
    return { ok: true, text: truncate(r.stdout) };
  }
}

export async function githubAction(
  cwd: string,
  action: string,
  args: Record<string, unknown>,
): Promise<GithubRunResult> {
  const act = action.toLowerCase();
  const avail = await ghAvailable(cwd);
  if (!avail.ok && act !== "status") {
    return { ok: false, text: `gh CLI unavailable: ${avail.error ?? "not found"}` };
  }

  if (act === "status") {
    const repo = await resolveRepo(cwd);
    const lines = [
      `gh: ${avail.ok ? avail.version : `unavailable (${avail.error})`}`,
      repo ? `repo: ${repo.nameWithOwner}` : "repo: (not a GitHub repo / gh cannot resolve)",
      "",
      "Virtual paths for read():",
      "  pr://N  pr://N/diff  pr://N/checks  pr://N/files  pr://N/comments",
      "  issue://N  issue://N/comments",
      "  pr://owner/repo/N …",
    ];
    return { ok: avail.ok, text: lines.join("\n"), details: { gh: avail, repo } };
  }

  if (act === "repo") {
    const r = await runGh(["repo", "view", ...optionalR(args), "--json", "nameWithOwner,description,url,defaultBranchRef,isPrivate,viewerPermission"], cwd);
    if (r.code !== 0) return { ok: false, text: truncate(r.stderr || r.stdout) };
    return { ok: true, text: truncate(prettyJson(r.stdout)), details: safeJson(r.stdout) };
  }

  if (act === "pr" || act === "pr_view") {
    const number = numArg(args.number ?? args.n ?? args.pr);
    if (!number) return { ok: false, text: "github pr requires number" };
    const part = String(args.part ?? "body") as NonNullable<Extract<GithubRef, { kind: "pr" }>["part"]>;
    const ref: GithubRef = {
      kind: "pr",
      number,
      owner: str(args.owner),
      repo: str(args.repo),
      part: ["body", "diff", "checks", "files", "comments"].includes(part) ? part : "body",
    };
    return fetchGithubRef(cwd, ref);
  }

  if (act === "issue" || act === "issue_view") {
    const number = numArg(args.number ?? args.n ?? args.issue);
    if (!number) return { ok: false, text: "github issue requires number" };
    const part = String(args.part ?? "body");
    const ref: GithubRef = {
      kind: "issue",
      number,
      owner: str(args.owner),
      repo: str(args.repo),
      part: part === "comments" ? "comments" : "body",
    };
    return fetchGithubRef(cwd, ref);
  }

  if (act === "diff" || act === "pr_diff") {
    const number = numArg(args.number ?? args.n ?? args.pr);
    if (!number) return { ok: false, text: "github diff requires PR number" };
    return fetchGithubRef(cwd, {
      kind: "pr",
      number,
      owner: str(args.owner),
      repo: str(args.repo),
      part: "diff",
    });
  }

  if (act === "checks") {
    const number = numArg(args.number ?? args.n ?? args.pr);
    if (!number) return { ok: false, text: "github checks requires PR number" };
    return fetchGithubRef(cwd, {
      kind: "pr",
      number,
      owner: str(args.owner),
      repo: str(args.repo),
      part: "checks",
    });
  }

  if (act === "list_prs" || act === "prs") {
    const limit = Math.min(50, Math.max(1, numArg(args.limit) ?? 10));
    const state = String(args.state ?? "open");
    const r = await runGh([
      "pr", "list", ...optionalR(args),
      "--limit", String(limit),
      "--state", state,
      "--json", "number,title,author,headRefName,baseRefName,url,isDraft,updatedAt",
    ], cwd);
    if (r.code !== 0) return { ok: false, text: truncate(r.stderr || r.stdout) };
    try {
      const arr = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
      if (!arr.length) return { ok: true, text: "(no pull requests)", details: arr };
      const lines = arr.map((p) => {
        const author = (p.author as { login?: string } | undefined)?.login ?? "";
        const draft = p.isDraft ? " [draft]" : "";
        return `#${p.number}${draft} ${p.title}\n  ${p.baseRefName} ← ${p.headRefName} · ${author}\n  ${p.url}`;
      });
      return { ok: true, text: truncate(lines.join("\n\n")), details: arr };
    } catch {
      return { ok: true, text: truncate(r.stdout) };
    }
  }

  if (act === "list_issues" || act === "issues") {
    const limit = Math.min(50, Math.max(1, numArg(args.limit) ?? 10));
    const state = String(args.state ?? "open");
    const r = await runGh([
      "issue", "list", ...optionalR(args),
      "--limit", String(limit),
      "--state", state,
      "--json", "number,title,author,url,labels,updatedAt",
    ], cwd);
    if (r.code !== 0) return { ok: false, text: truncate(r.stderr || r.stdout) };
    try {
      const arr = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
      if (!arr.length) return { ok: true, text: "(no issues)", details: arr };
      const lines = arr.map((p) => {
        const author = (p.author as { login?: string } | undefined)?.login ?? "";
        const labels = Array.isArray(p.labels)
          ? (p.labels as Array<{ name?: string }>).map((l) => l.name).filter(Boolean).join(", ")
          : "";
        return `#${p.number} ${p.title}\n  ${author}${labels ? ` · ${labels}` : ""}\n  ${p.url}`;
      });
      return { ok: true, text: truncate(lines.join("\n\n")), details: arr };
    } catch {
      return { ok: true, text: truncate(r.stdout) };
    }
  }

  if (act === "search") {
    const q = String(args.query ?? args.q ?? "").trim();
    if (!q) return { ok: false, text: "github search requires query" };
    const what = String(args.what ?? "issues"); // issues | prs | code
    const limit = Math.min(30, Math.max(1, numArg(args.limit) ?? 10));
    const r = await runGh(["search", what, q, "--limit", String(limit), ...optionalR(args)], cwd);
    if (r.code !== 0) return { ok: false, text: truncate(r.stderr || r.stdout) };
    return { ok: true, text: truncate(r.stdout || "(no results)") };
  }

  if (act === "read" || act === "ref") {
    const refStr = String(args.ref ?? args.path ?? args.url ?? "");
    const parsed = parseGithubRef(refStr);
    if (!parsed) {
      return {
        ok: false,
        text: `Invalid ref '${refStr}'. Use pr://N, pr://N/diff, issue://N, or owner/repo forms.`,
      };
    }
    return fetchGithubRef(cwd, parsed);
  }

  return {
    ok: false,
    text:
      "Unknown github action. Use: status | repo | pr | issue | diff | checks | list_prs | list_issues | search | read\n" +
      "Or read virtual paths: pr://N · issue://N",
  };
}

function optionalR(args: Record<string, unknown>): string[] {
  const owner = str(args.owner);
  const repo = str(args.repo);
  const R = str(args.repoFull) || str(args.repository);
  if (R) return ["-R", R];
  if (owner && repo) return ["-R", `${owner}/${repo}`];
  return [];
}

function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t || undefined;
}

function numArg(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.floor(v);
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}
