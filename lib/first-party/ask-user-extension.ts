/**
 * First-party `ask_user_question` tool for Pi Web.
 *
 * Replaces @juicesharp/rpiv-ask-user-question. Uses the RPC dialog primitives
 * (ui.select / ui.input) that ChatWindow already renders via extension_ui_request.
 * No TUI overlay graph, no jiti package load.
 */
import { Type } from "typebox";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";

const MAX_QUESTIONS = 4;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;
const MAX_HEADER_LENGTH = 16;
const MAX_LABEL_LENGTH = 60;
const MAX_PREVIEW_CHARS = 600;

const RESERVED_LABELS = ["Other", "Type something.", "Next"] as const;
const TYPE_SOMETHING_LABEL = "Type something.";

const DECLINE_MESSAGE = "User declined to answer questions";
const ENVELOPE_PREFIX = "User has answered your questions:";
const ENVELOPE_SUFFIX = "You can now continue with the user's answers in mind.";
const NO_INPUT_PLACEHOLDER = "(no input)";
const ERROR_NO_UI = "Error: UI not available (running in non-interactive mode)";
const MULTI_SELECT_INSTRUCTIONS =
  'Enter the numbers of all that apply, comma-separated (e.g. "1,3"), or type a custom answer as plain text.';
const CUSTOM_ANSWER_TITLE = "Type your answer:";
const MULTI_SELECT_PLACEHOLDER = "1,3";

type OptionData = { label: string; description: string; preview?: string };
type QuestionData = {
  question: string;
  header: string;
  options: OptionData[];
  multiSelect?: boolean;
};
type QuestionParams = { questions: QuestionData[] };

type QuestionAnswer =
  | {
      questionIndex: number;
      question: string;
      kind: "option";
      answer: string;
      preview?: string;
      notes?: string;
    }
  | {
      questionIndex: number;
      question: string;
      kind: "custom";
      answer: string;
      notes?: string;
    }
  | {
      questionIndex: number;
      question: string;
      kind: "multi";
      answer: null;
      selected: string[];
      notes?: string;
    };

type QuestionnaireResult = {
  answers: QuestionAnswer[];
  cancelled: boolean;
  error?: string;
};

type DialogUI = {
  select: (title: string, options: string[]) => Promise<string | undefined>;
  input: (title: string, placeholder?: string) => Promise<string | undefined>;
  askUser?: (questions: QuestionParams["questions"]) => Promise<string | undefined>;
};

function hasDialogUI(ui: unknown): ui is DialogUI {
  const u = ui as Partial<Record<"select" | "input", unknown>> | null | undefined;
  return typeof u?.select === "function" && typeof u?.input === "function";
}

const OptionSchema = Type.Object({
  label: Type.String({
    maxLength: MAX_LABEL_LENGTH,
    description: `MAX ${MAX_LABEL_LENGTH} CHARACTERS — hard limit, requests over the limit are rejected. The display text for this option that the user will see and select. Should be concise (1-5 words) and clearly describe the choice.`,
  }),
  description: Type.String({
    description:
      "Explanation of what this option means or what will happen if chosen. Useful for providing context about trade-offs or implications.",
  }),
  preview: Type.Optional(
    Type.String({
      description:
        "Optional preview content rendered when this option is focused. Use for mockups, code snippets, or visual comparisons that help users compare options.",
    }),
  ),
});

const QuestionSchema = Type.Object({
  question: Type.String({
    description:
      'The complete question to ask the user. Should be clear, specific, and end with a question mark. Example: "Which library should we use for date formatting?" If multiSelect is true, phrase it accordingly, e.g. "Which features do you want to enable?"',
  }),
  header: Type.String({
    maxLength: MAX_HEADER_LENGTH,
    description: `MAX ${MAX_HEADER_LENGTH} CHARACTERS — hard limit, requests over the limit are rejected. Very short chip/tag shown next to the question. Examples: "Auth method", "Library", "Approach".`,
  }),
  options: Type.Array(OptionSchema, {
    minItems: MIN_OPTIONS,
    maxItems: MAX_OPTIONS,
    description:
      "The available choices for this question. Must have 2-4 options. Each option should be a distinct, mutually exclusive choice (unless multiSelect is enabled). The 'Type something.' row is appended automatically — do NOT author it.",
  }),
  multiSelect: Type.Optional(
    Type.Boolean({
      default: false,
      description: "Set to true to allow the user to select multiple options instead of just one. Use when choices are not mutually exclusive.",
    }),
  ),
});

const QuestionParamsSchema = Type.Object({
  questions: Type.Array(QuestionSchema, {
    minItems: 1,
    maxItems: MAX_QUESTIONS,
    description: "Questions to ask the user (1-4 questions)",
  }),
});

