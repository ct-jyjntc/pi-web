/**
 * Provider listing for the Models panel.
 *
 * Product surface (Pi Web):
 * 1. **Subscription** — OAuth providers (Kimi / xAI / Codex / AtomGit / …)
 * 2. **Free** — managed free providers (separate free-models path)
 * 3. **Custom** — user `models.json` gateways (base URL + key/command)
 *
 * No API-key cloud marketplace (SDK stock OpenAI/Groq/… and first-party
 * tokenrhythm). Dual-auth SDKs appear under **Subscription** only.
 *
 * Auth methods are still read from `provider.auth` (not a frozen id list) so new
 * OAuth builtins show up automatically.
 */

/** Credential kinds pi stores in `auth.json`. */
export type ProviderCredentialType = "api_key" | "oauth";

/** Auth status sources that mean "this key comes from models.json". */
const CUSTOM_PROVIDER_SOURCES = new Set(["models_json_key", "models_json_command"]);

/** Friendlier names for OAuth entries whose provider name is not self-explanatory. */
const OAUTH_DISPLAY_NAMES: Record<string, string> = {
  "openai-codex": "ChatGPT Plus/Pro",
  "github-copilot": "GitHub Copilot",
  "minimax-oauth": "MiniMax (OAuth)",
  nous: "Nous Portal",
  atomgit: "AtomGit Coding Plan",
  rainflowtb: "RAINFLOW TB",
};

export interface ProviderListingInput {
  id: string;
  /** Provider display name (`provider.name`). */
  name: string;
  /** True when the provider declares an API-key login method. */
  hasApiKeyLogin: boolean;
  /** True when the provider declares an OAuth login method. */
  hasOAuth: boolean;
  /** Label of the OAuth method, e.g. "Anthropic (Claude Pro/Max)". */
  oauthName?: string;
  /** Result of `ModelRuntime.getProviderAuthStatus()`. */
  status: { configured: boolean; source?: string };
  /** Type of the credential stored for this provider, when there is one. */
  credentialType?: ProviderCredentialType;
  modelCount: number;
}

export interface ApiKeyProviderListing {
  id: string;
  displayName: string;
  configured: boolean;
  source?: string;
  modelCount: number;
  /** True when the same provider can also be authenticated with OAuth. */
  supportsOAuth: boolean;
}

export interface OAuthProviderListing {
  id: string;
  name: string;
  usesCallbackServer: boolean;
  loggedIn: boolean;
  /** True when the same provider can also be authenticated with an API key. */
  supportsApiKey: boolean;
}

function dedupeById(providers: readonly ProviderListingInput[]): ProviderListingInput[] {
  const seen = new Set<string>();
  const result: ProviderListingInput[] = [];
  for (const provider of providers) {
    if (seen.has(provider.id)) continue;
    seen.add(provider.id);
    result.push(provider);
  }
  return result;
}

/**
 * API-key rows for the Models panel.
 *
 * Product rule: **no API-key cloud marketplace** (including first-party ones like
 * tokenrhythm). Users add gateways as **Custom** (`models.json`). Subscriptions
 * use the OAuth list; free uses the free-providers path.
 */
export function buildApiKeyProviderList(
  _providers: readonly ProviderListingInput[],
): ApiKeyProviderListing[] {
  return [];
}

/** Providers that can be authenticated with OAuth. */
export function buildOAuthProviderList(
  providers: readonly ProviderListingInput[],
): OAuthProviderListing[] {
  const result: OAuthProviderListing[] = [];
  for (const provider of dedupeById(providers)) {
    if (!provider.hasOAuth) continue;
    result.push({
      id: provider.id,
      name: OAUTH_DISPLAY_NAMES[provider.id] ?? provider.oauthName ?? provider.name,
      usesCallbackServer: false,
      loggedIn: provider.credentialType === "oauth",
      supportsApiKey: provider.hasApiKeyLogin,
    });
  }
  return result;
}
