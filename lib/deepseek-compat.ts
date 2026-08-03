/**
 * DeepSeek thinking-mode compat for OpenAI-completions proxies.
 *
 * Native deepseek.com is auto-detected by pi-ai; AtomGit / TokenRhythm /
 * OpenCode Zen / custom gateways are not. Without these flags, multi-turn
 * tool loops drop `reasoning_content` on assistant turns that had no
 * thinking block and upstream returns 400.
 */
export const DEEPSEEK_COMPAT = {
  thinkingFormat: "deepseek",
  requiresReasoningContentOnAssistantMessages: true,
} as const;

/** Model ids that behave like DeepSeek thinking (need reasoning_content replay). */
export function isDeepSeekModelId(id: string | undefined | null): boolean {
  if (!id) return false;
  return /deepseek/i.test(id);
}

/** Merge DeepSeek compat onto a model entry when id matches; no-op otherwise. */
export function withDeepSeekCompat<T extends { id?: string }>(model: T): T {
  if (!isDeepSeekModelId(model.id)) return model;
  const prev = (model as { compat?: Record<string, unknown> }).compat;
  return {
    ...model,
    compat: {
      ...(prev ?? {}),
      ...DEEPSEEK_COMPAT,
    },
  } as T;
}
