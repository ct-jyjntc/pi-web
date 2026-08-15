/**
 * Which child transcript is open in the main chat column.
 * Does not start an AgentSession on the child file.
 */
"use client";

import { useSyncExternalStore } from "react";

export type ChildTranscriptRequest = {
  childSessionId: string;
  parentSessionId: string;
  title?: string;
};

type Listener = () => void;

let current: ChildTranscriptRequest | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function requestChildTranscript(request: ChildTranscriptRequest): void {
  current = request;
  emit();
}

export function closeChildTranscript(): void {
  if (!current) return;
  current = null;
  emit();
}

export function getChildTranscript(): ChildTranscriptRequest | null {
  return current;
}

export function subscribeChildTranscript(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useChildTranscript(): ChildTranscriptRequest | null {
  return useSyncExternalStore(subscribeChildTranscript, getChildTranscript, getChildTranscript);
}
