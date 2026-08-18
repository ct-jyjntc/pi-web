"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useLocale } from "@/hooks/useLocale";
import { DetailStrip } from "./form-fields";
import { ConfigModelsEnablePanel } from "./ConfigModelsEnablePanel";
import type { OAuthProvider, OAuthLoginState, ProviderModelRow } from "./models-config-types";
import { apiFetch, apiStream, type ApiStream } from "@/lib/api-transport";

export function OAuthDetail({
  provider,
  onRefresh,
  models,
  modelsLoading = false,
  modelsError = null,
  onToggleModel,
  onToggleAllModels,
  onOpenModel,
  onRefreshModels,
  refreshingModels = false,
}: {
  provider: OAuthProvider;
  onRefresh: () => void;
  models: readonly ProviderModelRow[];
  modelsLoading?: boolean;
  modelsError?: string | null;
  onToggleModel?: (modelId: string, enabled: boolean) => void | Promise<void>;
  onToggleAllModels?: (enabled: boolean) => void | Promise<void>;
  /** Drill into a catalog model's detail page. */
  onOpenModel?: (modelId: string) => void;
  /** Live catalog refresh (heavy). Omit to hide the button. */
  onRefreshModels?: () => void;
  refreshingModels?: boolean;
}) {
  const { t } = useLocale();
  const [loginState, setLoginState] = useState<OAuthLoginState>({ phase: "idle" });
  const [inputValue, setInputValue] = useState("");
  const eventSourceRef = useRef<ApiStream | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (loginState.phase === "auth" || loginState.phase === "prompt") {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [loginState.phase]);

  // Reset state when provider changes
  useEffect(() => {
    setLoginState({ phase: "idle" });
    setInputValue("");
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, [provider.id]);

  useEffect(() => {
    return () => { eventSourceRef.current?.close(); };
  }, []);

  const handleLogin = useCallback(() => {
    eventSourceRef.current?.close();
    setLoginState({ phase: "connecting" });
    setInputValue("");

    const es = apiStream(`/api/auth/login/${encodeURIComponent(provider.id)}`);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as {
        type: string; url?: string; instructions?: string | null;
        token?: string; message?: string; placeholder?: string | null;
        userCode?: string; verificationUri?: string; intervalSeconds?: number | null; expiresInSeconds?: number | null;
        options?: { id: string; label: string }[];
      };
      if (data.type === "auth") {
        setLoginState({ phase: "auth", url: data.url!, instructions: data.instructions ?? null, token: data.token! });
        window.open(data.url!, "_blank", "noopener,noreferrer");
      } else if (data.type === "device_code") {
        setLoginState({
          phase: "device_code",
          userCode: data.userCode!,
          verificationUri: data.verificationUri!,
          intervalSeconds: data.intervalSeconds ?? null,
          expiresInSeconds: data.expiresInSeconds ?? null,
        });
        window.open(data.verificationUri!, "_blank", "noopener,noreferrer");
      } else if (data.type === "prompt_request") {
        setLoginState({ phase: "prompt", message: data.message!, placeholder: data.placeholder ?? null, token: data.token! });
      } else if (data.type === "select_request") {
        setLoginState({ phase: "select", message: data.message!, options: data.options ?? [], token: data.token! });
      } else if (data.type === "progress") {
        setLoginState({ phase: "progress", message: data.message! });
      } else if (data.type === "success") {
        es.close();
        setLoginState({ phase: "success" });
        onRefresh();
        onRefreshModels?.();
      } else if (data.type === "error") {
        es.close();
        setLoginState({ phase: "error", message: data.message! });
      } else if (data.type === "cancelled") {
        es.close();
        setLoginState({ phase: "idle" });
      }
    };
    es.onerror = () => {
      es.close();
      setLoginState((prev) => prev.phase === "success" ? prev : { phase: "error", message: t("models.connectionLost") });
    };
  }, [provider.id, onRefresh, onRefreshModels, t]);

  const handleLogout = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/auth/logout/${encodeURIComponent(provider.id)}`, {
        method: "POST",
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setLoginState({
          phase: "error",
          message: d.error ?? t("models.disconnectFailed", { status: res.status }),
        });
        return;
      }
      setLoginState({ phase: "idle" });
      onRefresh();
    } catch (e) {
      setLoginState({
        phase: "error",
        message: e instanceof Error ? e.message : t("models.networkError"),
      });
    }
  }, [provider.id, onRefresh, t]);

  const submitCode = useCallback(async (token: string, code: string) => {
    if (!code.trim()) return;
    setLoginState({ phase: "progress", message: t("models.verifying") });
    try {
      const res = await apiFetch(`/api/auth/login/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code: code.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setLoginState({ phase: "error", message: d.error ?? `Server error ${res.status}` });
        return;
      }
      setInputValue("");
      // Success path: SSE stream will emit "success" and update state
    } catch (e) {
      setLoginState({ phase: "error", message: e instanceof Error ? e.message : t("models.networkError") });
    }
  }, [provider.id, t]);

  const submitSelection = useCallback(async (token: string, value: string) => {
    setLoginState({ phase: "progress", message: t("models.continuing") });
    try {
      const res = await apiFetch(`/api/auth/login/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code: value }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setLoginState({ phase: "error", message: d.error ?? `Server error ${res.status}` });
      }
    } catch (e) {
      setLoginState({ phase: "error", message: e instanceof Error ? e.message : t("models.networkError") });
    }
  }, [provider.id, t]);

  const isWorking = loginState.phase === "connecting" || loginState.phase === "progress" ||
    loginState.phase === "auth" || loginState.phase === "device_code" ||
    loginState.phase === "prompt" || loginState.phase === "select";
  // Idle + already connected: nothing to say here — skip the login card.
  const showLoginBody = loginState.phase !== "idle" || !provider.loggedIn;

  return (
    <div>
      <DetailStrip
        title={provider.name}
        actions={(
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: provider.loggedIn ? "var(--success)" : "var(--border)", display: "inline-block" }} />
            <span style={{ fontSize: 11, color: provider.loggedIn ? "var(--success)" : "var(--text-dim)" }}>
              {provider.loggedIn ? t("models.statusConnected") : t("models.statusNotConnected")}
            </span>
            {isWorking ? (
              <button
                type="button"
                className="btn-ghost btn-compact"
                onClick={() => { eventSourceRef.current?.close(); setLoginState({ phase: "idle" }); }}
              >
                {t("common.cancel")}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={provider.loggedIn ? "btn-ghost btn-compact" : "btn-primary btn-compact"}
                  onClick={handleLogin}
                >
                  {provider.loggedIn ? t("modal.relogin") : t("modal.login")}
                </button>
                {provider.loggedIn && (
                  <button
                    type="button"
                    className="btn-ghost btn-compact"
                    onClick={handleLogout}
                    style={{ color: "var(--destructive)", borderColor: "var(--destructive-border)" }}
                  >
                    {t("modal.disconnect")}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      />

      {showLoginBody && (
      <div className="settings-group">
        <div className="settings-card">
          <div className="settings-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {loginState.phase === "idle" && !provider.loggedIn && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
            {t("models.connectAccount", { name: provider.name })}
          </p>
        )}
        {loginState.phase === "connecting" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>{t("models.openingBrowser")}</p>
        )}
        {loginState.phase === "select" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {loginState.message}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {loginState.options.map((option) => (
                <button
                  key={option.id}
                  onClick={() => submitSelection(loginState.token, option.id)}
                  style={{ padding: "6px 9px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text)", cursor: "pointer", fontSize: 12, textAlign: "left" }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {(loginState.phase === "auth" || loginState.phase === "prompt") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {loginState.phase === "auth"
                ? t("models.pasteRedirectUrl")
                : loginState.message}
            </p>
            {loginState.phase === "auth" && (
              <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
                {t("models.openLoginFallback")}{" "}
                <a href={loginState.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", wordBreak: "break-all" }}>
                  {t("models.openLoginLink")}
                </a>
                .
              </p>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitCode(loginState.token, inputValue); }}
                placeholder={loginState.phase === "auth" ? "http://localhost:1455/auth/callback?code=…" : (loginState.placeholder ?? t("models.enterValue"))}
                className="input-base input-mono"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn-primary btn-compact"
                onClick={() => submitCode(loginState.token, inputValue)}
                disabled={!inputValue.trim()}
                style={{ flexShrink: 0 }}
              >
                {t("common.save")}
              </button>
            </div>
          </div>
        )}
        {loginState.phase === "device_code" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {t("models.deviceCodeHint")}
            </p>
            <div style={{ padding: "8px 10px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text)", fontSize: 14, fontWeight: 600, fontFamily: "var(--font-mono)", letterSpacing: 0 }}>
              {loginState.userCode}
            </div>
            <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
              <a href={loginState.verificationUri} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", wordBreak: "break-all" }}>
                {loginState.verificationUri}
              </a>
              {loginState.expiresInSeconds ? ` ${t("models.expiresInMinutes", { n: Math.ceil(loginState.expiresInSeconds / 60) })}` : ""}
            </p>
          </div>
        )}
        {loginState.phase === "progress" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>{loginState.message}</p>
        )}
        {loginState.phase === "success" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--success)" }}>{t("models.connectedOk")}</p>
        )}
        {loginState.phase === "error" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--destructive)" }}>{loginState.message}</p>
        )}
          </div>
        </div>
      </div>
      )}

      {provider.loggedIn && (
        <ConfigModelsEnablePanel
          models={models}
          loading={modelsLoading && models.length === 0}
          error={modelsError}
          onToggleModel={onToggleModel}
          onToggleAllModels={onToggleAllModels}
          onOpenModel={onOpenModel ? (m) => { if (m.id) onOpenModel(m.id); } : undefined}
          toolbar={onRefreshModels ? (
            <button
              type="button"
              className="btn-ghost btn-compact"
              onClick={onRefreshModels}
              disabled={refreshingModels || modelsLoading}
              title={t("models.refreshModels")}
            >
              {refreshingModels || modelsLoading
                ? t("models.refreshingModels")
                : t("models.refreshModels")}
            </button>
          ) : null}
        />
      )}
    </div>
  );
}
