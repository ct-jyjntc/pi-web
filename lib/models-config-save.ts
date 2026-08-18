/**
 * Single owner for provider-level saves against /api/models-config/providers.
 * Frontend mutate handlers in components/models-config call this instead of
 * writing apiFetch inline, so endpoint/error handling lives in one place.
 * Optimistic update + rollback stays in the component (it owns setConfig).
 */
import { apiFetch } from "@/lib/api-transport";

/** Upsert one provider entry (full object) into models.json. */
export async function commitProvider(
  name: string,
  entry: Record<string, unknown>,
): Promise<void> {
  const res = await apiFetch(
    `/api/models-config/providers/${encodeURIComponent(name)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    },
  );
  const data = (await res.json()) as { success?: boolean; error?: string };
  if (!res.ok || data.error || data.success !== true) {
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
}

/** Remove one provider from models.json. No-op if absent. */
export async function removeProvider(name: string): Promise<void> {
  const res = await apiFetch(
    `/api/models-config/providers/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );
  const data = (await res.json()) as { success?: boolean; error?: string };
  if (!res.ok || data.error || data.success !== true) {
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
}
