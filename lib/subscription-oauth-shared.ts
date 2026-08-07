/**
 * Shared helpers for first-party subscription OAuth + field-level meta policy.
 * Server-only.
 *
 * Field policy (per model):
 * 1. Vendor /models returned a field → **locked** (not soft).
 * 2. Otherwise placeholder → **soft (user-editable)**.
 *
 * No remote catalog (models.dev / rainflowtb) and no product-facing cost/billing.
 * `Model.cost` stays zeroed for SDK shape only.
 */
import type { Api, Model } from "@earendil-works/pi-ai";

export type SoftMetaField =
  | "reasoning"
  | "thinkingLevelMap"
  | "contextWindow"
  | "maxTokens"
  | "input"
  | "name";

const ALL_SOFT_FIELDS: SoftMetaField[] = [
  "reasoning",
  "thinkingLevelMap",
  "contextWindow",
  "maxTokens",
  "input",
  "name",
];

/** provider/modelId → set of fields still soft (editable). Absent map entry = all locked. */
const softFieldsByModel = new Map<string, Set<SoftMetaField>>();

function softKey(provider: string, modelId: string): string {
  return `${provider}/${modelId}`;
}

/** Start a synthetic model: every catalog field is soft until vendor locks it. */
export function beginSoftModel(provider: string, modelId: string): void {
  softFieldsByModel.set(softKey(provider, modelId), new Set(ALL_SOFT_FIELDS));
}

export function lockSoftField(provider: string, modelId: string, field: SoftMetaField): void {
  const set = softFieldsByModel.get(softKey(provider, modelId));
  if (!set) return; // already fully official
  set.delete(field);
  if (set.size === 0) softFieldsByModel.delete(softKey(provider, modelId));
}

export function lockSoftFields(
  provider: string,
  modelId: string,
  fields: readonly SoftMetaField[],
): void {
  for (const f of fields) lockSoftField(provider, modelId, f);
}

/** True when this field may be user-edited. No map entry ⇒ fully official (locked). */
export function isSoftField(provider: string, modelId: string, field: SoftMetaField): boolean {
  const set = softFieldsByModel.get(softKey(provider, modelId));
  if (!set) return false;
  return set.has(field);
}

/** @deprecated use isSoftField — true if any field is still soft */
export function isSoftCatalogMeta(provider: string, modelId: string): boolean {
  const set = softFieldsByModel.get(softKey(provider, modelId));
  return Boolean(set && set.size > 0);
}

export function markSoftCatalogMeta(provider: string, modelId: string): void {
  beginSoftModel(provider, modelId);
}

