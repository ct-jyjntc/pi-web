/**
 * Settings → Plugins: skills and MCP in one ChatGPT-style catalog.
 */
"use client";

import { useCallback, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { useDismissible } from "@/hooks/useDismissible";
import { useLocale } from "@/hooks/useLocale";
import type { SkillInfo } from "@/lib/api-types";
import { Icon } from "../Icon";
import { SkillsConfig } from "../SkillsConfig";
import { McpConfig } from "../McpConfig";
import { SettingsPageHeading } from "./settings-ui";

type PluginTab = "skills" | "mcp";

export function PluginsSettings({
  cwd,
  initialTab = "skills",
  onClose,
  onTrySkill,
}: {
  cwd: string | null;
  initialTab?: PluginTab;
  onClose: () => void;
  onTrySkill?: (skill: SkillInfo) => void;
}) {
  const { t } = useLocale();
  const [tab, setTab] = useState<PluginTab>(initialTab);
  const [addOpen, setAddOpen] = useState(false);
  const [skillAddKey, setSkillAddKey] = useState(0);
  const [mcpAddKey, setMcpAddKey] = useState(0);
  const [skillCount, setSkillCount] = useState(0);
  const [mcpCount, setMcpCount] = useState(0);
  const [mcpFormOpen, setMcpFormOpen] = useState(false);
  const [skillAddOpen, setSkillAddOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const closeAddMenu = useCallback(() => setAddOpen(false), []);
  useDismissible(addOpen, closeAddMenu, addMenuRef);

  const openSkillsAdd = () => {
    setTab("skills");
    setSkillAddKey((n) => n + 1);
    setAddOpen(false);
  };
  const openMcpAdd = () => {
    setTab("mcp");
    setMcpAddKey((n) => n + 1);
    setAddOpen(false);
  };

  return (
    <div className="settings-page-general">
      {!(mcpFormOpen || skillAddOpen) && (
        <>
          <SettingsPageHeading
            title={t("settings.plugins")}
            description={t("settings.pluginsSubtitle")}
            action={
              <div ref={addMenuRef} style={{ position: "relative" }}>
                <button
                  type="button"
                  className="btn-primary btn-compact"
                  aria-expanded={addOpen}
                  aria-haspopup="menu"
                  onClick={() => setAddOpen((v) => !v)}
                >
                  {t("settings.pluginsAdd")}
                  <Icon icon={ChevronDown} size={12} strokeWidth={2} />
                </button>
                {addOpen && (
                  <div
                    className="menu-card"
                    role="menu"
                    style={{
                      position: "absolute",
                      right: 0,
                      top: "calc(100% + 4px)",
                      zIndex: 20,
                      minWidth: 168,
                      padding: 3,
                    }}
                  >
                    <button type="button" className="menu-row" role="menuitem" onClick={openSkillsAdd} disabled={!cwd}>
                      <Icon icon={Plus} size={12} strokeWidth={2} />
                      {t("skills.addSkill")}
                    </button>
                    <button type="button" className="menu-row" role="menuitem" onClick={openMcpAdd}>
                      <Icon icon={Plus} size={12} strokeWidth={2} />
                      {t("mcp.addServer")}
                    </button>
                  </div>
                )}
              </div>
            }
          />

          <div className="settings-segmented" style={{ marginBottom: 16 }}>
            <button
              type="button"
              className={`chrome-btn${tab === "skills" ? " is-active" : ""}`}
              aria-pressed={tab === "skills"}
              onClick={() => setTab("skills")}
            >
              {t("settings.skills")} {skillCount}
            </button>
            <button
              type="button"
              className={`chrome-btn${tab === "mcp" ? " is-active" : ""}`}
              aria-pressed={tab === "mcp"}
              onClick={() => setTab("mcp")}
            >
              {t("settings.mcp")} {mcpCount}
            </button>
          </div>
        </>
      )}

      {cwd ? (
        <div hidden={tab !== "skills" || mcpFormOpen}>
          <SkillsConfig
            embedded
            hideHeading
            cwd={cwd}
            onClose={onClose}
            onTrySkill={onTrySkill}
            onCountChange={setSkillCount}
            onAddModeChange={(open) => {
              setSkillAddOpen(open);
              if (!open) setSkillAddKey(0);
            }}
            addRequestKey={skillAddKey}
          />
        </div>
      ) : tab === "skills" && !mcpFormOpen ? (
        <div className="settings-page-empty">{t("settings.skillsNeedCwd")}</div>
      ) : null}

      <div hidden={tab !== "mcp"}>
        <McpConfig
          embedded
          hideHeading
          cwd={cwd}
          onClose={onClose}
          onCountChange={setMcpCount}
          onFormChange={(open) => {
            setMcpFormOpen(open);
            if (!open) setMcpAddKey(0);
          }}
          addRequestKey={mcpAddKey}
        />
      </div>
    </div>
  );
}
