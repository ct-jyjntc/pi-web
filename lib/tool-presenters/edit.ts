/** Edit tool card: always diff. */
import { patchFromToolDetails, type ToolPresenter } from "../tool-presentation";
import { isRecord } from "../type-guards";

/** Same shape as hashline-parse SECTION_RE — whole-line header only, no op parse. */
const HASHLINE_HEADER_RE = /^\[(.+?)#([0-9A-Fa-f]{4})\]\s*$/gm;

function pathsFromHashlineInput(input: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of input.matchAll(HASHLINE_HEADER_RE)) {
    const path = match[1]?.trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

function pathOf(args: Record<string, unknown>): string[] {
  if (typeof args.path === "string" && args.path) return [args.path];
  if (typeof args.input === "string") return pathsFromHashlineInput(args.input);
  return [];
}

function resultPaths(details: unknown): string[] {
  if (!isRecord(details) || !Array.isArray(details.results)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of details.results) {
    if (!isRecord(row) || typeof row.path !== "string" || !row.path) continue;
    if (seen.has(row.path)) continue;
    seen.add(row.path);
    out.push(row.path);
  }
  return out;
}

export const editPresenter: ToolPresenter = {
  presentCall(args) {
    const locations = pathOf(args);
    return { card: "diff", title: locations[0] ?? "edit", locations: locations.length ? locations : undefined };
  },
  presentResult(args, result) {
    const fromArgs = pathOf(args);
    const locations = fromArgs.length ? fromArgs : resultPaths(result.details);
    return {
      card: "diff",
      title: locations[0] ?? "edit",
      locations: locations.length ? locations : undefined,
      patch: patchFromToolDetails(result.details) ?? undefined,
    };
  },
};
