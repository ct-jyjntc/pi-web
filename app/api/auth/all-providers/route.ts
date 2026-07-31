import { createConfiguredModelRuntime } from "@/lib/model-runtime";

export const dynamic = "force-dynamic";

// Providers that use OAuth — handled separately via /api/auth/providers
const OAUTH_PROVIDER_IDS = new Set(["anthropic", "github-copilot", "openai-codex"]);

export async function GET() {
  const modelRuntime = await createConfiguredModelRuntime();
  const all = modelRuntime.getModels();
  const credentials = await modelRuntime.listCredentials();
  const apiKeyCredentialIds = new Set(
    credentials
      .filter((credential) => credential.type === "api_key")
      .map((credential) => credential.providerId),
  );

  // Deduplicate by provider, skip OAuth-only providers and custom providers (source=models_json_key)
  const seen = new Set<string>();
  const result: {
    id: string;
    displayName: string;
    configured: boolean;
    source?: string;
    modelCount: number;
    /** Provider also supports OAuth (shown under Subscriptions). */
    hasOAuth?: boolean;
  }[] = [];

  for (const provider of modelRuntime.getProviders()) {
    if (seen.has(provider.id)) continue;
    seen.add(provider.id);
    if (OAUTH_PROVIDER_IDS.has(provider.id) || !provider.auth.apiKey?.login) continue;
    const status = modelRuntime.getProviderAuthStatus(provider.id);
    // Skip providers whose key comes from models.json (those are custom providers)
    if (status.source === "models_json_key") continue;

    const hasOAuth = !!provider.auth.oauth;
    // Dual-auth providers (kimi-coding, openrouter, xai, …): OAuth login must not
    // make the API Key row look "configured", or the sidebar shows the same
    // provider twice (Subscriptions + API Key).
    const configured = hasOAuth
      ? apiKeyCredentialIds.has(provider.id)
        || status.source === "environment"
        || status.source === "runtime"
      : status.configured;

    const modelCount = all.filter((model) => model.provider === provider.id).length;
    result.push({
      id: provider.id,
      displayName: provider.name,
      configured,
      source: status.source,
      modelCount,
      hasOAuth: hasOAuth || undefined,
    });
  }

  return Response.json({ providers: result });
}