function validateQuestionnaire(typed: QuestionParams): { ok: true } | { ok: false; message: string } {
  if (typed.questions.length === 0) {
    return { ok: false, message: "Error: At least one question is required" };
  }
  if (typed.questions.length > MAX_QUESTIONS) {
    return { ok: false, message: `Error: At most ${MAX_QUESTIONS} questions are allowed per invocation` };
  }
  const seenQuestions = new Set<string>();
  for (const q of typed.questions) {
    if (seenQuestions.has(q.question)) {
      return { ok: false, message: "Error: Question text must be unique within an invocation" };
    }
    seenQuestions.add(q.question);
    if (q.options.length < MIN_OPTIONS) {
      return { ok: false, message: `Error: Each question requires at least ${MIN_OPTIONS} options` };
    }
    const seenLabels = new Set<string>();
    for (const o of q.options) {
      if ((RESERVED_LABELS as readonly string[]).includes(o.label)) {
        return {
          ok: false,
          message: `Error: Option label is reserved (${RESERVED_LABELS.join(", ")})`,
        };
      }
      if (seenLabels.has(o.label)) {
        return { ok: false, message: "Error: Option labels must be unique within a question" };
      }
      seenLabels.add(o.label);
    }
  }
  return { ok: true };
}

function formatOptionLine(option: OptionData, index: number): string {
  return `${index + 1}. ${option.label} — ${option.description}`;
}

function parseIndex(token: string, count: number): number | null {
  const i = Number.parseInt(token, 10) - 1;
  return i >= 0 && i < count ? i : null;
}

function buildPreviewBlock(question: QuestionData): string {
  const blocks = question.options.flatMap((o, i) =>
    o.preview && o.preview.length > 0
      ? [`--- ${i + 1}. ${o.label} preview ---\n${o.preview.slice(0, MAX_PREVIEW_CHARS)}`]
      : [],
  );
  return blocks.length > 0 ? `\n\n${blocks.join("\n\n")}` : "";
}

function formatAnswerScalar(a: QuestionAnswer): string {
  switch (a.kind) {
    case "multi":
      return a.selected && a.selected.length > 0 ? a.selected.join(", ") : NO_INPUT_PLACEHOLDER;
    case "custom":
      return a.answer && a.answer.length > 0 ? a.answer : NO_INPUT_PLACEHOLDER;
    case "option":
      return a.answer ?? NO_INPUT_PLACEHOLDER;
  }
}

function buildAnswerSegment(a: QuestionAnswer): string {
  const parts: string[] = [`"${a.question}"="${formatAnswerScalar(a)}"`];
  if ("preview" in a && a.preview && a.preview.length > 0) parts.push(`selected preview: ${a.preview}`);
  if (a.notes && a.notes.length > 0) parts.push(`user notes: ${a.notes}`);
  return `${parts.join(". ")}.`;
}

function buildToolResult(text: string, details: QuestionnaireResult) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}
function parseInlineAskResult(raw: string | undefined): QuestionnaireResult | null {
  if (raw == null || raw.trim() === "") return null;
  try {
    const parsed = JSON.parse(raw) as QuestionnaireResult;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      answers: Array.isArray(parsed.answers) ? parsed.answers : [],
      cancelled: parsed.cancelled === true,
    };
  } catch {
    return null;
  }
}

function buildQuestionnaireResponse(
  result: QuestionnaireResult | null | undefined,
  params: QuestionParams,
): ReturnType<typeof buildToolResult> {
  if (!result || result.cancelled) {
    return buildToolResult(DECLINE_MESSAGE, {
      answers: result?.answers ?? [],
      cancelled: true,
    });
  }
  const segments: string[] = [];
  for (let i = 0; i < params.questions.length; i++) {
    const a = result.answers.find((x) => x.questionIndex === i);
    if (a) segments.push(buildAnswerSegment(a));
  }
  if (segments.length === 0) {
    return buildToolResult(DECLINE_MESSAGE, { answers: result.answers, cancelled: true });
  }
  return buildToolResult(`${ENVELOPE_PREFIX} ${segments.join(" ")} ${ENVELOPE_SUFFIX}`, result);
}

async function askSingleSelect(
  ui: DialogUI,
  q: QuestionData,
  questionIndex: number,
  header: string,
): Promise<QuestionAnswer | undefined> {
  const options = q.options.map(formatOptionLine);
  options.push(`${q.options.length + 1}. ${TYPE_SOMETHING_LABEL}`);
  const chosen = await ui.select(`${header}${q.question}${buildPreviewBlock(q)}`, options);
  if (chosen == null) return undefined;
  const idx = parseIndex(chosen, options.length);
  if (idx == null) return undefined;
  if (idx < q.options.length) {
    const o = q.options[idx]!;
    return {
      questionIndex,
      question: q.question,
      kind: "option",
      answer: o.label,
      preview: o.preview && o.preview.length > 0 ? o.preview : undefined,
    };
  }
  const typed = await ui.input(`${header}${q.question}\n\n${CUSTOM_ANSWER_TITLE}`, "");
  if (typed == null) return undefined;
  return { questionIndex, question: q.question, kind: "custom", answer: typed };
}

