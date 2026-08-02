/**
 * Terminal workspace tab model and pure label renumbering.
 */

export type TerminalSessionTab = {
  id: string;
  label: string;
  source: "user" | "agent";
  attachSessionId?: string;
  command?: string;
};

export function renumberTerminalLabels(
  tabs: TerminalSessionTab[],
  t: (key: string, params?: Record<string, string | number>) => string,
): TerminalSessionTab[] {
  let userIndex = 0;
  return tabs.map((tab) => {
    if (tab.source === "agent") {
      const cmd = tab.command?.replace(/\s+/g, " ").trim();
      const short = cmd && cmd.length > 28 ? `${cmd.slice(0, 25)}…` : cmd;
      return {
        ...tab,
        label: short ? `${t("git.terminalAgent")} · ${short}` : t("git.terminalAgent"),
      };
    }
    userIndex += 1;
    return { ...tab, label: `${t("git.terminal")} ${userIndex}` };
  });
}

export type WorkspaceTab =
  | { id: "review"; kind: "review" }
  | { id: "files"; kind: "files" }
  | { id: "context"; kind: "context" }
  | { id: "debug"; kind: "debug" }
  | { id: "terminal"; kind: "terminal" };

export const WORKSPACE_TABS: WorkspaceTab[] = [
  { id: "review", kind: "review" },
  { id: "files", kind: "files" },
  { id: "context", kind: "context" },
  { id: "debug", kind: "debug" },
  { id: "terminal", kind: "terminal" },
];
