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
  type OpenTab,
  type OpenTabStatus,
  type PanelCollapseState,
  type PanelSizes,
  type WorkspaceSectionId,
} from "@/features/workspace/types";

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

const MAX_CONVERSATIONS = 30;
const MAX_MESSAGES_PER_CONVERSATION = 200;
const MAX_TABS = 12;

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

  /* conversations (persisted) */
  conversations: Conversation[];
  activeConversationId: string | null;

  /* repository tabs (paths persisted, contents transient) */
  tabs: OpenTab[];
  activeTabPath: string | null;

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
    patch: Partial<Pick<ChatMessage, "content" | "state" | "error" | "activity">>,
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
  setTabStatus: (
    path: string,
    status: OpenTabStatus,
    patch?: { content?: string; error?: string },
  ) => void;
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

      explorerOpen: true,

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
          const tabs = exists
            ? s.tabs
            : [...s.tabs, { path, status: "loading" as const }].slice(-MAX_TABS);
          return { tabs, activeTabPath: path };
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
          return { tabs, activeTabPath };
        }),
      setActiveTab: (path) => set({ activeTabPath: path }),
      setTabStatus: (path, status, patch) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.path === path ? { ...t, status, ...patch } : t,
          ),
        })),
    }),
    {
      name: "codemind-workspace",
      version: WORKSPACE_LAYOUT_VERSION,
      storage: createJSONStorage(() => localStorage),
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
        conversations: s.conversations,
        activeConversationId: s.activeConversationId,
        // paths only — file contents stay transient (never persisted)
        tabs: s.tabs.map((t) => ({ path: t.path })),
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
                  (t as OpenTab).path.length > 0,
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
