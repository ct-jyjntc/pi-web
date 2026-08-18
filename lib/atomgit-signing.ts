/**
 * AtomGit LLM gateway request signing (AtomCode v1).
 *
 * Verified against the official atomcode 5.0.6 build (local binary + lldb):
 * the master key below is UNCHANGED from 1.0.0 — it is materialized at runtime
 * into __DATA (not statically visible in the open-source tree or binary image),
 * so static `strings`/entropy scans miss it. Only the client version bumps to
 * track the official binary (env!("CARGO_PKG_VERSION")).
 */
import { createHash, createHmac, randomBytes } from "node:crypto";

/** Client version stamped into X-AtomCode-Ver / User-Agent (atomcode/<ver>); tracks the official atomcode binary. */
export const ATOMGIT_CLIENT_VERSION = "5.0.6";

/**
 * 32-byte master key for public v1 signing.
 * Documented by the MIT community bridge — not inventable from OAuth alone.
 */
const ATOMGIT_SIGNING_MASTER_KEY = Buffer.from(
  "e97250f05303162c8ecd68c688b2f55c1d81e508d243d88466472e7f54637123",
  "hex",
);

export type AtomGitSignInput = {
  method: string;
  /** URL path only (e.g. /v1/chat/completions), no query. */
  path: string;
  body: Buffer;
  oauthToken: string;
  userId: string;
  clientVersion?: string;
  timestampUnix?: number;
  /** Exactly 16 bytes; generated when omitted. */
  nonce?: Buffer;
};

/**
 * Derive the per-request signing key (HKDF-SHA256 extract + one expand block).
 * salt = userId || 0x01 || le64(timestamp/3600) || sha256(token) || sha256(version)
 * PRK  = HMAC(salt, masterKey)
 * OKM  = HMAC(PRK, "atomcode-signing-v1" || 0x01)
 */
export function deriveAtomGitSigningKey(
  oauthToken: string,
  userId: string,
  clientVersion: string,
  timestampUnix: number,
): Buffer {
  const tokenHash = createHash("sha256").update(oauthToken).digest();
  const versionHash = createHash("sha256").update(clientVersion).digest();
  const timeBucket = Buffer.alloc(8);
  timeBucket.writeBigUInt64LE(BigInt(Math.floor(timestampUnix / 3600)));
  const salt = Buffer.concat([
    Buffer.from(userId, "utf8"),
    Buffer.from([1]),
    timeBucket,
    tokenHash,
    versionHash,
  ]);
  const prk = createHmac("sha256", salt).update(ATOMGIT_SIGNING_MASTER_KEY).digest();
  return createHmac("sha256", prk)
    .update(Buffer.concat([Buffer.from("atomcode-signing-v1"), Buffer.from([1])]))
    .digest();
}

/** Build AtomCode v1 signature headers for one gateway request. */
export function signAtomGitRequest(input: AtomGitSignInput): Record<string, string> {
  const clientVersion = input.clientVersion ?? ATOMGIT_CLIENT_VERSION;
  const timestampUnix = input.timestampUnix ?? Math.floor(Date.now() / 1000);
  const nonce = input.nonce ?? randomBytes(16);
  if (nonce.length !== 16) {
    throw new Error("AtomGit signing nonce must be 16 bytes");
  }
  if (!input.oauthToken || !input.userId) {
    throw new Error("AtomGit signing requires an OAuth token and user id");
  }

  const bodyHash = createHash("sha256").update(input.body).digest("hex");
  const nonceHex = nonce.toString("hex");
  const canonical = [
    "v1",
    input.method.toUpperCase(),
    input.path,
    String(timestampUnix),
    nonceHex,
    bodyHash,
  ].join("\n");
  const signingKey = deriveAtomGitSigningKey(
    input.oauthToken,
    input.userId,
    clientVersion,
    timestampUnix,
  );
  const signature = createHmac("sha256", signingKey).update(canonical).digest("hex");
  return {
    "X-AtomCode-Sig": `v1:${signature}`,
    "X-AtomCode-Ts": String(timestampUnix),
    "X-AtomCode-Nonce": nonceHex,
    "X-AtomCode-Alg": "1",
    "X-AtomCode-Ver": clientVersion,
  };
}
