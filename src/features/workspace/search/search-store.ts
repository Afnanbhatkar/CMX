"use client";

/**
 * CodeMind X V2 — search session store (Phase 7).
 *
 * Session-only state for the hybrid search panel. The QUERY, mode, filters
 * and last results survive navigating away and back (spec §7 "preserve
 * query"). Never persisted to localStorage: results are transient views of
 * the live workspace.
 */

import { create } from "zustand";

import type { SearchResponse } from "@/server/search/search-service";

export type SearchStatus = "idle" | "searching" | "done" | "error";

interface SearchSessionState {
  query: string;
  mode: string;
  languageFilter: string | null;
  pathFilter: string | null;
  scope: "all" | "code" | "tests" | "docs" | "config";
  useCurrentFileContext: boolean;
  status: SearchStatus;
  response: SearchResponse | null;
  error: string | null;
  /** Client-side activity stage clock (real elapsed, honest). */
  searchStartedAt: number | null;
  lastElapsedMs: number | null;

  setQuery: (q: string) => void;
  setMode: (m: string) => void;
  setLanguageFilter: (l: string | null) => void;
  setPathFilter: (p: string | null) => void;
  setScope: (s: "all" | "code" | "tests" | "docs" | "config") => void;
  setUseCurrentFileContext: (v: boolean) => void;
  beginSearch: () => void;
  finishSearch: (response: SearchResponse) => void;
  failSearch: (error: string) => void;
  reset: () => void;
}

export const useSearchSessionStore = create<SearchSessionState>((set) => ({
  query: "",
  mode: "auto",
  languageFilter: null,
  pathFilter: null,
  scope: "all",
  useCurrentFileContext: false,
  status: "idle",
  response: null,
  error: null,
  searchStartedAt: null,
  lastElapsedMs: null,

  setQuery: (query) => set({ query }),
  setMode: (mode) => set({ mode }),
  setLanguageFilter: (languageFilter) => set({ languageFilter }),
  setPathFilter: (pathFilter) => set({ pathFilter }),
  setScope: (scope) => set({ scope }),
  setUseCurrentFileContext: (useCurrentFileContext) => set({ useCurrentFileContext }),
  beginSearch: () =>
    set({ status: "searching", error: null, searchStartedAt: Date.now() }),
  finishSearch: (response) =>
    set((s) => ({
      status: "done",
      response,
      lastElapsedMs: s.searchStartedAt ? Date.now() - s.searchStartedAt : null,
      searchStartedAt: null,
    })),
  failSearch: (error) =>
    set((s) => ({
      status: "error",
      error,
      lastElapsedMs: s.searchStartedAt ? Date.now() - s.searchStartedAt : null,
      searchStartedAt: null,
    })),
  reset: () =>
    set({
      query: "",
      status: "idle",
      response: null,
      error: null,
      searchStartedAt: null,
      lastElapsedMs: null,
    }),
}));
