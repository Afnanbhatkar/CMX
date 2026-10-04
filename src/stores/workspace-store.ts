"use client";

/**
 * CodeMind X V2 — workspace store.
 *
 * Single central layout + workspace model for the four-panel shell (spec §29/§31).
 *
 * Persistence rules (spec §31):
 * - Versioned schema; invalid/outdated state is clamped or reset on rehydrate.
 * - NEVER persisted: API keys, tokens, passwords, private keys, credentials,
 *   raw repository contents. File contents are transient and stripped.
 * - Session-only tab context (recentTabs, closedTabs, queuedChatFile,
 *   treeReveal) lives in memory only and is rebuilt fresh every session.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  PANEL_DEFAULTS,
  PANEL_LIMITS,
  WORKSPACE_LAYOUT_VERSION,
  type AIRunPhase,
  type AIWorkspaceContextSnapshot,
  type Attachment,
  type ChatMessage,
  type Conversation,
  type FileSelection,
  type OpenTab,
  type OpenTabStatus,
  type PanelCollapseState,
  type PanelSizes,
  type SelectionAIAction,
  type TreeGitStatus,
  type WorkspaceSectionId,
} from "@/features/workspace/types";

/**
 * A real editor selection queued for a selected-code AI action (Phase 6 §5).
 * `code` is the exact selected text; consumed once by the AI composer.
 */
export interface QueuedChatSelection extends FileSelection {
  action: SelectionAIAction;
}

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

const MAX_CONVERSATIONS = 30;
const MAX_MESSAGES_PER_CONVERSATION = 200;
const MAX_TABS = 12;
/** Max length of the session-only most-recently-used open-path list. */
const MAX_RECENT_TABS = 12;
/** Max depth of the session-only closed-tab reopen stack. */
const MAX_CLOSED_TABS = 10;

export type RepoRailView =
  | "explorer"
  | "search"
  | "git"
  | "run"
  | "extensions";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampPercent(value: unknown, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : NaN;
  if (Number.isNaN(n)) return min;
  return clamp(n, min, max);
}

function validSizes(raw: unknown): PanelSizes {
  const r = (raw ?? {}) as Partial<PanelSizes>;
  const sizes: PanelSizes = {
    cmx: clampPercent(r.cmx, PANEL_LIMITS.cmx.min, PANEL_LIMITS.cmx.max),
    chatSidebar: clampPercent(
      r.chatSidebar,
      PANEL_LIMITS.chatSidebar.min,
      PANEL_LIMITS.chatSidebar.max,
    ),
    chat: clampPercent(r.chat, PANEL_LIMITS.chat.min, PANEL_LIMITS.chat.max),
    repo: clampPercent(r.repo, PANEL_LIMITS.repo.min, PANEL_LIMITS.repo.max),
  };
  const total = sizes.cmx + sizes.chatSidebar + sizes.chat + sizes.repo;
  // Recover gracefully from a corrupted total (spec §31).
  if (total < 98 || total > 102) return { ...PANEL_DEFAULTS };
  return sizes;
}

function sanitizeConversation(raw: unknown): Conversation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<Conversation>;
  if (typeof r.id !== "string" || r.id.length === 0) return null;
  const messages = Array.isArray(r.messages)
    ? (r.messages as ChatMessage[])
        .filter(
          (m) =>
            m &&
            typeof m.id === "string" &&
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string" &&
            typeof m.state === "string",
        )
        .map((m) => ({
          ...m,
          state:
            m.state === "generating"
              ? ("stopped" as const) // never resume a dead generation stream
              : m.state,
        }))
        .slice(-MAX_MESSAGES_PER_CONVERSATION)
    : [];
  const status: Conversation["status"] =
    r.status === "generating" ? "stopped" : (r.status ?? "completed");
  return {
    id: r.id,
    title: typeof r.title === "string" ? r.title : null,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date(0).toISOString(),
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : new Date(0).toISOString(),
    status,
    pinned: r.pinned === true,
    archived: r.archived === true,
    messages,
  };
}

/* ------------------------------------------------------------------ */
/* State + actions                                                     */
/* ------------------------------------------------------------------ */

