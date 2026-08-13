"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import { CenteredDialog } from "../CenteredDialog";
import { Icon } from "../Icon";
import { Plus, Search } from "lucide-react";
import {
  FREE_PROVIDERS,
  type FreeProviderDefinition,
  type FreeProviderId,
} from "@/lib/free-providers";
import type { OAuthProvider, ApiKeyProvider } from "./models-config-types";
import { ProviderIcon } from "./provider-icons";

export interface AddProviderPickerProps {
  oauthProviders: OAuthProvider[];
  apiKeyProviders: ApiKeyProvider[];
  /** Provider keys already present in models.json (managed free providers hidden when present). */
  existingProviderKeys: string[];
  onSelectOAuth: (id: string) => void;
  onSelectApiKey: (id: string) => void;
  onAddCustom: () => void;
  onAddFree: (def: FreeProviderDefinition) => void;
  freeBusyId?: FreeProviderId | null;
  onClose: () => void;
}

export function AddProviderPicker({
  oauthProviders, apiKeyProviders, existingProviderKeys,
  onSelectOAuth, onSelectApiKey, onAddCustom, onAddFree, freeBusyId, onClose,
}: AddProviderPickerProps) {
  const { t } = useLocale();
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 30); }, []);

  const q = search.trim().toLowerCase();
  const existing = new Set(existingProviderKeys);

  const availableOAuth = oauthProviders.filter((p) => !p.loggedIn && (!q || p.name.toLowerCase().includes(q)));
  const oauthLoggedInIds = new Set(oauthProviders.filter((p) => p.loggedIn).map((p) => p.id));
  // Hide dual-auth providers from the API Key picker while their OAuth session is active.
  const availableApiKey = apiKeyProviders.filter((p) =>
    !p.configured
    && !oauthLoggedInIds.has(p.id)
    && (!q || p.displayName.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
  );
  const availableFree = FREE_PROVIDERS.filter((p) => {
    if (existing.has(p.providerKey)) return false;
    if (!q) return true;
    return (
      p.displayName.toLowerCase().includes(q)
      || p.providerKey.toLowerCase().includes(q)
      || p.description.toLowerCase().includes(q)
      || "free".includes(q)
      || t("models.free").toLowerCase().includes(q)
    );
  });
  const showCustom = !q || "custom".includes(q) || "openai-compatible".includes(q) || "anthropic-compatible".includes(q);

  const totalCount = availableOAuth.length + availableApiKey.length + availableFree.length + (showCustom ? 1 : 0);

  return (
     <CenteredDialog
       width={720}
       zIndex={1300}
       label={t("models.searchProviders")}
       onClose={onClose}
       style={{ maxHeight: "min(72vh, calc(100vh - 32px))", display: "flex", flexDirection: "column" }}
     >
       <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px 8px" }}>
           <Icon icon={Search} size={13} strokeWidth={2} style={{ color: "var(--text-dim)", flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
            placeholder={t("models.searchProviders")}
            className="input-base"
            style={{
              flex: 1,
              border: "none",
              background: "transparent",
              boxShadow: "none",
              paddingLeft: 0,
              paddingRight: 0,
              borderRadius: 0,
            }}
          />
        </div>

        {/* Card grid */}
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          {totalCount === 0 ? (
            <div className="modal-empty">{t("models.noProvidersMatch")}</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 8 }}>
              {availableFree.length > 0 && (
                <div style={{ gridColumn: "1 / -1", fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("models.free")}</div>
              )}
              {availableFree.map((p) => {
                const busy = freeBusyId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className="provider-card"
                    disabled={busy || !!freeBusyId}
                    onClick={() => { onAddFree(p); }}
                    style={{ flexDirection: "row", alignItems: "center", gap: 8, width: "100%" }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.displayName}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>
                        {busy ? t("models.fetchingFreeModels") : p.description}
                      </div>
                    </div>
                    <ProviderIcon id={p.iconId} size={28} />
                  </button>
                );
              })}

              {showCustom && (
                <div style={{ gridColumn: "1 / -1", paddingTop: availableFree.length > 0 ? 6 : 0, fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("models.custom")}</div>
              )}
              {showCustom && (
                <button
                  type="button"
                  className="provider-card"
                  onClick={() => { onAddCustom(); onClose(); }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8, width: "100%" }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t("models.compatible")}</div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>{t("models.customEndpoint")}</div>
                  </div>
                  <span style={{ width: 26, height: 26, borderRadius: "var(--radius-sm)", background: "var(--bg-hover)", border: "1px dashed var(--border)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon icon={Plus} size={13} strokeWidth={2} style={{ color: "var(--text-dim)" }} />
                  </span>
                </button>
              )}

              {availableOAuth.length > 0 && (
                <div style={{ gridColumn: "1 / -1", paddingTop: (showCustom || availableFree.length > 0) ? 6 : 0, fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("models.subscriptions")}</div>
              )}
              {availableOAuth.map((p) => (
                <button key={p.id} type="button" className="provider-card" onClick={() => { onSelectOAuth(p.id); onClose(); }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8, width: "100%" }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>{t("models.oauth")}</div>
                  </div>
                  <ProviderIcon id={p.id} size={28} />
                </button>
              ))}

              {availableApiKey.length > 0 && (
                <div style={{ gridColumn: "1 / -1", paddingTop: availableOAuth.length > 0 ? 6 : 0, fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("models.apiKey")}</div>
              )}
              {availableApiKey.map((p) => (
                <button key={p.id} type="button" className="provider-card" onClick={() => { onSelectApiKey(p.id); onClose(); }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8, width: "100%" }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.displayName}</div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>{p.modelCount} models</div>
                  </div>
                  <ProviderIcon id={p.id} size={28} />
                </button>
              ))}

            </div>
          )}
        </div>
     </CenteredDialog>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
