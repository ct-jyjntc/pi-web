/**
 * Read/write ~/.pi/agent/auth.json with a process-safe lock.
 *
 * Intentionally avoids a static bare `import "proper-lockfile"` so packaged
 * ESM trees cannot fail native import() with "Cannot find package" when the
 * package graph is incomplete or Node's package lookup starts from a rewritten
 * path. Resolve via createRequire from this file (or fall back to a simple
 * exclusive lock) so logout/login never hard-crash the heavy runtime.
 */
import { chmodSync, existsSync, mkdirSync, openSync, closeSync, unlinkSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Credential } from "@earendil-works/pi-ai";
import { getAgentDir } from "./agent-dir";
import type { ProviderCredentialType } from "./provider-listing";

const AUTH_FILE_WRITE_OPTIONS = { encoding: "utf-8" as const, mode: 0o600 };

export type CredentialRemovalResult =
  | { status: "removed" }
  | { status: "not_found" }
  | { status: "type_mismatch"; storedType: string };

type LockRelease = () => Promise<void> | void;

type LockfileModule = {
  lock: (
    path: string,
    options: {
      retries: { retries: number; factor: number; minTimeout: number; maxTimeout: number; randomize: boolean };
      stale: number;
      onCompromised: (error: Error) => void;
    },
  ) => Promise<() => Promise<void>>;
};

function loadLockfile(): LockfileModule | null {
  try {
    // Prefer createRequire from this module so resolution walks
    // standalone/node_modules regardless of process.cwd().
    const require = createRequire(
      typeof import.meta.url === "string" ? import.meta.url : fileURLToPath(import.meta.url),
    );
    return require("proper-lockfile") as LockfileModule;
  } catch {
    return null;
  }
}

async function acquireExclusiveLock(authPath: string): Promise<LockRelease> {
  const lockPath = `${authPath}.lock`;
  const started = Date.now();
  // Simple exclusive create — good enough when proper-lockfile is missing.
  while (true) {
    try {
      const fd = openSync(lockPath, "wx");
      closeSync(fd);
      return () => {
        try {
          unlinkSync(lockPath);
        } catch {
          // ignore
        }
      };
    } catch {
      if (Date.now() - started > 10_000) {
        throw new Error(`Timed out locking ${authPath}`);
      }
      await new Promise((r) => setTimeout(r, 50 + Math.floor(Math.random() * 50)));
    }
  }
}

function ensureAuthFile(authPath: string): void {
  const parent = dirname(authPath);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (!existsSync(authPath)) {
    writeFileSync(authPath, "{}", AUTH_FILE_WRITE_OPTIONS);
    chmodSync(authPath, 0o600);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function updateStoredCredentials<T>(
  authPath: string,
  update: (credentials: Record<string, unknown>) => { result: T; changed: boolean },
): Promise<T> {
  ensureAuthFile(authPath);

  const lockfile = loadLockfile();
  let lockCompromisedError: Error | undefined;
  let release: LockRelease;

  if (lockfile) {
    const unlock = await lockfile.lock(authPath, {
      retries: {
        retries: 10,
        factor: 2,
        minTimeout: 100,
        maxTimeout: 10_000,
        randomize: true,
      },
      stale: 30_000,
      onCompromised: (error) => {
        lockCompromisedError = error;
      },
    });
    release = unlock;
  } else {
    release = await acquireExclusiveLock(authPath);
  }

  const throwIfCompromised = () => {
    if (lockCompromisedError) throw lockCompromisedError;
  };

  try {
    throwIfCompromised();
    const parsed: unknown = JSON.parse(readFileSync(authPath, "utf-8"));
    if (!isRecord(parsed)) throw new Error("Invalid auth.json: expected an object");

    const { result, changed } = update(parsed);
    if (changed) {
      throwIfCompromised();
      writeFileSync(authPath, JSON.stringify(parsed, null, 2), AUTH_FILE_WRITE_OPTIONS);
      chmodSync(authPath, 0o600);
      throwIfCompromised();
    }
    return result;
  } finally {
    try {
      await release();
    } catch {
      // The compromised-lock error above is more useful than an unlock error.
    }
  }
}

/** Store a provider credential without triggering a model-catalog refresh. */
export function storeProviderCredential(
  providerId: string,
  credential: Credential,
  authPath = join(getAgentDir(), "auth.json"),
): Promise<void> {
  return updateStoredCredentials(authPath, (credentials) => {
    credentials[providerId] = credential;
    return { result: undefined, changed: true };
  });
}

/**
 * Removes a provider credential only when its current stored type matches.
 *
 * The comparison and write share a lock so a concurrent login cannot be deleted
 * by a stale UI request.
 */
export async function removeStoredCredentialIfType(
  providerId: string,
  expectedType: ProviderCredentialType,
  authPath = join(getAgentDir(), "auth.json"),
): Promise<CredentialRemovalResult> {
  return updateStoredCredentials<CredentialRemovalResult>(authPath, (credentials) => {
    if (!Object.hasOwn(credentials, providerId)) {
      return { result: { status: "not_found" }, changed: false };
    }

    const credential = credentials[providerId];
    const storedType =
      isRecord(credential) && typeof credential.type === "string" ? credential.type : "unknown";
    if (storedType !== expectedType) {
      return { result: { status: "type_mismatch", storedType }, changed: false };
    }

    delete credentials[providerId];
    return { result: { status: "removed" }, changed: true };
  });
}