export interface WorkspaceState {
  /* layout (persisted) */
  layoutVersion: number;
  sizes: PanelSizes;
  collapsed: PanelCollapseState;
  /** Width to restore when a sidebar expands again. */
  expandedWidths: { cmx: number; chatSidebar: number };
  section: WorkspaceSectionId;
  /**
   * Explorer column open/closed (Phase 4 session, focus mode). When closed
   * the code editor takes the full repository panel width; reopening is
   * available from the editor tab bar and the repository activity rail.
   * Persisted as part of the editor layout (V2.1 §D).
   */
  explorerOpen: boolean;
  /**
   * File-intelligence panel visibility (Phase 5). Persisted as part of the
   * editor layout (schema v5); default open for older persisted layouts.
   */
  intelligenceOpen: boolean;

  /* conversations (persisted) */
  conversations: Conversation[];
  activeConversationId: string | null;

  /* repository tabs (paths persisted, contents transient) */
  tabs: OpenTab[];
  activeTabPath: string | null;

  /*
   * Session-only tab/tree context — NEVER persisted (no contents, no
   * credentials; derived state rebuilt fresh every session, spec §31).
   */
  /** Most-recent-first paths of tabs opened this session (max 12). */
  recentTabs: string[];
  /** Reopen stack of closed tab paths, most recent first (max 10). */
  closedTabs: Array<{ path: string }>;
  /** File path queued for the chat composer ("Explain with AI"); null when empty. */
  queuedChatFile: string | null;
  /**
   * Editor selection queued for a selected-code AI action (Phase 6 §5);
   * consumed by the AI composer which builds the real prompt + attachment.
   * NEVER persisted (contains file content).
   */
  queuedChatSelection: QueuedChatSelection | null;
  /** Breadcrumbs/tree reveal signal — consumers react to `nonce` changes. */
  treeReveal: { path: string; nonce: number } | null;

  /*
   * Split editor (Phase 6 §1) — session-only. Pane A is the primary group
   * driven by activeTabPath; pane B keeps its own active path. Closing a
   * split clears pane B state. Never persisted.
   */
  splitEditor: boolean;
  paneBPath: string | null;
  activeEditorPane: "a" | "b";

  /* transient ui — never persisted */
  runPhase: AIRunPhase;
  paletteOpen: boolean;
  composerFocusNonce: number;
  /** Incremented by resetLayout so mounted panels can re-sync (never persisted). */
  layoutResetNonce: number;
  repoRailView: RepoRailView;
  chatSidebarSheetOpen: boolean;
  navSheetOpen: boolean;
  repoSheetOpen: boolean;

  /* actions */
  setSizes: (sizes: PanelSizes) => void;
  setExpandedWidth: (which: "cmx" | "chatSidebar", pct: number) => void;
  toggleCmx: () => void;
  toggleChatSidebar: () => void;
  setSection: (id: WorkspaceSectionId) => void;
  setExplorerOpen: (open: boolean) => void;
  /** File-intelligence panel visibility (persisted as layout schema v5). */
  setIntelligenceOpen: (open: boolean) => void;
  resetLayout: () => void;

  newConversation: () => string;
  setActiveConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  deleteConversation: (id: string) => void;
  togglePinConversation: (id: string) => void;
  toggleArchiveConversation: (id: string) => void;
  appendMessage: (
    conversationId: string,
    message: Pick<ChatMessage, "role" | "content"> & {
      attachments?: Attachment[];
      activity?: ChatMessage["activity"];
    },
  ) => string | null;
  updateMessage: (
    conversationId: string,
    messageId: string,
    patch: Partial<
      Pick<
        ChatMessage,
        | "content"
        | "state"
        | "error"
        | "activity"
        | "mode"
        | "servedModel"
        | "firstEventMs"
        | "thoughtForMs"
        | "runId"
        | "contextSnapshot"
        | "memories"
        | "memoryNote"
        | "questionBatch"
        | "intakeAnswers"
        | "approval"
        | "approvalDecision"
      >
    >,
  ) => void;
  setConversationStatus: (id: string, status: Conversation["status"]) => void;

