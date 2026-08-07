/**
 * Client-safe constants for the AtomGit CodingPlan subscription provider.
 * Keeps Node-only provider code (lib/atomgit-provider.ts) out of this file
 * so UI modules can import the ids/URLs freely.
 */
export const ATOMGIT_PROVIDER_ID = "atomgit";
export const ATOMGIT_DISPLAY_NAME = "AtomGit Coding Plan";
/** Brand mark (GitCode favicon); color PNG — ProviderIcon uses image paint, not mask. */
export const ATOMGIT_ICON_URL = "/providers/atomgit.png";
/** Platform broker that owns OAuth login (login/check/token/refresh). */
export const ATOMGIT_PLATFORM_BASE_URL = "https://acs.atomgit.com";
/** CodingPlan REST API (claim / models / status). */
export const ATOMGIT_API_BASE_URL = "https://api.gitcode.com/api/v5";
/** OpenAI-compatible LLM gateway used by CodingPlan model calls. */
export const ATOMGIT_GATEWAY_BASE_URL = "https://llm-api.atomgit.com/v1";
/** Gateway hosts whose requests must carry the HMAC signature headers. */
export const ATOMGIT_GATEWAY_HOSTS = ["llm-api.atomgit.com", "pre-llm-api-cce.atomgit.com", "api-ai.gitcode.com"];
