"use client";

/**
 * Shared "Connect GitHub" device-code modal — single owner for the in-app
 * GitHub OAuth UX. Used by Settings → Accounts and the Git panel's publish
 * flow (when a repo has no remote and the user is not signed in).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiStream } from "@/lib/api-transport";
import { useLocale } from "@/hooks/useLocale";
import { Icon } from "./Icon";
import { Check, ExternalLink, Github, X } from "lucide-react";

export type GithubAccountStatus = {
  connected: boolean;
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
  ghCliLogin?: string | null;
};

export type GithubConnectedInfo = {
  login: string;
  name: string | null;
  avatarUrl: string | null;
};

type ConnectPhase =
  | { phase: "idle" }
  | { phase: "connecting" }
  | {
      phase: "device_code";
      userCode: string;
      verificationUri: string;
      expiresAt: number;
    }
  | { phase: "error"; message: string }
  | { phase: "success"; login: string; name: string | null; avatarUrl: string | null };

// (GitHub logo renders via the lucide Github icon in the header.)

export function GithubConnectModal({
  open,
  onClose,
  onConnected,
}: {
  open: boolean;
  onClose: () => void;
  onConnected?: (info: GithubConnectedInfo) => void;
}) {
  const { t } = useLocale();
  const [phase, setPhase] = useState<ConnectPhase>({ phase: "idle" });
  const [remaining, setRemaining] = useState<number | null>(null);
  const streamRef = useRef<ReturnType<typeof apiStream> | null>(null);
  /** Set synchronously when a terminal event (success/error/cancelled) lands,
   *  so the stream-close handler cannot clobber it with a race. */
  const finishedRef = useRef(false);

  const start = useCallback(() => {
    streamRef.current?.close();
    finishedRef.current = false;
    setPhase({ phase: "connecting" });
    const es = apiStream("/api/accounts/github/connect");
    streamRef.current = es;

    const on = (type: string, handler: (data: Record<string, unknown>) => void) => {
      es.addEventListener(type, (e: MessageEvent) => {
        try {
          handler(JSON.parse(String(e.data)) as Record<string, unknown>);
        } catch {
          // ignore malformed frames
        }
      });
    };

    on("device_code", (data) => {
      const expiresIn = typeof data.expiresInSeconds === "number" ? data.expiresInSeconds : 900;
      setPhase({
        phase: "device_code",
        userCode: String(data.userCode ?? ""),
        verificationUri: String(data.verificationUri ?? "https://github.com/login/device"),
        expiresAt: Date.now() + expiresIn * 1000,
      });
    });
    on("success", (data) => {
      finishedRef.current = true;
      const info: GithubConnectedInfo = {
        login: String(data.login ?? ""),
        name: typeof data.name === "string" ? data.name : null,
        avatarUrl: typeof data.avatarUrl === "string" ? data.avatarUrl : null,
      };
      setPhase({ phase: "success", ...info });
      onConnected?.(info);
    });
    on("error", (data) => {
      finishedRef.current = true;
      setPhase({ phase: "error", message: String(data.message ?? t("accounts.connectFailed")) });
    });
    on("cancelled", () => {
      finishedRef.current = true;
      setPhase({ phase: "error", message: t("accounts.loginCancelled") });
    });
    es.onerror = () => {
      // Normal close after success, or a dropped connection mid-flow.
      if (!finishedRef.current) {
        setPhase({ phase: "error", message: t("accounts.connectionClosed") });
      }
    };
  }, [onConnected, t]);

  useEffect(() => {
    if (!open) return;
    start();
    return () => {
      streamRef.current?.close();
      streamRef.current = null;
    };
  }, [open, start]);

  // Countdown while waiting for authorization.
  useEffect(() => {
    if (phase.phase !== "device_code") {
      setRemaining(null);
      return;
    }
    const tick = () => setRemaining(Math.max(0, Math.round((phase.expiresAt - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  if (!open) return null;

  const formatRemaining = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-shell"
        style={{ width: 380, maxWidth: "calc(100vw - 32px)", padding: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <Icon icon={Github} size={16} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
            {t("accounts.connectGithubTitle")}
          </span>
          <button
            type="button"
            className="icon-btn"
            style={{ marginLeft: "auto" }}
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <Icon icon={X} size={14} />
          </button>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {phase.phase === "connecting" && (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {t("accounts.starting")}
            </div>
          )}

          {phase.phase === "device_code" && (
            <>
              <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                {t("accounts.deviceInstructions")}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  padding: "12px 0",
                }}
              >
                <a
                  href={phase.verificationUri}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    fontSize: 13,
                    color: "var(--accent)",
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                  onClick={() => {
                    // open + copy code hint handled by the link itself
                  }}
                >
                  {phase.verificationUri}
                  <Icon icon={ExternalLink} size={11} style={{ marginLeft: 4, verticalAlign: -1 }} />
                </a>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  padding: "10px 0",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  background: "var(--bg-panel)",
                }}
              >
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                  {t("accounts.enterCode")}
                </span>
                <span
                  style={{
                    fontSize: 22,
                    fontWeight: 600,
                    letterSpacing: "0.12em",
                    fontFamily: "var(--font-mono)",
                    color: "var(--text)",
                    userSelect: "all",
                  }}
                >
                  {phase.userCode}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, color: "var(--text-dim)" }}>
                <span>
                  {remaining !== null && remaining > 0
                    ? t("accounts.expiresIn", { n: formatRemaining(remaining) })
                    : t("accounts.expiring")}
                </span>
                <button
                  type="button"
                  className="btn-ghost btn-compact"
                  onClick={() => window.open(phase.verificationUri, "_blank", "noopener,noreferrer")}
                >
                  {t("accounts.openGithub")}
                </button>
              </div>
            </>
          )}

          {phase.phase === "error" && (
            <>
              <div style={{ fontSize: 12, color: "var(--destructive)", lineHeight: 1.5 }}>
                {phase.message}
              </div>
              <button type="button" className="btn-primary btn-compact" onClick={() => void start()}>
                {t("accounts.retry")}
              </button>
            </>
          )}

          {phase.phase === "success" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "8px 0" }}>
              {phase.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={phase.avatarUrl}
                  alt={phase.login}
                  width={44}
                  height={44}
                  style={{ borderRadius: "50%", border: "1px solid var(--border)" }}
                />
              ) : (
                <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--bg-selected)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
                  {phase.login.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Icon icon={Check} size={13} />
                {t("accounts.connectedAs", { login: phase.login })}
              </div>
              <button type="button" className="btn-primary btn-compact" onClick={onClose}>
                {t("common.close")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