  setRunPhase: (phase: AIRunPhase) => void;
  setPaletteOpen: (open: boolean) => void;
  requestComposerFocus: () => void;
  setRepoRailView: (view: RepoRailView) => void;
  setChatSidebarSheetOpen: (open: boolean) => void;
  setNavSheetOpen: (open: boolean) => void;
  setRepoSheetOpen: (open: boolean) => void;

  openTab: (path: string) => void;
  closeTab: (path: string) => void;
  setActiveTab: (path: string) => void;
  /** Closes every tab except `path`; the closed tabs land on the reopen stack. */
  closeOtherTabs: (path: string) => void;
  /** Closes every tab; all of them land on the reopen stack in tab order. */
  closeAllTabs: () => void;
  /** Pops the reopen stack and re-opens that path. Returns the path or null. */
  reopenClosedTab: () => string | null;
  setTabStatus: (
    path: string,
    status: OpenTabStatus,
    patch?: { content?: string; error?: string },
  ) => void;
  /** Batch working-tree status: paths in `map` get that status, all others null. */
  applyGitStatus: (map: Record<string, TreeGitStatus>) => void;
  /** Single-tab working-tree status update. */
  setTabGitStatus: (path: string, status: TreeGitStatus | null) => void;

  /** Queues a file path for the chat composer and switches to the assistant section. */
  queueChatFile: (path: string) => void;
  /** Returns the queued chat file path (or null) and clears the queue. */
  consumeQueuedChatFile: () => string | null;
  /** Queues an editor selection for an AI action; switches to the assistant section. */
  queueChatSelection: (selection: QueuedChatSelection) => void;
  /** Returns the queued selection (or null) and clears the queue. */
  consumeQueuedChatSelection: () => QueuedChatSelection | null;
  /** Emits a tree-reveal signal; consumers key off the incremented nonce. */
  revealInTree: (path: string) => void;

  /**
   * Opens an in-memory GENERATED tab (AI code block without a repository
   * reference). Content is real AI output; the tab is always badged
   * "generated" and never fetched from disk. Returns the tab path.
   */
  openGeneratedTab: (name: string, code: string, language?: string) => string;
  /** Marks a file tab's in-memory buffer as changed / unchanged. */
  setTabDirty: (path: string, dirty: boolean) => void;

  /* split editor (session-only) */
  toggleSplitEditor: () => void;
  setPaneBPath: (path: string | null) => void;
  setActiveEditorPane: (pane: "a" | "b") => void;
  /**
   * Opens a path in the FOCUSED pane: pane A uses the normal openTab flow,
   * pane B focuses the tab there (opening it via openTab first when new).
   */
  openTabInFocusedPane: (path: string) => void;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      layoutVersion: WORKSPACE_LAYOUT_VERSION,
      sizes: { ...PANEL_DEFAULTS },
      collapsed: { cmx: false, chatSidebar: false },
      expandedWidths: { cmx: PANEL_DEFAULTS.cmx, chatSidebar: PANEL_DEFAULTS.chatSidebar },
      section: "overview",

      conversations: [],
      activeConversationId: null,

      tabs: [],
      activeTabPath: null,

      /* session-only tab/tree context — never persisted (spec §31) */
      recentTabs: [],
      closedTabs: [],
      queuedChatFile: null,
      queuedChatSelection: null,
      treeReveal: null,

      /* split editor — session-only */
      splitEditor: false,
      paneBPath: null,
      activeEditorPane: "a",

      explorerOpen: true,
      intelligenceOpen: true,

      runPhase: "idle",
      paletteOpen: false,
      composerFocusNonce: 0,
      layoutResetNonce: 0,
      repoRailView: "explorer",
      chatSidebarSheetOpen: false,
      navSheetOpen: false,
      repoSheetOpen: false,

