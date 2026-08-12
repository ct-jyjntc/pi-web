import { getGithubAccountPublic } from "@/lib/accounts-store";
import { runGh } from "@/lib/github";
import os from "os";

export const dynamic = "force-dynamic";

/**
 * Effective GitHub CLI login (best-effort): with a connected account the app
 * injects GH_TOKEN into gh runs, so this reports the account gh features will
 * use; without one it reports the user's own `gh auth login`.
 */
async function ghCliLogin(): Promise<string | null> {
  try {
    const r = await runGh(["auth", "status", "--active"], os.homedir(), { timeoutMs: 5_000 });
    if (r.code !== 0) return null;
    const match = /account\s+(\S+)/.exec(r.stdout);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function GET() {
  const github = getGithubAccountPublic();
  const effectiveGhLogin = github.connected ? github.login : await ghCliLogin();
  return Response.json({
    accounts: {
      github: { ...github, ghCliLogin: effectiveGhLogin },
    },
  });
}
