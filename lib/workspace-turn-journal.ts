/**
 * Single owner for agent workspace turn undo/redo.
 *
 * Records successful edit/write mutations during an agent turn; /undo restores
 * on-disk files to the pre-turn snapshot. Conversation branches stay in the session tree.
 *
 * v1 scope: edit + write tools only (not bash-side file changes).
 */
import { randomBytes } from "crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "./agent-dir";

export type FileMutationKind = "edit" | "create" | "delete";

export type FileMutation = {
  /** Absolute path. */
  path: string;
  kind: FileMutationKind;
  /** Content before the mutation; null when the file was created. */
  before: string | null;
  /** Content after the mutation; null when the file was deleted. */
  after: string | null;
};

export type WorkspaceTurn = {
  id: string;
  sessionId: string;
  createdAt: string;
  sealedAt?: string;
  /** Optional conversation leaf at turn start (future navigate_tree hook). */
  userEntryId?: string;
  files: FileMutation[];
};

export type JournalStatus = {
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  redoCount: number;
  openFileCount: number;
  lastTurn: null | {
    id: string;
    sealedAt?: string;
    fileCount: number;
    paths: string[];
  };
};

export type JournalApplyResult = {
  ok: boolean;
  error?: string;
  turn?: WorkspaceTurn;
  restored: string[];
  skipped: Array<{ path: string; reason: string }>;
};

type SessionJournal = {
  open: WorkspaceTurn | null;
  undo: WorkspaceTurn[];
  redo: WorkspaceTurn[];
};

const MAX_TURNS_PER_SESSION = 40;
/** Skip recording individual files larger than this (before or after). */
export const MAX_MUTATION_BYTES = 1_500_000;
const journals = new Map<string, SessionJournal>();

function newTurnId(): string {
  return randomBytes(6).toString("hex");
}

function storeDir(): string {
  const dir = join(getAgentDir(), "workspace-journal");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function safeSessionKey(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function persistPath(sessionId: string): string {
  return join(storeDir(), `${safeSessionKey(sessionId)}.json`);
}

function emptyJournal(): SessionJournal {
  return { open: null, undo: [], redo: [] };
}

function loadFromDisk(sessionId: string): SessionJournal | null {
  const path = persistPath(sessionId);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      undo?: WorkspaceTurn[];
      redo?: WorkspaceTurn[];
    };
    return {
      open: null,
      undo: Array.isArray(raw.undo) ? raw.undo.slice(-MAX_TURNS_PER_SESSION) : [],
      redo: Array.isArray(raw.redo) ? raw.redo.slice(-MAX_TURNS_PER_SESSION) : [],
    };
  } catch {
    return null;
  }
}