      /* ---------------- layout ---------------- */
      setSizes: (sizes) => set({ sizes: validSizes(sizes) }),
      setExpandedWidth: (which, pct) =>
        set((s) => ({
          expandedWidths: {
            ...s.expandedWidths,
            [which]: clampPercent(
              pct,
              PANEL_LIMITS[which].min,
              PANEL_LIMITS[which].max,
            ),
          },
        })),
      toggleCmx: () =>
        set((s) => ({ collapsed: { ...s.collapsed, cmx: !s.collapsed.cmx } })),
      toggleChatSidebar: () =>
        set((s) => ({
          collapsed: { ...s.collapsed, chatSidebar: !s.collapsed.chatSidebar },
        })),
      setSection: (id) =>
        set((s) => ({
          section: id,
          // Navigating to another destination always dismisses the compact
          // nav Sheet, otherwise the destination change is hidden behind it.
          navSheetOpen: false,
        })),
      setExplorerOpen: (open) => set({ explorerOpen: open }),
      setIntelligenceOpen: (open) => set({ intelligenceOpen: open }),
      resetLayout: () =>
        set((s) => ({
          sizes: { ...PANEL_DEFAULTS },
          collapsed: { cmx: false, chatSidebar: false },
          expandedWidths: {
            cmx: PANEL_DEFAULTS.cmx,
            chatSidebar: PANEL_DEFAULTS.chatSidebar,
          },
          // Notify mounted panels so they re-sync to the defaults on screen.
          layoutResetNonce: s.layoutResetNonce + 1,
        })),

