import { buildApiKeyProviderList } from "@/lib/provider-listing";
import { collectProviderListingInputs } from "@/lib/provider-listing-runtime";
import { createConfiguredModelRuntime } from "@/lib/model-runtime";

export const dynamic = "force-dynamic";

// Providers that accept an API key, including dual-auth ones such as anthropic —
// see lib/provider-listing.ts for why membership is capability-based (#309).
export async function GET() {
  const modelRuntime = await createConfiguredModelRuntime();
  const providers = buildApiKeyProviderList(await collectProviderListingInputs(modelRuntime));
  return Response.json({ providers });
}
