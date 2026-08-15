/**
 * Inline questionnaire for a pending ask_user_question tool call.
 */
"use client";

import { useMemo, useState } from "react";
import { Check, Circle } from "lucide-react";
import { sendAgentCommand } from "@/lib/agent-client";
import { setAskUserRequest, type AskUserQuestion, type AskUserUiRequest } from "@/lib/ask-user-store";
import { useLocale } from "@/hooks/useLocale";
import { Icon } from "../Icon";

type Draft = {
  selected: string[];
  custom: string;
  useCustom: boolean;
};

function emptyDraft(): Draft {
  return { selected: [], custom: "", useCustom: false };
}

export function AskUserCard({
  request,
  sessionId,
}: {
  request: AskUserUiRequest;
  sessionId?: string;
}) {
  const { t } = useLocale();
  const [drafts, setDrafts] = useState<Draft[]>(() => request.questions.map(emptyDraft));
  const [busy, setBusy] = useState(false);

  const canSubmit = useMemo(() => {
    return request.questions.every((question, index) => {
      const draft = drafts[index] ?? emptyDraft();
      if (draft.useCustom) return draft.custom.trim().length > 0;
      return draft.selected.length > 0;
    });
  }, [drafts, request.questions]);

  const update = (index: number, patch: Partial<Draft>) => {
    setDrafts((prev) => prev.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
  };

  const submit = async (cancelled: boolean) => {
    if (!sessionId || busy) return;
    setBusy(true);
    const answers = cancelled
      ? []
      : request.questions.map((question, index) => {
          const draft = drafts[index] ?? emptyDraft();
          if (draft.useCustom) {
            return {
              questionIndex: index,
              question: question.question,
              kind: "custom" as const,
              answer: draft.custom.trim(),
            };
          }
          if (question.multiSelect) {
            return {
              questionIndex: index,
              question: question.question,
              kind: "multi" as const,
              answer: null,
              selected: draft.selected,
            };
          }
          return {
            questionIndex: index,
            question: question.question,
            kind: "option" as const,
            answer: draft.selected[0] ?? "",
          };
        });
    try {
      await sendAgentCommand(sessionId, {
        type: "extension_ui_response",
        id: request.id,
        value: JSON.stringify({ answers, cancelled }),
      });
      setAskUserRequest(null);
    } catch (error) {
      console.error("Failed to send ask_user_question response:", error);
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: "8px 10px 10px",
        borderTop: "1px solid var(--border)",
        background: "var(--bg)",
      }}
    >
      {request.questions.map((question, index) => (
        <QuestionBlock
          key={`${request.id}-${index}`}
          question={question}
          draft={drafts[index] ?? emptyDraft()}
          disabled={busy}
          onChange={(patch) => update(index, patch)}
        />
      ))}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
        <button type="button" className="btn-ghost btn-compact" disabled={busy} onClick={() => void submit(true)}>
          {t("ask.skip")}
        </button>
        <button
          type="button"
          className="btn-primary btn-compact"
          disabled={busy || !canSubmit}
          onClick={() => void submit(false)}
        >
          {t("ask.submit")}
        </button>
      </div>
    </div>
  );
}

function QuestionBlock({
  question,
  draft,
  disabled,
  onChange,
}: {
  question: AskUserQuestion;
  draft: Draft;
  disabled: boolean;
  onChange: (patch: Partial<Draft>) => void;
}) {
  const { t } = useLocale();
  const toggle = (label: string) => {
    if (question.multiSelect) {
      const selected = draft.selected.includes(label)
        ? draft.selected.filter((item) => item !== label)
        : [...draft.selected, label];
      onChange({ selected, useCustom: false });
      return;
    }
    onChange({ selected: [label], useCustom: false });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0, padding: "0 2px" }}>
        {question.header ? (
          <span
            style={{
              flexShrink: 0,
              fontSize: 11,
              color: "var(--text-dim)",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {question.header}
          </span>
        ) : null}
        <div style={{ fontSize: 13, lineHeight: "18px", color: "var(--text)" }}>{question.question}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {question.options.map((option) => {
          const checked = !draft.useCustom && draft.selected.includes(option.label);
          return (
            <button
              key={option.label}
              type="button"
              className={`menu-row${checked ? " is-active" : ""}`}
              disabled={disabled}
              aria-pressed={checked}
              onClick={() => toggle(option.label)}
              style={{ alignItems: "flex-start", gap: 8, padding: "6px 8px" }}
            >
              <Mark checked={checked} multi={Boolean(question.multiSelect)} />
              <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                <span style={{ fontSize: 12, lineHeight: "16px", color: "var(--text)" }}>{option.label}</span>
                {option.description ? (
                  <span style={{ fontSize: 11, lineHeight: "15px", color: "var(--text-muted)", fontWeight: 400 }}>
                    {option.description}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          className={`menu-row${draft.useCustom ? " is-active" : ""}`}
          disabled={disabled}
          aria-pressed={draft.useCustom}
          onClick={() => onChange({ useCustom: true, selected: [] })}
          style={{ alignItems: "flex-start", gap: 8, padding: "6px 8px" }}
        >
          <Mark checked={draft.useCustom} multi={false} />
          <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, lineHeight: "16px", color: "var(--text)" }}>{t("ask.typeSomething")}</span>
            {draft.useCustom ? (
              <input
                className="input-base"
                value={draft.custom}
                disabled={disabled}
                placeholder={t("ask.customPlaceholder")}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => onChange({ custom: event.target.value, useCustom: true, selected: [] })}
                style={{ width: "100%", height: 28, minHeight: 28 }}
              />
            ) : null}
          </span>
        </button>
      </div>
    </div>
  );
}

function Mark({ checked, multi }: { checked: boolean; multi: boolean }) {
  if (checked) {
    return (
      <Icon
        icon={Check}
        size={12}
        strokeWidth={2}
        style={{ marginTop: 2, flexShrink: 0, color: "var(--text)" }}
      />
    );
  }
  return (
    <Icon
      icon={Circle}
      size={12}
      strokeWidth={1.8}
      style={{
        marginTop: 2,
        flexShrink: 0,
        color: "var(--text-dim)",
        borderRadius: multi ? "var(--radius-xs)" : undefined,
      }}
    />
  );
}
