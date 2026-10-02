"use client";

/**
 * CodeMind X V2 — chat UI store (non-persisted).
 *
 * Tiny transient store for chat-surface UI state that must be shared between
 * the sidebar quick actions and the composer but must NOT be persisted:
 * the composer draft text. Layout/conversation state lives in the workspace
 * store; nothing here ever reaches localStorage (spec §31).
 */

import { create } from "zustand";

export interface ChatUiState {
  /** Current composer draft (never persisted — cleared on reload). */
  draft: string;
  setDraft: (value: string) => void;
}

export const useChatUiStore = create<ChatUiState>()((set) => ({
  draft: "",
  setDraft: (value) => set({ draft: value }),
}));
