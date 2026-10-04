"use client";

/**
 * CodeMind X V2 — Context Inspector ledger (Phase 8C).
 *
 * Per-conversation user control over what context may reach the assistant:
 *
 * - pinnedRefs   → included as real file reads on every run;
 * - removedRefs  → filtered out of retrieval server-side; a removed item
 *                  NEVER silently returns during a request (the only way
 *                  back is the user explicitly restoring it, which the UI
 *                  shows);
 * - disabledMemoryIds → disabled memories never reach the model.
 *
 * The ledger is honest UI state: the backend enforces it per run and the
 * Context Inspector shows the ledger's effect in the measured snapshot.
 */

import { create } from "zustand";

export interface RemovedRefRecord {
  ref: string;
  /** Where the removed item came from (its snapshot source label). */
  sourceLabel: string;
  removedAt: number;
}

interface ContextLedger {
  pinnedRefs: string[];
  removedRefs: RemovedRefRecord[];
  disabledMemoryIds: string[];
  /** Bumped whenever a file is re-read ("replace" control). */
  refreshedAt: Record<string, number>;
}

interface ContextInspectorState {
  ledgers: Record<string, ContextLedger>;
  pinRef: (conversationId: string, ref: string) => void;
  unpinRef: (conversationId: string, ref: string) => void;
  removeRef: (conversationId: string, ref: string, sourceLabel: string) => void;
  restoreRef: (conversationId: string, ref: string) => void;
  disableMemory: (conversationId: string, memoryId: string) => void;
  enableMemory: (conversationId: string, memoryId: string) => void;
  touchRef: (conversationId: string, ref: string) => void;
  clearLedger: (conversationId: string) => void;
}

const EMPTY_LEDGER: ContextLedger = {
  pinnedRefs: [],
  removedRefs: [],
  disabledMemoryIds: [],
  refreshedAt: {},
};

export const useContextInspectorStore = create<ContextInspectorState>((set) => ({
  ledgers: {},

  pinRef: (conversationId, ref) =>
    set((s) => {
      const ledger = s.ledgers[conversationId] ?? EMPTY_LEDGER;
      if (ledger.pinnedRefs.includes(ref)) return s;
      return {
        ledgers: {
          ...s.ledgers,
          [conversationId]: {
            ...ledger,
            // Pinning is an explicit re-include: it also lifts any removal.
            pinnedRefs: [...ledger.pinnedRefs, ref],
            removedRefs: ledger.removedRefs.filter((r) => r.ref !== ref),
          },
        },
      };
    }),

  unpinRef: (conversationId, ref) =>
    set((s) => {
      const ledger = s.ledgers[conversationId] ?? EMPTY_LEDGER;
      return {
        ledgers: {
          ...s.ledgers,
          [conversationId]: {
            ...ledger,
            pinnedRefs: ledger.pinnedRefs.filter((r) => r !== ref),
          },
        },
      };
    }),

  removeRef: (conversationId, ref, sourceLabel) =>
    set((s) => {
      const ledger = s.ledgers[conversationId] ?? EMPTY_LEDGER;
      if (ledger.removedRefs.some((r) => r.ref === ref)) return s;
      return {
        ledgers: {
          ...s.ledgers,
          [conversationId]: {
            ...ledger,
            // A removed item cannot stay pinned — removal wins explicitly.
            pinnedRefs: ledger.pinnedRefs.filter((r) => r !== ref),
            removedRefs: [
              ...ledger.removedRefs,
              { ref, sourceLabel, removedAt: Date.now() },
            ],
          },
        },
      };
    }),

  restoreRef: (conversationId, ref) =>
    set((s) => {
      const ledger = s.ledgers[conversationId] ?? EMPTY_LEDGER;
      return {
        ledgers: {
          ...s.ledgers,
          [conversationId]: {
            ...ledger,
            removedRefs: ledger.removedRefs.filter((r) => r.ref !== ref),
          },
        },
      };
    }),

  disableMemory: (conversationId, memoryId) =>
    set((s) => {
      const ledger = s.ledgers[conversationId] ?? EMPTY_LEDGER;
      if (ledger.disabledMemoryIds.includes(memoryId)) return s;
      return {
        ledgers: {
          ...s.ledgers,
          [conversationId]: {
            ...ledger,
            disabledMemoryIds: [...ledger.disabledMemoryIds, memoryId],
          },
        },
      };
    }),

  enableMemory: (conversationId, memoryId) =>
    set((s) => {
      const ledger = s.ledgers[conversationId] ?? EMPTY_LEDGER;
      return {
        ledgers: {
          ...s.ledgers,
          [conversationId]: {
            ...ledger,
            disabledMemoryIds: ledger.disabledMemoryIds.filter((id) => id !== memoryId),
          },
        },
      };
    }),

  touchRef: (conversationId, ref) =>
    set((s) => {
      const ledger = s.ledgers[conversationId] ?? EMPTY_LEDGER;
      return {
        ledgers: {
          ...s.ledgers,
          [conversationId]: {
            ...ledger,
            refreshedAt: { ...ledger.refreshedAt, [ref]: Date.now() },
          },
        },
      };
    }),

  clearLedger: (conversationId) =>
    set((s) => {
      return {
        ledgers: { ...s.ledgers, [conversationId]: { ...EMPTY_LEDGER } },
      };
    }),
}));

/** Read a conversation's ledger (stable empty object when absent). */
export function selectLedger(
  state: ContextInspectorState,
  conversationId: string | null | undefined,
): ContextLedger {
  if (!conversationId) return EMPTY_LEDGER;
  return state.ledgers[conversationId] ?? EMPTY_LEDGER;
}
