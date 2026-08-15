/**
 * Apply extension UI request events to session UI setters.
 * Keep request method switch in one place; React state lives in the hook.
 */

import type {
  ExtensionStatusItem,
  ExtensionUiRequest,
  ExtensionWidgetItem,
} from "@/lib/types";
import type { NoticeType } from "@/lib/agent-session-notices";
import { setAskUserRequest } from "@/lib/ask-user-store";

type ExtensionUiDialogRequest = Extract<ExtensionUiRequest, { method: "select" | "confirm" | "input" | "editor" }>;
type ExtensionUiCustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;

export type ExtensionUiRequestHandlers = {
  setExtensionDialog: (request: ExtensionUiDialogRequest | null | ((current: ExtensionUiDialogRequest | null) => ExtensionUiDialogRequest | null)) => void;
  setExtensionCustomUi: (request: ExtensionUiCustomRequest | null | ((current: ExtensionUiCustomRequest | null) => ExtensionUiCustomRequest | null)) => void;
  setExtensionStatuses: (updater: (prev: ExtensionStatusItem[]) => ExtensionStatusItem[]) => void;
  setExtensionWidgets: (updater: (prev: ExtensionWidgetItem[]) => ExtensionWidgetItem[]) => void;
  addNotice: (notice: { id?: string; message: string; type?: NoticeType }) => void;
  insertEditorText?: (text: string) => void;
};

export function applyExtensionUiRequest(
  request: ExtensionUiRequest,
  handlers: ExtensionUiRequestHandlers,
): void {
  switch (request.method) {
    case "select":
    case "confirm":
    case "input":
    case "editor":
      handlers.setExtensionDialog(request);
      break;
    case "dismiss":
      handlers.setExtensionDialog((current) => current?.id === request.id ? null : current);
      handlers.setExtensionCustomUi((current) => current?.id === request.id ? null : current);
      setAskUserRequest(null);
      break;
    case "ask_user":
      setAskUserRequest({ id: request.id, questions: request.questions });
      break;
    case "notify": {
      handlers.addNotice({
        id: request.id,
        message: request.message,
        type: request.notifyType ?? "info",
      });
      break;
    }
    case "setStatus":
      handlers.setExtensionStatuses((prev) => {
        const rest = prev.filter((item) => item.key !== request.statusKey);
        return request.statusText ? [...rest, { key: request.statusKey, text: request.statusText }] : rest;
      });
      break;
    case "setWidget":
      handlers.setExtensionWidgets((prev) => {
        const rest = prev.filter((item) => item.key !== request.widgetKey);
        return request.widgetLines
          ? [...rest, {
              key: request.widgetKey,
              lines: request.widgetLines,
              placement: request.widgetPlacement ?? "aboveEditor",
            }]
          : rest;
      });
      break;
    case "setTitle":
      if (request.title) document.title = request.title;
      break;
    case "set_editor_text":
      handlers.insertEditorText?.(request.text);
      break;
    case "custom":
      handlers.setExtensionCustomUi((current) => {
        if (request.closed) return current?.id === request.id ? null : current;
        return request;
      });
      break;
  }
}
