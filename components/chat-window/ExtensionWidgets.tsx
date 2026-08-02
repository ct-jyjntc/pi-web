"use client";

import { SpecializedExtensionWidget } from "../extension/ExtensionWidgetViews";

export function ExtensionWidgets({
  widgets,
  layout = "stack",
}: {
  widgets: Array<{ key: string; lines: string[] }>;
  /** `row` = compact session top-bar chips side by side. */
  layout?: "stack" | "row";
}) {
  if (widgets.length === 0) return null;
  return (
    <div
      style={
        layout === "row"
          ? { display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "flex-start" }
          : { display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }
      }
    >
      {widgets.map((widget) => (
        <div
          key={widget.key}
          style={layout === "row" ? { flex: "1 1 220px", minWidth: 0, maxWidth: "100%" } : undefined}
        >
          <SpecializedExtensionWidget widgetKey={widget.key} lines={widget.lines} />
        </div>
      ))}
    </div>
  );
}


