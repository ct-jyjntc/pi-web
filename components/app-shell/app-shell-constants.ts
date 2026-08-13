/**
 * Layout and refresh timing constants for AppShell.
 */
export const SESSION_REFRESH_DEBOUNCE_MS = 1500;
export const EXPLORER_REFRESH_DEBOUNCE_MS = 300;

export const RIGHT_PANEL_WIDTH_KEY = "pi-right-panel-width";
export const RIGHT_PANEL_MIN = 280;
export const RIGHT_PANEL_MAX = 900;
export const RIGHT_PANEL_DEFAULT = 380;

export const SIDEBAR_WIDTH_KEY = "pi-sidebar-width";
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 480;
/** Soft cap vs the viewport so a wide sidebar cannot swallow the chat column. */
export const SIDEBAR_MAX_VIEWPORT_FRACTION = 0.45;
