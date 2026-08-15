/**
 * Live ask_user_question request for the inline transcript card.
 * Not a modal — the tool card owns answering.
 */
"use client";

import { useSyncExternalStore } from "react";

export type AskUserOption = {
  label: string;
  description: string;
  preview?: string;
};

export type AskUserQuestion = {
  question: string;
  header: string;
  options: AskUserOption[];
  multiSelect?: boolean;
};

export type AskUserUiRequest = {
  id: string;
  questions: AskUserQuestion[];
};

type Listener = () => void;

let current: AskUserUiRequest | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setAskUserRequest(request: AskUserUiRequest | null): void {
  current = request;
  emit();
}

export function getAskUserRequest(): AskUserUiRequest | null {
  return current;
}

export function subscribeAskUserRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAskUserRequest(): AskUserUiRequest | null {
  return useSyncExternalStore(subscribeAskUserRequest, getAskUserRequest, getAskUserRequest);
}
