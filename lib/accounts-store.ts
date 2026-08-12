/**
 * Single owner for third-party account connections (~/.pi/agent/accounts.json).
 * Server-only, light-runtime safe (pure fs — no SDK import).
 *
 * Only the "connected" metadata is ever returned to the renderer; tokens stay
 * server-side and are used for GitHub API calls / git pushes.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { writePrivateFileAtomicSync } from "./atomic-file";

export type GithubAccount = {
  token: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  scopes: string[];
  connectedAt: number;
};

export type AccountsFile = {
  version: 1;
  github?: GithubAccount | null;
};

/** Token-free view safe to send to the renderer. */
export type GithubAccountPublic = {
  connected: boolean;
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
};

function accountsFilePath(): string {
  return path.join(os.homedir(), ".pi", "agent", "accounts.json");
}

function emptyAccounts(): AccountsFile {
  return { version: 1 };
}

function readAccounts(): AccountsFile {
  try {
    const raw = fs.readFileSync(accountsFilePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<AccountsFile>;
    if (parsed && typeof parsed === "object") {
      return {
        version: 1,
        github: parsed.github && typeof parsed.github === "object"
          && typeof parsed.github.token === "string" && parsed.github.token.length > 0
          ? (parsed.github as GithubAccount)
          : undefined,
      };
    }
  } catch {
    // missing / unreadable / corrupt → start empty
  }
  return emptyAccounts();
}

/** Atomic write with owner-only permissions (shared 0600 helper). */
function writeAccounts(accounts: AccountsFile): void {
  const file = accountsFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writePrivateFileAtomicSync(file, JSON.stringify(accounts, null, 2));
}

export function getGithubAccount(): GithubAccount | null {
  return readAccounts().github ?? null;
}

export function getGithubAccountPublic(): GithubAccountPublic {
  const account = getGithubAccount();
  return account
    ? { connected: true, login: account.login, name: account.name, avatarUrl: account.avatarUrl }
    : { connected: false, login: null, name: null, avatarUrl: null };
}

export function setGithubAccount(account: GithubAccount): void {
  if (!account.token) throw new Error("GitHub token is required");
  const accounts = readAccounts();
  accounts.github = account;
  writeAccounts(accounts);
}

export function clearGithubAccount(): void {
  const accounts = readAccounts();
  if (accounts.github) {
    accounts.github = null;
    writeAccounts(accounts);
  }
}
