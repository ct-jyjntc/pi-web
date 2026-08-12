export interface ChatDraftImage {
  data: string;
  mimeType: string;
}

import type { AttachedSkill } from "./skill-invoke";

export interface ChatDraft {
  value: string;
  images: ChatDraftImage[];
  attachedSkill?: AttachedSkill | null;
}

const drafts = new Map<string, ChatDraft>();

function cloneDraft(draft: ChatDraft): ChatDraft {
  return {
    value: draft.value,
    images: draft.images.map((image) => ({ ...image })),
    attachedSkill: draft.attachedSkill ? { ...draft.attachedSkill } : draft.attachedSkill,
  };
}

function isEmptyDraft(draft: ChatDraft): boolean {
  return !draft.value && draft.images.length === 0 && !draft.attachedSkill;
}

export function getDraft(key: string): ChatDraft | null {
  const draft = drafts.get(key);
  return draft ? cloneDraft(draft) : null;
}

export function setDraft(key: string, draft: ChatDraft): void {
  if (isEmptyDraft(draft)) {
    drafts.delete(key);
    return;
  }
  drafts.set(key, cloneDraft(draft));
}

export function clearDraft(key: string): void {
  drafts.delete(key);
}

/** Move a draft from one key to another (e.g. `new:<cwd>` → real session id). */
export function transferDraft(fromKey: string, toKey: string): ChatDraft | null {
  if (!fromKey || !toKey || fromKey === toKey) return getDraft(toKey);
  const existing = drafts.get(toKey);
  if (existing && !isEmptyDraft(existing)) return cloneDraft(existing);
  const source = drafts.get(fromKey);
  if (!source || isEmptyDraft(source)) return existing ? cloneDraft(existing) : null;
  const moved = cloneDraft(source);
  drafts.set(toKey, moved);
  drafts.delete(fromKey);
  return cloneDraft(moved);
}