async function askMultiSelect(
  ui: DialogUI,
  q: QuestionData,
  questionIndex: number,
  header: string,
): Promise<QuestionAnswer | undefined> {
  const list = q.options.map(formatOptionLine).join("\n");
  const value = await ui.input(
    `${header}${q.question}\n\n${list}\n\n${MULTI_SELECT_INSTRUCTIONS}`,
    MULTI_SELECT_PLACEHOLDER,
  );
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { questionIndex, question: q.question, kind: "multi", answer: null, selected: [] };
  }
  const tokens = trimmed.split(/[,\s]+/).filter((tok) => tok.length > 0);
  const indices = tokens.map((tok) => (/^\d+\.?$/.test(tok) ? parseIndex(tok, q.options.length) : null));
  if (indices.every((i): i is number => i != null)) {
    const selected: string[] = [];
    for (const i of indices) {
      const label = q.options[i]!.label;
      if (!selected.includes(label)) selected.push(label);
    }
    return { questionIndex, question: q.question, kind: "multi", answer: null, selected };
  }
  return { questionIndex, question: q.question, kind: "custom", answer: trimmed };
}

async function runRpcQuestionnaire(ui: DialogUI, params: QuestionParams): Promise<QuestionnaireResult> {
  const answers: QuestionAnswer[] = [];
  for (let qi = 0; qi < params.questions.length; qi++) {
    const q = params.questions[qi]!;
    const header = q.header ? `[${q.header}] ` : "";
    const answer = q.multiSelect
      ? await askMultiSelect(ui, q, qi, header)
      : await askSingleSelect(ui, q, qi, header);
    if (answer === undefined) return { answers, cancelled: true };
    answers.push(answer);
  }
  return { answers, cancelled: false };
}

const PROMPT_GUIDELINES = [
  `Use ask_user_question whenever the user's request is underspecified and you cannot proceed without concrete decisions — you can ask up to ${MAX_QUESTIONS} questions per invocation.`,
  `Each question MUST have ${MIN_OPTIONS}-${MAX_OPTIONS} options. Every option requires a concise label (1-5 words) and a description explaining what the choice means or its trade-offs. The user can additionally type a custom answer via the automatically appended "Type something." row on every question, or press Esc to abandon the questionnaire. Do NOT author "Other" or "Type something." labels yourself — reserved labels are rejected at runtime.`,
  `Set multiSelect: true when multiple answers are valid. Provide an options[].preview markdown string when an option benefits from richer side-by-side context (mockups, code snippets, diagrams, configs) — single-select only. The "Type something." row is appended to every question; in preview mode it expands to the full pane width while typing so the custom answer is not cramped into the narrow options column. If you recommend a specific option, make that the first option and append "(Recommended)" to its label.`,
  "Do not stack multiple ask_user_question calls back-to-back — group all clarifying questions into one invocation.",
];

export function createAskUserInlineExtension(): InlineExtension {
  return {
    name: "ask-user-question",
    factory(pi: ExtensionAPI) {
      pi.registerTool({
        name: "ask_user_question",
        label: "Ask User Question",
        description: `Ask the user one or more structured questions during execution. Use when you need to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take

Usage notes:
- Users can type a custom answer via the automatically appended "Type something." row on every question or press Esc to abandon the questionnaire. Do NOT author "Other" or "Type something." labels yourself — reserved labels are rejected at runtime.
- Use multiSelect: true when multiple answers are valid.
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label.`,
        promptSnippet: `Ask the user up to ${MAX_QUESTIONS} structured questions (${MIN_OPTIONS}-${MAX_OPTIONS} options each) when requirements are ambiguous`,
        promptGuidelines: PROMPT_GUIDELINES,
        parameters: QuestionParamsSchema,
        async execute(_toolCallId, rawParams, _signal, _onUpdate, ctx) {
          const typed = rawParams as unknown as QuestionParams;
          if (!ctx.hasUI) {
            return buildToolResult(ERROR_NO_UI, { answers: [], cancelled: true, error: "no_ui" });
          }
          const validation = validateQuestionnaire(typed);
          if (!validation.ok) {
            return buildToolResult(validation.message, {
              answers: [],
              cancelled: true,
              error: "validation",
            });
          }
          const askUser = (ctx.ui as DialogUI).askUser;
          if (typeof askUser === "function") {
            const raw = await askUser(typed.questions);
            return buildQuestionnaireResponse(parseInlineAskResult(raw), typed);
          }
          if (!hasDialogUI(ctx.ui)) {
            return buildToolResult(
              "Error: this client cannot render the questionnaire (select/input dialogs unavailable). Ask the questions as plain chat text instead, without using this tool.",
              { answers: [], cancelled: true, error: "no_dialog_ui" },
            );
          }
          return buildQuestionnaireResponse(await runRpcQuestionnaire(ctx.ui, typed), typed);
        },
      });
    },
  };
}
