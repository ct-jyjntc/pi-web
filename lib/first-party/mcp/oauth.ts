/**
 * File-backed MCP OAuth for HTTP servers. Manual browser flow:
 * auth-start returns a URL; auth-complete accepts the redirect URL or code.
 */
import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import {
  auth,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { getAgentDir } from "../../agent-dir";
import { writePrivateFileAtomicSync } from "../../atomic-file";

const REDIRECT = "http://127.0.0.1:19876/callback";

type StoredAuth = {
  tokens?: OAuthTokens;
  clientInformation?: OAuthClientInformationMixed;
  codeVerifier?: string;
};

function storePath(serverName: string): string {
  const safe = serverName.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return join(getAgentDir(), "mcp-oauth", `${safe}.json`);
}

function readStore(serverName: string): StoredAuth {
  const path = storePath(serverName);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as StoredAuth;
  } catch {
    return {};
  }
}

function writeStore(serverName: string, next: StoredAuth): void {
  const path = storePath(serverName);
  mkdirSync(join(getAgentDir(), "mcp-oauth"), { recursive: true });
  writePrivateFileAtomicSync(path, `${JSON.stringify(next, null, 2)}\n`);
}

export function parseAuthorizationInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("OAuth input is empty. Paste the redirect URL or the code.");
  try {
    const url = trimmed.includes("://")
      ? new URL(trimmed)
      : trimmed.startsWith("?")
        ? new URL(`http://localhost/${trimmed}`)
        : null;
    if (url) {
      const code = url.searchParams.get("code");
      if (!code) throw new Error("Redirect URL has no code query parameter.");
      return code;
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("no code")) throw error;
  }
  if (/^[A-Za-z0-9._~+/-]+=*$/.test(trimmed) && !trimmed.includes(" ")) return trimmed;
  throw new Error("Could not parse an OAuth code. Paste the full redirect URL or the raw code.");
}

export class FileOAuthProvider implements OAuthClientProvider {
  lastAuthorizationUrl: string | undefined;

  constructor(private readonly serverName: string) {}

  get redirectUrl(): string {
    return REDIRECT;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Pi Web",
      redirect_uris: [REDIRECT],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return readStore(this.serverName).clientInformation;
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    writeStore(this.serverName, { ...readStore(this.serverName), clientInformation: info });
  }

  tokens(): OAuthTokens | undefined {
    return readStore(this.serverName).tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    writeStore(this.serverName, { ...readStore(this.serverName), tokens });
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    this.lastAuthorizationUrl = authorizationUrl.toString();
  }

  saveCodeVerifier(codeVerifier: string): void {
    writeStore(this.serverName, { ...readStore(this.serverName), codeVerifier });
  }

  codeVerifier(): string {
    const value = readStore(this.serverName).codeVerifier;
    if (!value) throw new Error(`No PKCE verifier stored for "${this.serverName}". Run auth-start first.`);
    return value;
  }
}

export async function startMcpOAuth(serverName: string, serverUrl: string): Promise<string> {
  const provider = new FileOAuthProvider(serverName);
  const result = await auth(provider, { serverUrl });
  if (result === "AUTHORIZED") {
    return `MCP server "${serverName}" is already authorized.`;
  }
  const url = provider.lastAuthorizationUrl;
  if (!url) throw new Error(`OAuth start for "${serverName}" did not produce an authorization URL.`);
  return [
    `MCP OAuth required for "${serverName}".`,
    "",
    "Open this URL in your browser:",
    "",
    url,
    "",
    "After approving, copy the full redirected localhost URL (the page may fail to load) and finish with:",
    `mcp({ action: "auth-complete", server: "${serverName}", args: { redirectUrl: "PASTE_REDIRECT_URL" } })`,
    "",
    "You can also pass just the code: args: { code: \"PASTE_CODE\" }.",
  ].join("\n");
}

export async function completeMcpOAuth(serverName: string, serverUrl: string, input: string): Promise<string> {
  const provider = new FileOAuthProvider(serverName);
  const code = parseAuthorizationInput(input);
  const result = await auth(provider, { serverUrl, authorizationCode: code });
  if (result !== "AUTHORIZED") {
    throw new Error(`OAuth complete for "${serverName}" did not authorize.`);
  }
  return `MCP server "${serverName}" authorized. Reconnect with mcp({ connect: "${serverName}" }).`;
}
