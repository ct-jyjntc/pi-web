/**
 * GitHub device-code OAuth (RFC 8628) for the in-app "connect GitHub account"
 * flow. Light-runtime safe — pure fetch, no SDK import.
 *
 * Polling policy follows the same rules as the Qwen device-code flow:
 *  - `authorization_pending` → keep polling at the server interval
 *  - `slow_down` → raise the interval by 5s (cap 10s)
 *  - 5xx / 504 → transient, keep polling
 *  - `expired_token` / `access_denied` → terminal error
 *  - all URIs come from the server response, never hardcoded
 */
export const GITHUB_OAUTH_SCOPES = "repo workflow read:user";

/** Overridable so users can point at their own GitHub OAuth App. */
export function githubOAuthClientId(): string {
  return process.env.PI_WEB_GITHUB_CLIENT_ID || "178c6fc778ccc68e1d6a";
}

export type GithubDeviceFlowStart = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  intervalSeconds: number;
  expiresInSeconds: number;
};

export type GithubDevicePollResult =
  | { status: "success"; accessToken: string }
  | { status: "pending"; slowDown?: boolean }
  | { status: "error"; message: string };

function githubJsonHeaders(token?: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "pi-web",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function startGithubDeviceFlow(
  clientId: string,
  scope: string,
): Promise<GithubDeviceFlowStart> {
  const res = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "pi-web",
    },
    body: new URLSearchParams({ client_id: clientId, scope }),
  });
  if (!res.ok) {
    throw new Error(`GitHub device flow HTTP ${res.status}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  if (typeof json.device_code !== "string" || typeof json.user_code !== "string") {
    throw new Error("GitHub device flow returned an unexpected response");
  }
  return {
    deviceCode: json.device_code,
    userCode: json.user_code,
    verificationUri: typeof json.verification_uri === "string"
      ? json.verification_uri
      : "https://github.com/login/device",
    intervalSeconds: typeof json.interval === "number" ? json.interval : 5,
    expiresInSeconds: typeof json.expires_in === "number" ? json.expires_in : 900,
  };
}

/** One poll of the device-code grant. Callers own the interval / slow_down. */
export async function pollGithubDeviceFlow(
  clientId: string,
  deviceCode: string,
): Promise<GithubDevicePollResult> {
  let res: Response;
  try {
    res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "pi-web",
      },
      body: new URLSearchParams({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
  } catch {
    return { status: "pending" };
  }
  if (!res.ok) {
    // 5xx / 504 are transient per RFC 8628 guidance; 4xx is terminal.
    if (res.status >= 500 && res.status <= 599) {
      return { status: "pending" };
    }
    return { status: "error", message: `GitHub token HTTP ${res.status}` };
  }
  const json = (await res.json()) as Record<string, unknown>;
  if (typeof json.access_token === "string" && json.access_token) {
    return { status: "success", accessToken: json.access_token };
  }
  const error = typeof json.error === "string" ? json.error : "";
  if (error === "authorization_pending") {
    return { status: "pending" };
  }
  if (error === "slow_down") {
    return { status: "pending", slowDown: true };
  }
  if (error === "expired_token") {
    return { status: "error", message: "The login code expired — please try again" };
  }
  if (error === "access_denied") {
    return { status: "error", message: "Authorization was denied" };
  }
  if (error) {
    return { status: "error", message: `GitHub error: ${error}` };
  }
  return { status: "pending" };
}

export type GithubUser = {
  login: string;
  name: string | null;
  avatarUrl: string | null;
};

export async function fetchGithubUser(accessToken: string): Promise<GithubUser> {
  const res = await fetch("https://api.github.com/user", {
    headers: githubJsonHeaders(accessToken),
  });
  if (!res.ok) {
    throw new Error(`GitHub user HTTP ${res.status}`);
  }
  const json = (await res.json()) as { login?: unknown; name?: unknown; avatar_url?: unknown };
  if (typeof json.login !== "string") {
    throw new Error("GitHub user response missing login");
  }
  return {
    login: json.login,
    name: typeof json.name === "string" ? json.name : null,
    avatarUrl: typeof json.avatar_url === "string" ? json.avatar_url : null,
  };
}

/** Create a repository for the authenticated user. Returns owner/repo. */
export async function createGithubRepo(
  accessToken: string,
  name: string,
  visibility: "private" | "public",
): Promise<{ fullName: string; htmlUrl: string }> {
  const res = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers: { ...githubJsonHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      private: visibility === "private",
      auto_init: false,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    full_name?: unknown;
    html_url?: unknown;
    message?: unknown;
  };
  if (!res.ok) {
    const detail = typeof json.message === "string" ? json.message : `HTTP ${res.status}`;
    if (res.status === 422 && /name already exists/i.test(detail)) {
      throw new Error(`Repository "${name}" already exists on GitHub`);
    }
    throw new Error(`Create repository failed: ${detail}`);
  }
  if (typeof json.full_name !== "string") {
    throw new Error("Create repository response missing full_name");
  }
  return {
    fullName: json.full_name,
    htmlUrl: typeof json.html_url === "string" ? json.html_url : `https://github.com/${json.full_name}`,
  };
}

/** Validate a GitHub repo name the same way GitHub does (safe subset). */
export function validateGithubRepoName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Repository name is required";
  if (trimmed.length > 100) return "Repository name must be at most 100 characters";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(trimmed)) {
    return "Repository name may only contain letters, digits, hyphens, underscores and dots, and must start with a letter or digit";
  }
  if (trimmed.includes("..")) return "Repository name may not contain '..'";
  return null;
}
/** Abortable sleep for the device-code poll loop (abort ⇒ "Login cancelled"). */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Login cancelled"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Login cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
