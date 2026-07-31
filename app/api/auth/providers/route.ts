import { buildOAuthProviderList } from "@/lib/provider-listing";
import { collectProviderListingInputs } from "@/lib/provider-listing-runtime";
import { createConfiguredModelRuntime } from "@/lib/model-runtime";

export const dynamic = "force-dynamic";

// Providers that declare an OAuth login method, including anthropic
// (Claude Pro/Max) — see lib/provider-listing.ts (#309).
export async function GET() {
  const modelRuntime = await createConfiguredModelRuntime();
  const providers = buildOAuthProviderList(await collectProviderListingInputs(modelRuntime));
  return Response.json({ providers });
}
