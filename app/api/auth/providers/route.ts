import { createConfiguredModelRuntime } from "@/lib/model-runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const modelRuntime = await createConfiguredModelRuntime();
  const credentials = await modelRuntime.listCredentials();
  const loggedInProviders = new Set(
    credentials.filter((credential) => credential.type === "oauth").map((credential) => credential.providerId),
  );
  const providers = modelRuntime.getProviders().filter((provider) => provider.auth.oauth);

  const EXCLUDED = new Set(["anthropic"]);
  // Prefer subscription branding for dual-auth providers when shown here.
  const DISPLAY_NAMES: Record<string, string> = {
    "openai-codex": "ChatGPT Plus/Pro",
    "github-copilot": "GitHub Copilot",
    "kimi-coding": "Kimi For Coding",
  };

  const result = await Promise.all(
    providers
      .filter((p) => !EXCLUDED.has(p.id))
      .map(async (p) => {
        return {
          id: p.id,
          name: DISPLAY_NAMES[p.id] ?? p.name,
          usesCallbackServer: false,
          loggedIn: loggedInProviders.has(p.id),
        };
      })
  );

  return Response.json({ providers: result });
}
