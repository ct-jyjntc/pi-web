"use client";

import { Bot } from "lucide-react";
import type { AgentItem, AgentItemStatus } from "@/lib/extension-widget-agents";
import type { MessageKey } from "@/lib/i18n/messages";
import { useLocale } from "@/hooks/useLocale";
import { Icon } from "../Icon";

const STATUS_KEY: Record<AgentItemStatus, MessageKey> = {
  running: "ext.agentRunning",
  queued: "ext.agentQueued",
  completed: "ext.agentCompleted",
  error: "ext.agentError",
  stopped: "ext.agentStopped",
  aborted: "ext.agentAborted",
  unknown: "ext.agentRunning",
};

/** One subagent row — name, live activity, status on the right. */
export function AgentItemRow({ item }: { item: AgentItem }) {
  const { t } = useLocale();
  const active = item.status === "running";
  const done = item.status === "completed" || item.status === "stopped";
   const statusLabel = t(STATUS_KEY[item.status]);
   const live = item.activity || (active ? item.detail : undefined);
   return (
     <div
       style={{
         display: "flex",
         alignItems: live ? "flex-start" : "center",
         gap: 6,
         padding: "3px 6px",
         boxSizing: "border-box",
       }}
     >
       <Icon
         icon={Bot}
         size={12}
         strokeWidth={1.8}
         style={{ marginTop: live ? 2 : 0, flexShrink: 0, color: active ? "var(--text)" : "var(--text-dim)" }}
       />
       <div style={{ minWidth: 0, flex: 1 }}>
         <div
           style={{
             fontSize: 12,
             lineHeight: 1.35,
             fontWeight: active ? 500 : 400,
          }}
        >
          {item.description}
        </div>
         {live ? (
           <div
             style={{
               marginTop: 1,
               fontSize: 11,
               lineHeight: 1.3,
               color: "var(--text-dim)",
               overflow: "hidden",
               textOverflow: "ellipsis",
               whiteSpace: "nowrap",
             }}
           >
             {live}
           </div>
         ) : null}
      </div>
      <span
        style={{
          flexShrink: 0,
          fontSize: 11,
          lineHeight: 1.4,
          color: "var(--text-dim)",
           marginTop: live ? 2 : 0,
        }}
      >
        {statusLabel}
      </span>
    </div>
  );
}