export function clearSoftCatalogMeta(provider: string, modelId: string): void {
  softFieldsByModel.delete(softKey(provider, modelId));
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Login cancelled"));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("Login cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function formBody(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

export async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const j = await res.json();
    return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function asNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Soft placeholder OpenAI model (all fields editable until locked). */
export function openAIModel(
  provider: string,
  baseUrl: string,
  id: string,
  name?: string,
  extras?: Partial<Model<"openai-completions">>,
): Model<"openai-completions"> {
  beginSoftModel(provider, id);
  return {
    id,
    name: name || id,
    api: "openai-completions",
    provider,
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
    ...extras,
  };
}

export function anthropicModel(
  provider: string,
  baseUrl: string,
  id: string,
  name?: string,
): Model<"anthropic-messages"> {
  beginSoftModel(provider, id);
  return {
    id,
    name: name || id,
    api: "anthropic-messages",
    provider,
    baseUrl,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 16_384,
  };
}

export type OpenAIModelsRawRow = {
  id: string;
  name?: string;
  raw: Record<string, unknown>;
};

export async function fetchOpenAIModelsRaw(
  baseUrl: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<OpenAIModelsRawRow[]> {
  const url = `${baseUrl.replace(/\/+$/, "")}/models`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
    signal,
  });
  if (!res.ok) throw new Error(`models HTTP ${res.status}`);
  const json = await res.json();
  const data = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  const rows: OpenAIModelsRawRow[] = [];
  for (const entry of data) {
    if (typeof entry === "string" && entry) {
      rows.push({ id: entry, raw: { id: entry } });
      continue;
    }
    if (entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string") {
      const rec = entry as Record<string, unknown>;
      rows.push({
        id: String(rec.id),
        name: typeof rec.name === "string" ? rec.name : undefined,
        raw: rec,
      });
    }
  }
  return rows;
}

export async function fetchOpenAIModelIds(
  baseUrl: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<string[]> {
  return (await fetchOpenAIModelsRaw(baseUrl, accessToken, signal)).map((r) => r.id);
}

/**
 * Build models from OpenRouter/Nous-style rich /models rows.
 * Locks only fields actually present in the vendor payload.
 */
export function openAIModelsFromRichCatalog(
  provider: string,
  baseUrl: string,
  rows: readonly OpenAIModelsRawRow[],
): Model<"openai-completions">[] {
  return rows.map((row) => {
    const raw = row.raw;
    const architecture =
      raw.architecture && typeof raw.architecture === "object"
        ? (raw.architecture as Record<string, unknown>)
        : undefined;
    const topProvider =
      raw.top_provider && typeof raw.top_provider === "object"
        ? (raw.top_provider as Record<string, unknown>)
        : undefined;
    const supported = Array.isArray(raw.supported_parameters)
      ? (raw.supported_parameters as unknown[]).map(String)
      : [];
    const reasoningObj =
      raw.reasoning && typeof raw.reasoning === "object"
        ? (raw.reasoning as Record<string, unknown>)
        : undefined;

    const extras: Partial<Model<"openai-completions">> = {};
    const locked: SoftMetaField[] = [];

    if (row.name || typeof raw.name === "string") {
      extras.name = row.name || String(raw.name);
      locked.push("name");
    }

    const hasReasoningField =
      reasoningObj != null
      || typeof raw.reasoning === "boolean"
      || supported.includes("reasoning")
      || supported.includes("reasoning_effort")
      || supported.includes("include_reasoning");
    if (hasReasoningField) {
      extras.reasoning =
        typeof raw.reasoning === "boolean"
          ? raw.reasoning
          : reasoningObj != null || supported.includes("reasoning") || supported.includes("reasoning_effort");
      locked.push("reasoning");
    }

    const ctx =
      typeof raw.context_length === "number" && raw.context_length > 0
        ? raw.context_length
        : typeof topProvider?.context_length === "number" && topProvider.context_length > 0
          ? (topProvider.context_length as number)
          : undefined;
    if (ctx !== undefined) {
      extras.contextWindow = ctx;
      locked.push("contextWindow");
    }

    const maxOut =
      typeof topProvider?.max_completion_tokens === "number" && topProvider.max_completion_tokens > 0
        ? (topProvider.max_completion_tokens as number)
        : typeof raw.max_output_tokens === "number" && raw.max_output_tokens > 0
          ? raw.max_output_tokens
          : undefined;
    if (maxOut !== undefined) {
      extras.maxTokens = maxOut;
      locked.push("maxTokens");
    }

    if (Array.isArray(architecture?.input_modalities)) {
      const mods = (architecture!.input_modalities as unknown[]).map(String);
      extras.input = mods.includes("image") ? ["text", "image"] : ["text"];
      locked.push("input");
    }

    const efforts = Array.isArray(reasoningObj?.supported_efforts)
      ? (reasoningObj!.supported_efforts as unknown[]).map(String)
      : [];
    if (efforts.length) {
      extras.thinkingLevelMap = {
        off: efforts.includes("none") ? "none" : null,
        low: efforts.includes("low") ? "low" : null,
        medium: efforts.includes("medium") ? "medium" : null,
        high: efforts.includes("high") ? "high" : null,
      };
      locked.push("thinkingLevelMap");
    }

    // openAIModel marks all soft, then we lock vendor-returned fields.
    // cost is always zeroed for SDK shape — not product metadata.
    const model = openAIModel(provider, baseUrl, row.id, extras.name || row.name, extras);
    lockSoftFields(provider, row.id, locked);
    return model;
  });
}

/**
 * Codex CLI /models item → Model. Locks fields present on the Codex payload.
 */
export function codexModelsFromApi(
  provider: string,
  baseUrl: string,
  items: readonly Record<string, unknown>[],
  baseline: readonly Model<Api>[],
): Model<Api>[] {
  const byId = new Map(baseline.map((m) => [m.id, m]));
  const out: Model<Api>[] = [];
  for (const item of items) {
    const slug = asString(item.slug) || asString(item.id);
    if (!slug) continue;
    const visibility = asString(item.visibility);
    if (visibility.toLowerCase() === "hidden") continue;

    const template = byId.get(slug) ?? baseline[0];
    const extras: Partial<Model<Api>> = {};
    const locked: SoftMetaField[] = [];

    const display = asString(item.display_name);
    if (display) {
      extras.name = display;
      locked.push("name");
    }

    const ctx =
      asNumber(item.context_window, 0) || asNumber(item.max_context_window, 0) || undefined;
    if (ctx) {
      extras.contextWindow = ctx;
      locked.push("contextWindow");
    }

    const levels = Array.isArray(item.supported_reasoning_levels)
      ? item.supported_reasoning_levels
      : [];
    if (levels.length || item.default_reasoning_level != null) {
      extras.reasoning = true;
      locked.push("reasoning");
      const efforts = levels
        .map((l) => (l && typeof l === "object" ? (l as { effort?: unknown }).effort : l))
        .map((e) => String(e ?? "").toLowerCase())
        .filter(Boolean);
      if (efforts.length) {
        extras.thinkingLevelMap = {
          off: efforts.includes("none") || efforts.includes("minimal") ? "none" : null,
          low: efforts.includes("low") ? "low" : null,
          medium: efforts.includes("medium") ? "medium" : null,
          high: efforts.includes("high") || efforts.includes("xhigh") ? "high" : null,
        };
        locked.push("thinkingLevelMap");
      }
    }

    if (Array.isArray(item.input_modalities)) {
      const mods = item.input_modalities.map(String);
      extras.input = mods.includes("image") ? ["text", "image"] : ["text"];
      locked.push("input");
    }

    if (template) {
      // Static SDK baseline is official; vendor fields override and stay locked.
      // Only fields NOT in locked remain from template (already official).
      beginSoftModel(provider, slug);
      // Unlock nothing from template initially as soft, then lock vendor fields;
      // also lock template fields that we keep as baseline.
      lockSoftFields(provider, slug, ALL_SOFT_FIELDS); // start locked...
      // Wait: beginSoft makes all soft. For template-backed codex we want:
      // - template fields = locked (from SDK static)
      // - vendor overrides = locked
      // - missing = soft
      clearSoftCatalogMeta(provider, slug); // fully official baseline
      // Then if vendor didn't provide something template has, stays locked.
      // If vendor provided, already on model.
      // If neither has thinking map, user can't edit unless we mark soft...
      // For missing on both: mark soft
      const model = {
        ...template,
        id: slug,
        name: extras.name || template.name || slug,
        provider,
        baseUrl: template.baseUrl || baseUrl,
        ...extras,
      } as Model<Api>;
      // Soft only fields neither template nor vendor set usefully
      beginSoftModel(provider, slug);
      if (template.name || extras.name) lockSoftField(provider, slug, "name");
      if (typeof template.reasoning === "boolean" || typeof extras.reasoning === "boolean") {
        lockSoftField(provider, slug, "reasoning");
      }
      if (template.contextWindow || extras.contextWindow) lockSoftField(provider, slug, "contextWindow");
      if (template.maxTokens || extras.maxTokens) lockSoftField(provider, slug, "maxTokens");
      if (template.input || extras.input) lockSoftField(provider, slug, "input");
      if (template.thinkingLevelMap || extras.thinkingLevelMap) {
        lockSoftField(provider, slug, "thinkingLevelMap");
      }
      out.push(model);
    } else {
      const model = openAIModel(
        provider,
        baseUrl,
        slug,
        extras.name,
        extras as Partial<Model<"openai-completions">>,
      );
      lockSoftFields(provider, slug, locked);
      out.push(model);
    }
  }
  return out;
}


