/**
 * Desktop / browser notification owner. UI callers pass body + prefs only.
 */

export type DesktopNotifyPayload = {
  title?: string;
  body: string;
  silent?: boolean;
};

export function notifyDesktop(payload: DesktopNotifyPayload): void {
  if (typeof window === "undefined") return;
  const title = payload.title ?? "Pi Web";
  const desktop = window.piDesktop as
    | { isDesktop?: boolean; notify?: (p: { title: string; body: string; silent?: boolean }) => Promise<unknown> }
    | undefined;
  if (desktop?.isDesktop && typeof desktop.notify === "function") {
    void desktop.notify({ title, body: payload.body, silent: payload.silent });
    return;
  }
  if (typeof Notification === "undefined") return;
  const show = () => {
    try {
      new Notification(title, { body: payload.body, silent: payload.silent });
    } catch {
      // ignore
    }
  };
  if (Notification.permission === "granted") {
    show();
    return;
  }
  if (Notification.permission === "default") {
    void Notification.requestPermission().then((p) => {
      if (p === "granted") show();
    });
  }
}