      /* ---------------- conversations ---------------- */
      newConversation: () => {
        const id = newId();
        const now = new Date().toISOString();
        const conversation: Conversation = {
          id,
          title: null,
          createdAt: now,
          updatedAt: now,
          status: "active",
          pinned: false,
          archived: false,
          messages: [],
        };
        set((s) => ({
          conversations: [conversation, ...s.conversations].slice(
            0,
            MAX_CONVERSATIONS,
          ),
          activeConversationId: id,
          section: "assistant",
        }));
        return id;
      },
      setActiveConversation: (id) => set({ activeConversationId: id, section: "assistant" }),
      renameConversation: (id, title) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? { ...c, title: title.trim() || c.title } : c,
          ),
        })),
      deleteConversation: (id) =>
        set((s) => {
          const conversations = s.conversations.filter((c) => c.id !== id);
          const activeConversationId =
            s.activeConversationId === id
              ? (conversations.find((c) => !c.archived)?.id ?? null)
              : s.activeConversationId;
          return { conversations, activeConversationId };
        }),
      togglePinConversation: (id) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? { ...c, pinned: !c.pinned } : c,
          ),
        })),
      toggleArchiveConversation: (id) =>
        set((s) => {
          const conversations = s.conversations.map((c) =>
            c.id === id ? { ...c, archived: !c.archived } : c,
          );
          const active = conversations.find((c) => c.id === s.activeConversationId);
          const activeConversationId =
            active && !active.archived
              ? s.activeConversationId
              : (conversations.find((c) => !c.archived)?.id ?? null);
          return { conversations, activeConversationId };
        }),
      appendMessage: (conversationId, message) => {
        const messageId = newId();
        const now = new Date().toISOString();
        let found = false;
        set((s) => ({
          conversations: s.conversations.map((c) => {
            if (c.id !== conversationId) return c;
            found = true;
            const isFirstUserMessage =
              message.role === "user" &&
              !c.messages.some((m) => m.role === "user");
            return {
              ...c,
              title: isFirstUserMessage
                ? message.content.trim().slice(0, 60) || c.title
                : c.title,
              updatedAt: now,
              messages: [
                ...c.messages,
                {
                  id: messageId,
                  role: message.role,
                  content: message.content,
                  createdAt: now,
                  state: message.role === "user" ? ("complete" as const) : ("generating" as const),
                  attachments: message.attachments,
                  activity: message.activity,
                },
              ].slice(-MAX_MESSAGES_PER_CONVERSATION),
            };
          }),
        }));
        return found ? messageId : null;
      },
      updateMessage: (conversationId, messageId, patch) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  updatedAt: new Date().toISOString(),
                  messages: c.messages.map((m) =>
                    m.id === messageId ? { ...m, ...patch } : m,
                  ),
                }
              : c,
          ),
        })),
      setConversationStatus: (id, status) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? { ...c, status } : c,
          ),
        })),

      /* ---------------- transient ui ---------------- */
      setRunPhase: (phase) => set({ runPhase: phase }),
      setPaletteOpen: (open) => set({ paletteOpen: open }),
      requestComposerFocus: () =>
        set((s) => ({ composerFocusNonce: s.composerFocusNonce + 1 })),
      setRepoRailView: (view) => set({ repoRailView: view }),
      setChatSidebarSheetOpen: (open) => set({ chatSidebarSheetOpen: open }),
      setNavSheetOpen: (open) => set({ navSheetOpen: open }),
      setRepoSheetOpen: (open) => set({ repoSheetOpen: open }),

      /* ---------------- tabs ---------------- */
      openTab: (path) =>
        set((s) => {
          const exists = s.tabs.some((t) => t.path === path);
          let nextTabs = s.tabs;
          let nextClosedTabs = s.closedTabs;
          if (!exists) {
            const candidate = [...s.tabs, { path, status: "loading" as const }];
            if (candidate.length > MAX_TABS) {
              /*
               * Honest LRU eviction: at capacity, the OLDEST NON-ACTIVE tab
               * moves onto the reopen stack so `reopenClosedTab` can restore
               * it — it is never silently dropped.
               */
              const evictIdx = candidate.findIndex(
                (t) => t.path !== s.activeTabPath,
              );
              const evicted = evictIdx >= 0 ? candidate[evictIdx] : undefined;
              if (evicted) {
                candidate.splice(evictIdx, 1);
                nextClosedTabs = [
                  { path: evicted.path },
                  ...nextClosedTabs.filter((c) => c.path !== evicted.path),
                ].slice(0, MAX_CLOSED_TABS);
              }
            }
            nextTabs = candidate.slice(-MAX_TABS);
          }
          // Re-opening a path removes it from the reopen stack.
          nextClosedTabs = nextClosedTabs.filter((c) => c.path !== path);
          // MRU: most-recent-first, deduped, capped.
          const recentTabs = [
            path,
            ...s.recentTabs.filter((p) => p !== path),
          ].slice(0, MAX_RECENT_TABS);
          return {
            tabs: nextTabs,
            activeTabPath: path,
            recentTabs,
            closedTabs: nextClosedTabs,
          };
        }),
      closeTab: (path) =>
        set((s) => {
          const idx = s.tabs.findIndex((t) => t.path === path);
          const tabs = s.tabs.filter((t) => t.path !== path);
          let activeTabPath = s.activeTabPath;
          if (s.activeTabPath === path) {
            const next = tabs[Math.min(Math.max(idx - 1, 0), tabs.length - 1)];
            activeTabPath = next ? next.path : null;
          }
          // Phase 6: pane B never keeps a dangling path.
          const paneBPath = s.paneBPath === path ? null : s.paneBPath;
          // A really-closed tab lands on the reopen stack (most recent first).
          const closedTabs =
            idx !== -1
              ? [
                  { path },
                  ...s.closedTabs.filter((c) => c.path !== path),
                ].slice(0, MAX_CLOSED_TABS)
              : s.closedTabs;
          // …and leaves the MRU list.
          const recentTabs = s.recentTabs.filter((p) => p !== path);
          return { tabs, activeTabPath, closedTabs, recentTabs, paneBPath };
        }),
      setActiveTab: (path) =>
        set((s) => ({
          activeTabPath: path,
          // MRU: move an existing tab to the front (ignore phantom paths).
          recentTabs: s.tabs.some((t) => t.path === path)
            ? [path, ...s.recentTabs.filter((p) => p !== path)].slice(
                0,
                MAX_RECENT_TABS,
              )
            : s.recentTabs,
        })),
      closeOtherTabs: (keepPath) =>
        set((s) => {
          const keepExists = s.tabs.some((t) => t.path === keepPath);
          const closing = s.tabs.filter((t) => t.path !== keepPath);
          const closingPaths = new Set(closing.map((t) => t.path));
          // Push the closed tabs in CURRENT tab order (most-recently-active
          // first), then the older reopen-stack entries, capped.
          const closedTabs = [
            ...closing.map((t) => ({ path: t.path })),
            ...s.closedTabs.filter((c) => !closingPaths.has(c.path)),
          ].slice(0, MAX_CLOSED_TABS);
          return {
            tabs: s.tabs.filter((t) => t.path === keepPath),
            activeTabPath: keepExists ? keepPath : null,
            closedTabs,
            // MRU stays consistent with the surviving tabs.
            recentTabs: [
              ...(keepExists ? [keepPath] : []),
              ...s.recentTabs.filter(
                (p) => p !== keepPath && !closingPaths.has(p),
              ),
            ].slice(0, MAX_RECENT_TABS),
          };
        }),
      closeAllTabs: () =>
        set((s) => {
          const closingPaths = new Set(s.tabs.map((t) => t.path));
          // Push ALL closed tabs in current tab order, then older stack entries.
          const closedTabs = [
            ...s.tabs.map((t) => ({ path: t.path })),
            ...s.closedTabs.filter((c) => !closingPaths.has(c.path)),
          ].slice(0, MAX_CLOSED_TABS);
          return {
            tabs: [],
            activeTabPath: null,
            closedTabs,
            recentTabs: s.recentTabs.filter((p) => !closingPaths.has(p)),
          };
        }),
      reopenClosedTab: () => {
        const entry = get().closedTabs[0];
        if (!entry) return null;
        // Pop first, then reuse openTab() so the re-open gets exactly the same
        // treatment as a fresh open (loading status, MRU, activation, LRU).
        set((s) => ({ closedTabs: s.closedTabs.slice(1) }));
        get().openTab(entry.path);
        return entry.path;
      },
      setTabStatus: (path, status, patch) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.path === path ? { ...t, status, ...patch } : t,
          ),
        })),
      applyGitStatus: (map) =>
        set((s) => ({
          tabs: s.tabs.map((t) => {
            const next = Object.prototype.hasOwnProperty.call(map, t.path)
              ? map[t.path]
              : null;
            // Keep identity for unchanged tabs (cheap memo for tab renderers).
            return t.gitStatus === next ? t : { ...t, gitStatus: next };
          }),
        })),
      setTabGitStatus: (path, status) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.path === path && t.gitStatus !== status
              ? { ...t, gitStatus: status }
              : t,
          ),
        })),

      /* ---------------- session-only tab/tree context ---------------- */
      queueChatFile: (path) =>
        set({ queuedChatFile: path, section: "assistant" }),
      consumeQueuedChatFile: () => {
        const queued = get().queuedChatFile;
        if (queued !== null) set({ queuedChatFile: null });
        return queued;
      },
      queueChatSelection: (selection) =>
        set({ queuedChatSelection: selection, section: "assistant" }),
      consumeQueuedChatSelection: () => {
        const queued = get().queuedChatSelection;
        if (queued !== null) set({ queuedChatSelection: null });
        return queued;
      },
      revealInTree: (path) =>
        set((s) => ({
          treeReveal: { path, nonce: (s.treeReveal?.nonce ?? 0) + 1 },
        })),

      /* ---------------- generated + dirty tabs (Phase 6) ---------------- */
      openGeneratedTab: (name, code, language) => {
        const slug =
          name
            .toLowerCase()
            .replace(/[^a-z0-9._-]+/g, "-")
            .replace(/^-+|-+$/g, "") || "snippet";
        const stamp = Date.now().toString(36);
        const path = `generated/${stamp}-${slug}`;
        set((s) => {
          const candidate = [
            ...s.tabs,
            {
              path,
              status: "ready" as const,
              content: code,
              generated: true,
              generatedLanguage: language,
            },
          ];
          let nextTabs = candidate;
          if (candidate.length > MAX_TABS) {
            // Honest eviction: drop the OLDEST GENERATED tab first (it stays
            // re-openable from its original AI message); only when there are
            // none, drop the oldest non-active tab onto the reopen stack.
            const oldestGeneratedIdx = candidate.findIndex((t) => t.generated);
            const evictIdx =
              oldestGeneratedIdx !== -1
                ? oldestGeneratedIdx
                : candidate.findIndex((t) => t.path !== s.activeTabPath);
            if (evictIdx !== -1) {
              const evicted = candidate[evictIdx];
              candidate.splice(evictIdx, 1);
              nextTabs = candidate;
              if (!evicted.generated) {
                set({
                  closedTabs: [
                    { path: evicted.path },
                    ...get().closedTabs.filter((c) => c.path !== evicted.path),
                  ].slice(0, MAX_CLOSED_TABS),
                });
              }
            }
            nextTabs = nextTabs.slice(-MAX_TABS);
          }
          return {
            tabs: nextTabs,
            activeTabPath: path,
            // The editor workspace lives on the Assistant page — focus it so
            // the generated tab is actually visible.
            section: "assistant",
            recentTabs: [path, ...s.recentTabs].slice(0, MAX_RECENT_TABS),
          };
        });
        return path;
      },
      setTabDirty: (path, dirty) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.path === path && t.dirty !== dirty ? { ...t, dirty } : t,
          ),
        })),

      /* ---------------- split editor (Phase 6, session-only) ---------------- */
      toggleSplitEditor: () =>
        set((s) => ({
          splitEditor: !s.splitEditor,
          paneBPath: s.splitEditor ? null : (s.activeTabPath ?? null),
          activeEditorPane: "a",
        })),
      setPaneBPath: (path) => set({ paneBPath: path }),
      setActiveEditorPane: (pane) => set({ activeEditorPane: pane }),
      openTabInFocusedPane: (path) => {
        const s = get();
        if (s.splitEditor && s.activeEditorPane === "b") {
          s.openTab(path);
          s.setPaneBPath(path);
          return;
        }
        s.openTab(path);
      },
    }),
    {
      name: "codemind-workspace",
      version: WORKSPACE_LAYOUT_VERSION,
      storage: createJSONStorage(() => localStorage),
      /*
       * Version bridge (spec §31): when localStorage holds an older schema
       * version (e.g. v4 → v5), hand the persisted state to merge() untouched
       * — merge implements the sanitize/reset policy (outdated layouts reset
       * to current defaults; conversations, tabs and section preserved after
       * sanitization). Without this, zustand's persist middleware logs
       * "couldn't be migrated" and discards the stored state entirely.
       * Future breaking schema changes can branch on `version` here to
       * transform fields explicitly before merge.
       */
      migrate: (persisted) => (persisted ?? {}) as WorkspaceState,
      partialize: (s) => ({
        layoutVersion: s.layoutVersion,
        sizes: s.sizes,
        collapsed: s.collapsed,
        expandedWidths: s.expandedWidths,
        section: s.section,
        // V2.1 §D — editor layout detail: the active repository rail view
        // (explorer/search/git/run) and the explorer focus state restore
        // with the workspace.
        repoRailView: s.repoRailView,
        explorerOpen: s.explorerOpen,
        // v5 — file-intelligence panel visibility restores with the workspace.
        intelligenceOpen: s.intelligenceOpen,
        conversations: s.conversations,
        activeConversationId: s.activeConversationId,
        // paths only — file contents stay transient (never persisted);
        // generated tabs are session-only and never persisted either
        tabs: s.tabs
          .filter((t) => !t.generated)
          .map((t) => ({ path: t.path })),
        activeTabPath: s.activeTabPath,
      }),
      merge: (persisted, current) => {
        const raw = (persisted ?? {}) as Record<string, unknown>;
        const conversations = Array.isArray(raw.conversations)
          ? (raw.conversations as unknown[])
              .map(sanitizeConversation)
              .filter((c): c is Conversation => c !== null)
              .slice(0, MAX_CONVERSATIONS)
          : [];
        const activeConversationId =
          typeof raw.activeConversationId === "string" &&
          conversations.some((c) => c.id === raw.activeConversationId)
            ? (raw.activeConversationId as string)
            : (conversations.find((c) => !c.archived)?.id ?? null);
        const section =
          typeof raw.section === "string" ? (raw.section as WorkspaceSectionId) : "overview";
        const tabs = Array.isArray(raw.tabs)
          ? (raw.tabs as unknown[])
              .filter(
                (t): t is OpenTab =>
                  !!t &&
                  typeof (t as OpenTab).path === "string" &&
                  (t as OpenTab).path.length > 0 &&
                  // generated tabs are session-only; stale persisted paths
                  // from older builds are dropped, never fetched
                  !(t as OpenTab).path.startsWith("generated/"),
              )
              .map((t) => ({ path: t.path, status: "loading" as const }))
              .slice(0, MAX_TABS)
          : [];
        const activeTabPath =
          typeof raw.activeTabPath === "string" && tabs.some((t) => t.path === raw.activeTabPath)
            ? (raw.activeTabPath as string)
            : (tabs[0]?.path ?? null);
        const collapsedRaw = (raw.collapsed ?? {}) as Partial<PanelCollapseState>;
        const expandedRaw = (raw.expandedWidths ?? {}) as Partial<{
          cmx: number;
          chatSidebar: number;
        }>;
        const repoRailViewRaw = raw.repoRailView;
        const repoRailView: RepoRailView =
          repoRailViewRaw === "search" ||
          repoRailViewRaw === "git" ||
          repoRailViewRaw === "run" ||
          repoRailViewRaw === "extensions"
            ? repoRailViewRaw
            : "explorer";
        // Explorer focus state: default open for any older persisted layout.
        const explorerOpen = raw.explorerOpen !== false;
        // v5 — file-intelligence panel: default open for any older persisted layout.
        const intelligenceOpen =
          typeof raw.intelligenceOpen === "boolean" ? raw.intelligenceOpen : true;
        /*
         * Layout reset policy (spec §31): a persisted layout from an older
         * schema version is NEVER clamped into the new one — it is reset to
         * the current defaults so users get the intended composition (11% |
         * 11% | 39% | 39%). Conversations, tabs and section are preserved.
         */
        const isCurrentLayoutVersion =
          raw.layoutVersion === WORKSPACE_LAYOUT_VERSION;
        return {
          ...current,
          layoutVersion: WORKSPACE_LAYOUT_VERSION,
          sizes: isCurrentLayoutVersion
            ? validSizes(raw.sizes)
            : { ...PANEL_DEFAULTS },
          collapsed: isCurrentLayoutVersion
            ? {
                cmx: collapsedRaw.cmx === true,
                chatSidebar: collapsedRaw.chatSidebar === true,
              }
            : { cmx: false, chatSidebar: false },
          expandedWidths: isCurrentLayoutVersion
            ? {
                cmx: clampPercent(
                  expandedRaw.cmx,
                  PANEL_LIMITS.cmx.min,
                  PANEL_LIMITS.cmx.max,
                ),
                chatSidebar: clampPercent(
                  expandedRaw.chatSidebar,
                  PANEL_LIMITS.chatSidebar.min,
                  PANEL_LIMITS.chatSidebar.max,
                ),
              }
            : {
                cmx: PANEL_DEFAULTS.cmx,
                chatSidebar: PANEL_DEFAULTS.chatSidebar,
              },
          section,
          repoRailView,
          explorerOpen,
          intelligenceOpen,
          conversations,
          activeConversationId,
          tabs,
          activeTabPath,
        };
      },
    },
  ),
);

