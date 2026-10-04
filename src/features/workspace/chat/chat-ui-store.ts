"use client";

/**
 * CodeMind X V2 — chat UI store (non-persisted).
 *
 * Tiny transient store for chat-surface UI state that must be shared between
 * the sidebar quick actions, the command palette and the composer but must
 * NOT be persisted: the composer draft, the selected composer mode, the
 * requested gateway model, and an attach-file-picker open request.
 * Layout/conversation state lives in the workspace store; nothing here ever
 * reaches localStorage (spec §31).
 */

import { create } from "zustand";

import type { ComposerMode } from "@/features/workspace/assistant/contracts";

export interface ChatUiState {
  /** Current composer draft (never persisted — cleared on reload). */
  draft: string;
  setDraft: (value: string) => void;

  /** Active composer mode (Phase 8A — real, serialized on every send). */
  mode: ComposerMode;
  setMode: (mode: ComposerMode) => void;

  /** Requested LLM Gateway model id; null = gateway default. */
  model: string | null;
  setModel: (id: string | null) => void;

  /**
   * Bumped when a palette command asks the composer to open its
   * "attach repository file" picker (one-shot nonce, like composerFocusNonce).
   */
  attachFileNonce: number;
  requestAttachFile: () => void;
}

export const useChatUiStore = create<ChatUiState>()((set) => ({
  draft: "",
  setDraft: (value) => set({ draft: value }),

  mode: "search",
  setMode: (mode) => set({ mode }),

  model: null,
  setModel: (model) => set({ model }),

  attachFileNonce: 0,
  requestAttachFile: () => set((s) => ({ attachFileNonce: s.attachFileNonce + 1 })),
}));
