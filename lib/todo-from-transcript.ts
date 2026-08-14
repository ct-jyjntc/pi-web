/**
 * Format rpiv-todo widget lines from a structured task list.
 * The host fold owns the list; this is view-only for the extension overlay.
 */

export type DerivedTodoItem = {
  id: number;
  subject: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
  activeForm?: string;
};

function glyphFor(status: DerivedTodoItem["status"]): string {
  if (status === "completed") return "✓";
  if (status === "in_progress") return "◐";
  if (status === "deleted") return "✗";
  return "○";
}

/** Build rpiv-todo-shaped widget lines for the extension overlay. */
export function formatTodoWidgetLines(
  items: ReadonlyArray<Pick<DerivedTodoItem, "id" | "subject" | "status" | "activeForm">>,
): string[] | null {
  const visible = items.filter((t) => t.status !== "deleted");
  if (visible.length === 0) return null;
  const completed = visible.filter((i) => i.status === "completed").length;
  const lines = [`Todo (${completed}/${visible.length})`];
  visible.forEach((item, index) => {
    const branch = index === visible.length - 1 ? "└─" : "├─";
    const label = item.status === "in_progress" && item.activeForm
      ? `${item.subject} (${item.activeForm})`
      : item.subject;
    lines.push(`${branch} ${glyphFor(item.status)} #${item.id} ${label}`);
  });
  return lines;
}