/* ------------------------------------------------------------------ */
/* Selectors                                                           */
/* ------------------------------------------------------------------ */

export function selectActiveConversation(
  s: Pick<WorkspaceState, "conversations" | "activeConversationId">,
): Conversation | null {
  return (
    s.conversations.find((c) => c.id === s.activeConversationId) ?? null
  );
}

/**
 * Honest AI workspace context (spec §12/§32): values are derived from REAL
 * state only. Phase 2 never fabricates repository/branch/selection values —
 * those arrive via the meta API at the UI layer or stay null.
 */
export function selectWorkspaceContext(
  s: Pick<WorkspaceState, "conversations" | "activeConversationId" | "tabs" | "activeTabPath">,
): AIWorkspaceContextSnapshot {
  const active = selectActiveConversation(s);
  const lastUser = [...(active?.messages ?? [])]
    .reverse()
    .find((m) => m.role === "user" && m.attachments && m.attachments.length > 0);
  const activeTab = s.tabs.find((t) => t.path === s.activeTabPath);
  return {
    repository: null, // filled by consumers from the real meta API
    branch: null, // filled by consumers from the real meta API
    activeFile: activeTab && activeTab.status === "ready" ? activeTab.path : (s.activeTabPath ?? null),
    selectedCode: null,
    attachments: lastUser?.attachments ?? [],
  };
}
