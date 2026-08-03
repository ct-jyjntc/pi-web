/**
 * Resolve effective Lean Mode config from global pi-web.json.
 */
import {
  defaultLeanModeSettings,
  parseLeanModeSettings,
  type LeanModeSettings,
} from "./lean-mode-settings";
import { readWebSettings, type WebSettings } from "./web-settings";

/**
 * Effective lean settings. `global` may be passed in (e.g. already-read
 * settings); otherwise the current pi-web.json is read.
 */
export function resolveLeanMode(global?: WebSettings): LeanModeSettings {
  const raw = global?.leanMode ?? readWebSettings().leanMode ?? null;
  return raw ? parseLeanModeSettings(raw) : defaultLeanModeSettings();
}