function saveToDisk(sessionId: string, journal: SessionJournal): void {
  try {
    const body = {
      sessionId,
      undo: journal.undo.slice(-MAX_TURNS_PER_SESSION),
      redo: journal.redo.slice(-MAX_TURNS_PER_SESSION),
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(persistPath(sessionId), `${JSON.stringify(body)}\n`, "utf8");
  } catch {
    // Persistence is best-effort; in-memory stack still works.
  }
}

function getJournal(sessionId: string): SessionJournal {
  let j = journals.get(sessionId);
  if (j) return j;
  j = loadFromDisk(sessionId) ?? emptyJournal();
  journals.set(sessionId, j);
  return j;
}

function tooLarge(text: string | null): boolean {
  if (text == null) return false;
  return Buffer.byteLength(text, "utf8") > MAX_MUTATION_BYTES;
}

/** Start a new open turn (or refresh meta on the current open turn). */
export function beginAgentTurn(
  sessionId: string,
  meta?: { userEntryId?: string },
): void {
  if (!sessionId) return;
  const j = getJournal(sessionId);
  if (j.open && j.open.files.length > 0) {
    // Nested begin while mutations exist — seal previous first.
    sealAgentTurn(sessionId);
  }
  if (j.open && j.open.files.length === 0) {
    if (meta?.userEntryId) j.open.userEntryId = meta.userEntryId;
    return;
  }
  j.open = {
    id: newTurnId(),
    sessionId,
    createdAt: new Date().toISOString(),
    userEntryId: meta?.userEntryId,
    files: [],
  };
}

/**
 * Record a successful file mutation into the open turn (opens one if needed).
 * No-ops when content is unchanged or exceeds size budget.
 */
export function recordFileMutation(
  sessionId: string,
  mutation: FileMutation,
): boolean {
  if (!sessionId || !mutation.path) return false;
  if (tooLarge(mutation.before) || tooLarge(mutation.after)) return false;
  if (mutation.before === mutation.after) return false;

  const j = getJournal(sessionId);
  if (!j.open) {
    j.open = {
      id: newTurnId(),
      sessionId,
      createdAt: new Date().toISOString(),
      files: [],
    };
  }

  // Collapse multiple edits of the same path in one turn: keep original before.
  const existing = j.open.files.find((f) => f.path === mutation.path);
  if (existing) {
    existing.after = mutation.after;
    existing.kind =
      existing.before == null && mutation.after != null
        ? "create"
        : mutation.after == null
          ? "delete"
          : "edit";
    return true;
  }

  j.open.files.push({
    path: mutation.path,
    kind: mutation.kind,
    before: mutation.before,
    after: mutation.after,
  });
  return true;
}

/** Seal the open turn into the undo stack when it has file changes. */
export function sealAgentTurn(sessionId: string): WorkspaceTurn | null {
  if (!sessionId) return null;
  const j = getJournal(sessionId);
  const open = j.open;
  j.open = null;
  if (!open || open.files.length === 0) return null;
  open.sealedAt = new Date().toISOString();
  j.undo.push(open);
  if (j.undo.length > MAX_TURNS_PER_SESSION) {
    j.undo = j.undo.slice(-MAX_TURNS_PER_SESSION);
  }
  // New agent work invalidates redo (same as editor undo stacks).
  j.redo = [];
  saveToDisk(sessionId, j);
  return open;
}

export function getJournalStatus(sessionId: string): JournalStatus {
  if (!sessionId) {
    return {
      canUndo: false,
      canRedo: false,
      undoCount: 0,
      redoCount: 0,
      openFileCount: 0,
      lastTurn: null,
    };
  }
  const j = getJournal(sessionId);
  // Allow undo of open turn mid-stream only after seal; UI disables while streaming.
  const last = j.undo[j.undo.length - 1] ?? null;
  return {
    canUndo: j.undo.length > 0,
    canRedo: j.redo.length > 0,
    undoCount: j.undo.length,
    redoCount: j.redo.length,
    openFileCount: j.open?.files.length ?? 0,
    lastTurn: last
      ? {
          id: last.id,
          sealedAt: last.sealedAt,
          fileCount: last.files.length,
          paths: last.files.map((f) => f.path),
        }
      : null,
  };
}

function readDisk(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function writeDisk(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function removeDisk(path: string): void {
  if (existsSync(path)) unlinkSync(path);
}

/**
 * Apply reverse of a sealed turn. Expects disk to still match `after`
 * (conflict → skip that file). Whole-turn still moves stacks when any file restores.
 */
function applyReverse(turn: WorkspaceTurn): {
  restored: string[];
  skipped: Array<{ path: string; reason: string }>;
} {
  const restored: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  // Reverse order so last write wins back to earliest before within the turn.
  for (const file of [...turn.files].reverse()) {
    const disk = readDisk(file.path);
    if (file.after != null && disk !== file.after) {
      skipped.push({
        path: file.path,
        reason: "disk changed since agent wrote it (conflict)",
      });
      continue;
    }
    if (file.after == null && disk != null) {
      // delete was recorded but file exists again — still try restore before
    }
    try {
      if (file.kind === "create" || file.before == null) {
        removeDisk(file.path);
      } else {
        writeDisk(file.path, file.before);
      }
      restored.push(file.path);
    } catch (e) {
      skipped.push({
        path: file.path,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { restored, skipped };
}

function applyForward(turn: WorkspaceTurn): {
  restored: string[];
  skipped: Array<{ path: string; reason: string }>;
} {
  const restored: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  for (const file of turn.files) {
    const disk = readDisk(file.path);
    if (file.before != null && disk !== file.before) {
      // After undo, disk should be before; if user edited, conflict.
      if (disk !== file.after) {
        skipped.push({
          path: file.path,
          reason: "disk does not match undo baseline (conflict)",
        });
        continue;
      }
    }
    try {
      if (file.kind === "delete" || file.after == null) {
        removeDisk(file.path);
      } else {
        writeDisk(file.path, file.after);
      }
      restored.push(file.path);
    } catch (e) {
      skipped.push({
        path: file.path,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { restored, skipped };
}

export function undoWorkspaceTurn(sessionId: string): JournalApplyResult {
  if (!sessionId) return { ok: false, error: "sessionId required", restored: [], skipped: [] };
  const j = getJournal(sessionId);
  // Seal any open mutations first so they become undoable.
  if (j.open?.files.length) sealAgentTurn(sessionId);
  const turn = j.undo.pop();
  if (!turn) {
    return { ok: false, error: "Nothing to undo", restored: [], skipped: [] };
  }
  const { restored, skipped } = applyReverse(turn);
  if (restored.length === 0 && skipped.length > 0) {
    // Put it back — nothing applied.
    j.undo.push(turn);
    saveToDisk(sessionId, j);
    return {
      ok: false,
      error: `Undo blocked: ${skipped.map((s) => s.reason).join("; ")}`,
      turn,
      restored,
      skipped,
    };
  }
  j.redo.push(turn);
  saveToDisk(sessionId, j);
  return { ok: true, turn, restored, skipped };
}

export function redoWorkspaceTurn(sessionId: string): JournalApplyResult {
  if (!sessionId) return { ok: false, error: "sessionId required", restored: [], skipped: [] };
  const j = getJournal(sessionId);
  const turn = j.redo.pop();
  if (!turn) {
    return { ok: false, error: "Nothing to redo", restored: [], skipped: [] };
  }
  const { restored, skipped } = applyForward(turn);
  if (restored.length === 0 && skipped.length > 0) {
    j.redo.push(turn);
    saveToDisk(sessionId, j);
    return {
      ok: false,
      error: `Redo blocked: ${skipped.map((s) => s.reason).join("; ")}`,
      turn,
      restored,
      skipped,
    };
  }
  j.undo.push(turn);
  saveToDisk(sessionId, j);
  return { ok: true, turn, restored, skipped };
}

export type UndoThroughLeafResult = {
  ok: boolean;
  error?: string;
  /** How many sealed turns were undone. */
  undone: number;
  /** True when a turn with userEntryId === leafId was found (else undid all as fallback). */
  matchedLeaf: boolean;
  restored: string[];
  skipped: Array<{ path: string; reason: string }>;
};

/**
 * Undo sealed turns from newest back through the turn that started at `leafId`
 * (userEntryId recorded at prompt start = leaf before that user message).
 *
 * Used by "Edit from here → edit and revert": navigate to leafId, and drop all
 * agent file turns that happened on/after that prompt.
 *
 * If no turn matches leafId, falls back to undoing the entire undo stack so
 * "revert files" still cleans agent edits when entry ids were not recorded.
 */
export function undoWorkspaceTurnsThroughLeaf(
  sessionId: string,
  leafId: string,
): UndoThroughLeafResult {
  if (!sessionId) {
    return { ok: false, error: "sessionId required", undone: 0, matchedLeaf: false, restored: [], skipped: [] };
  }
  if (!leafId) {
    return { ok: false, error: "leafId required", undone: 0, matchedLeaf: false, restored: [], skipped: [] };
  }

  const j = getJournal(sessionId);
  if (j.open?.files.length) sealAgentTurn(sessionId);

  const stack = j.undo;
  let startIdx = -1;
  for (let i = 0; i < stack.length; i++) {
    if (stack[i]!.userEntryId === leafId) {
      startIdx = i;
      break;
    }
  }
  const matchedLeaf = startIdx >= 0;
  // Matched: undo from top down through startIdx inclusive → count = length - startIdx
  // No match: undo everything (fallback)
  const toUndo = matchedLeaf ? stack.length - startIdx : stack.length;
  if (toUndo <= 0) {
    return { ok: true, undone: 0, matchedLeaf, restored: [], skipped: [] };
  }

  const restored: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  let undone = 0;
  for (let n = 0; n < toUndo; n++) {
    const result = undoWorkspaceTurn(sessionId);
    if (!result.ok) {
      return {
        ok: false,
        error: result.error ?? "Undo failed",
        undone,
        matchedLeaf,
        restored,
        skipped: [...skipped, ...result.skipped],
      };
    }
    undone += 1;
    restored.push(...result.restored);
    skipped.push(...result.skipped);
  }
  return { ok: true, undone, matchedLeaf, restored, skipped };
}

/** Test helper — drop in-memory journals and on-disk store under agent dir. */
export function clearWorkspaceJournalsForTests(): void {
  journals.clear();
  try {
    const dir = join(getAgentDir(), "workspace-journal");
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (name.endsWith(".json")) unlinkSync(join(dir, name));
    }
  } catch {
    // ignore cleanup failures in tests
  }
}
