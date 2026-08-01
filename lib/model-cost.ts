export type ModelCost = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

type ModelCostInput = {
  input?: unknown;
  output?: unknown;
  cacheRead?: unknown;
  cacheWrite?: unknown;
};

/** Convert persisted or form values to the numeric shape expected by Pi. */
function parseModelCostNumber(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === "string" && value.trim() === "") return 0;
  const number = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(number) ? number : 0;
}

/** Cost must always include all four numeric fields; missing values become 0. */
export function normalizeModelCost(cost?: ModelCostInput | null): ModelCost {
  return {
    input: parseModelCostNumber(cost?.input),
    output: parseModelCostNumber(cost?.output),
    cacheRead: parseModelCostNumber(cost?.cacheRead),
    cacheWrite: parseModelCostNumber(cost?.cacheWrite),
  };
}
