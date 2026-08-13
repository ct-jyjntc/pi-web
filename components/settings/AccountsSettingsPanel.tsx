"use client";

/**
 * Settings → Accounts: connect/disconnect optional third-party accounts
 * (GitHub first). Uses the shared GithubConnectModal for the device-code flow.
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-transport";
import { useLocale } from "@/hooks/useLocale";
import { SettingsGroup, SettingsPageHeading, SettingsRow } from "./settings-ui";
import {
  GithubConnectModal,
  type GithubAccountStatus,
} from "../GithubConnectModal";
import { Icon } from "../Icon";
import { ConfirmDialog } from "../ConfirmDialog";
import { Github, Link2, Unplug } from "lucide-react";

export function AccountsSettingsPanel() {
  const { t } = useLocale();
  const [status, setStatus] = useState<GithubAccountStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/accounts");
      const data = await res.json() as {
        accounts?: { github?: GithubAccountStatus };
        error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setStatus(data.accounts?.github ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const disconnect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/accounts/github/disconnect", { method: "POST" });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || data.ok === false) throw new Error(data.error ?? `HTTP ${res.status}`);
      setDisconnectOpen(false);
      setStatus((prev) => ({
        connected: false,
        login: null,
        name: null,
        avatarUrl: null,
        ghCliLogin: prev?.ghCliLogin ?? null,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const connected = status?.connected === true;

  return (
    <div className="settings-page-general">
      <SettingsPageHeading title={t("settings.accounts")} description={t("accounts.description")} />
      {error && (
        <div style={{ fontSize: 12, color: "var(--destructive)", marginBottom: 10, lineHeight: 1.4 }}>
          {error}
        </div>
      )}

      <SettingsGroup>
      <SettingsRow
        title={t("accounts.github")}
        description={
          connected
            ? t("accounts.githubConnectedDesc")
            : (status?.ghCliLogin
              ? t("accounts.githubCliHint", { login: status.ghCliLogin })
              : t("accounts.githubNotConnectedDesc"))
        }
        action={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {connected && status?.login && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)", maxWidth: 180, overflow: "hidden" }}>
                {status.avatarUrl ? (
                  <img
                    src={status.avatarUrl}
                    alt={status.login}
                    width={22}
                    height={22}
                    style={{ borderRadius: "50%", border: "1px solid var(--border)", flexShrink: 0 }}
                  />
                ) : (
                  <span style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--bg-selected)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, flexShrink: 0 }}>
                    {status.login.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{status.login}</span>
              </span>
            )}
            {loading ? (
              <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("common.loading")}</span>
            ) : connected ? (
              <button
                type="button"
                className="btn-ghost"
                disabled={busy}
                onClick={() => setDisconnectOpen(true)}
                style={{ height: 30, padding: "0 12px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Icon icon={Unplug} size={12} />
                {t("accounts.disconnect")}
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => setConnectOpen(true)}
                style={{ height: 30, padding: "0 12px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Icon icon={Github} size={13} />
                {t("accounts.connect")}
              </button>
            )}
          </div>
        }
      />
      </SettingsGroup>

      <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--text-dim)" }}>
        <Icon icon={Link2} size={12} />
        <span>{t("accounts.scopeNote")}</span>
      </div>

      <GithubConnectModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onConnected={() => {
          setConnectOpen(false);
          void load();
        }}
      />
      {disconnectOpen && (
        <ConfirmDialog
          title={t("accounts.disconnect")}
          body={t("accounts.disconnectConfirm")}
          confirmLabel={t("accounts.disconnect")}
          destructive
          busy={busy}
          onConfirm={() => void disconnect()}
          onCancel={() => {
            if (!busy) setDisconnectOpen(false);
          }}
        />
      )}
    </div>
  );
}
