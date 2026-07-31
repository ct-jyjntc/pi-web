import { createConfiguredModelRuntime } from "@/lib/model-runtime";
import { invalidateModelsCache } from "@/lib/models-cache";
import { invalidateUtilityModelRuntimes } from "@/lib/utility-model";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const modelRuntime = await createConfiguredModelRuntime();
  if (!modelRuntime.getProvider(provider)?.auth.oauth) {
    return Response.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
  }
  await modelRuntime.logout(provider);
  invalidateModelsCache();
  invalidateUtilityModelRuntimes();
  return Response.json({ ok: true });
}
