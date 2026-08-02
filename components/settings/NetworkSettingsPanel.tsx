"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ReactNode } from "react";
import { useLocale } from "@/hooks/useLocale";
import { SettingsRow, sectionTitle } from "./settings-ui";

type Prefs = {
  httpProxy: string;
  proxyBypass: string;
  customCaCerts: string;
  [key: string]: unknown;
};

export type NetworkSettingsPanelProps = {
  prefs: Prefs;
   
  setPrefs: (value: any | ((prev: any) => any)) => void;
  patchPref: (patch: Record<string, unknown>, opts?: { restart?: boolean }) => void | Promise<void>;
  networkTesting: boolean;
  setNetworkTesting: (v: boolean) => void;
  networkReport: any;
  setNetworkReport: (v: any) => void; // report shape from /api/network/test
  saveErrorBlock: ReactNode;
};

export function NetworkSettingsPanel({
  prefs,
  setPrefs,
  patchPref,
  networkTesting,
  setNetworkTesting,
  networkReport,
  setNetworkReport,
  saveErrorBlock,
}: NetworkSettingsPanelProps) {
  const { t } = useLocale();
  return (
    <>

      {sectionTitle(t("settings.network"))}

      <SettingsRow
        stacked
        title={t("settings.httpProxy")}
        description={t("settings.httpProxyDesc")}
        action={
          <input
            className="input-base input-mono"
            value={prefs.httpProxy}
            placeholder={t("settings.httpProxyPlaceholder")}
            onChange={(e) => setPrefs((p: any) => ({ ...p, httpProxy: e.target.value }))}
            onBlur={() => void patchPref({ httpProxy: prefs.httpProxy }, { restart: true })}
            style={{ width: "100%" }}
          />
        }
      />
      <SettingsRow
        stacked
        title={t("settings.proxyBypass")}
        description={t("settings.proxyBypassDesc")}
        action={
          <input
            className="input-base input-mono"
            value={prefs.proxyBypass}
            placeholder={t("settings.proxyBypassPlaceholder")}
            onChange={(e) => setPrefs((p: any) => ({ ...p, proxyBypass: e.target.value }))}
            onBlur={() => void patchPref({ proxyBypass: prefs.proxyBypass }, { restart: true })}
            style={{ width: "100%" }}
          />
        }
      />
      <SettingsRow
        stacked
        title={t("settings.customCa")}
        description={t("settings.customCaDesc")}
        action={
          <input
            className="input-base input-mono"
            value={prefs.customCaCerts}
            placeholder={t("settings.customCaPlaceholder")}
            onChange={(e) => setPrefs((p: any) => ({ ...p, customCaCerts: e.target.value }))}
            onBlur={() => void patchPref({ customCaCerts: prefs.customCaCerts }, { restart: true })}
            style={{ width: "100%" }}
          />
        }
      />

      <SettingsRow
        stacked
        title={t("settings.networkTest")}
        description={t("settings.networkTestDesc")}
        action={
          <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
            <button
              type="button"
              className="btn-primary btn-compact"
              disabled={networkTesting}
              style={{ alignSelf: "flex-start" }}
              onClick={() => {
                setNetworkTesting(true);
                setNetworkReport(null);
                void fetch("/api/network/test", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({}),
                })
                  .then(async (res) => {
                    const data = await res.json() as typeof networkReport & { error?: string };
                    if (!res.ok || data?.error) throw new Error(data?.error ?? `HTTP ${res.status}`);
                    setNetworkReport(data);
                  })
                  .catch((e) => setNetworkReport({ error: e instanceof Error ? e.message : String(e) }))
                  .finally(() => setNetworkTesting(false));
              }}
            >
              {networkTesting ? t("settings.networkTestRunning") : t("settings.networkTestRun")}
            </button>
            {networkReport && (
              <div
                className="settings-status-card"
                style={{ flexDirection: "column", alignItems: "stretch", gap: 0, lineHeight: 1.45 }}
              >
                {networkReport.error ? (
                  <div style={{ color: "var(--destructive)" }}>{networkReport.error}</div>
                ) : (
                  <>
                    <div style={{ marginBottom: 6 }}>
                      {t("settings.networkTestOk", {
                        ok: networkReport.summary?.fetchOk ?? 0,
                        total: networkReport.summary?.fetchTotal ?? 0,
                      })}
                      {" · proxy="}
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                        {networkReport.proxy?.httpProxy || networkReport.proxy?.envHttpProxy || "(none)"}
                      </span>
                    </div>
                    <ul style={{ margin: 0, padding: "0 0 0 16px" }}>
                      {(networkReport.fetches ?? []).map((f: any) => (
                        <li key={f.url} style={{ marginBottom: 4 }}>
                          <span style={{ color: f.ok ? "var(--success)" : "var(--destructive)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
                            {f.ok ? `HTTP ${f.status}` : "FAIL"}
                          </span>
                          {" "}
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{f.url}</span>
                          <span style={{ color: "var(--text-dim)" }}> ({f.ms}ms)</span>
                          {f.error && <div style={{ color: "var(--destructive)", fontSize: 11 }}>{f.error}</div>}
                        </li>
                      ))}
                    </ul>
                    <div style={{ marginTop: 8 }}>
                      {networkReport.search?.ok
                        ? t("settings.networkSearchOk", {
                            n: networkReport.search.count ?? 0,
                            ms: networkReport.search.ms,
                          })
                        : `${t("settings.networkSearchFail")}${networkReport.search?.error ? `: ${networkReport.search.error}` : ""}`}
                      {networkReport.search?.first && (
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                          {networkReport.search.first.title} — {networkReport.search.first.url}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        }
      />

      {saveErrorBlock}
    </>

  );
}
