/**
 * Keyboard shortcut helpers — platform mod key labels and editable-target checks.
 * Single owner for shortcut chrome copy (⌘ vs Ctrl) used in titles/help.
 */

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  return /Mac|iPhone|iPad|iPod/.test(platform) || /Mac OS X/.test(ua);
}

/** Display label for the primary modifier (⌘ on Apple, Ctrl elsewhere). */
export function modKeyLabel(): string {
  return isMacPlatform() ? "⌘" : "Ctrl";
}

export function formatShortcut(...parts: string[]): string {
  return parts.join(isMacPlatform() ? "" : "+");
}

/** True when the event target is a text field / contenteditable. */
export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return Boolean(el.closest?.("input, textarea, select, [contenteditable='true']"));
}

export function hasPrimaryMod(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey;
}
