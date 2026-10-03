"use client";

/**
 * CodeMind X V2 — root component of the AI workspace shell.
 *
 * Composition (spec §29, assistant-scoped chrome + V2.1 fixed-shell update):
 * - TopNavigation (h-12) on every breakpoint.
 * - DESKTOP (≥1024px):
 *   - Assistant destination: four panels — CodeMind X sidebar | AI chat
 *     sidebar | AI chat area | Repository (VSCode-style). Both sidebars
 *     default to 11% and are user-adjustable ONLY upward, between 11% and
 *     15% (Phase 4 session directive — never below 11%, never above 15%).
 *     Only the chat|repo split absorbs the remaining width. Sizes +
 *     collapsed state persist via the workspace store.
 *   - Every other destination: two panels — CodeMind X sidebar | destination
 *     main area. The VSCode-style repository panel and the AI chat sidebar
 *     are Assistant-scoped chrome and render ONLY on the Assistant page.
 * - COMPACT (<1024px): persistent icon rail on tablets (≥768px), main area,
 *   and Sheets for navigation / chat sidebar / repository.
 * - CommandPalette mounted once, driven by store.paletteOpen plus a small
 *   `paletteFilesMode` React state (⌘K commands / ⌘P files).
 *
 * Sidebar collapse logic: when a sidebar flips to collapsed, the panel is
 * LOCKED to the exact rail width — `minSize` and `maxSize` both become the
 * rail percentage, so the rail is always exactly RAIL_PX (48px) wide at
 * every viewport size (no dead space around the rail icons on large or full
 * screen windows). When it expands again the panel returns to its persisted
 * 11–15% width. Sidebar boundaries expose disabled handles ONLY while the
 * corresponding sidebar is collapsed; expanded sidebars are resizable
 * within the 11–15% window (drag + arrow keys via react-resizable-panels).
 *
 * Panel focus contract: ⌘1–4 focuses the panel wrappers. Other code can
 * dispatch the window CustomEvent "cmx-focus-panel" with `detail: {index}`
 * (1..4, assistant layout) — used by the command palette. "cmx-open-palette"
 * with `detail: {filesMode}` opens the palette in that mode.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";

import { FadeIn } from "@/components/motion";
import { LatticeLoader } from "@/components/ai";
import { ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { dispatchEditorCommand } from "@/features/workspace/editor/monaco-setup";

import { AIChatSidebar } from "@/features/workspace/chat";
import { RepositoryWorkspaceShell } from "@/features/workspace/repository";
import { AISidebar } from "./AISidebar";
import { ChatAreaRouter } from "./ChatAreaRouter";
import { CommandPalette } from "./CommandPalette";
import { PanelResizer } from "./PanelResizer";
import { TopNavigation } from "./TopNavigation";
import { PANEL_DEFAULTS, PANEL_LIMITS, RAIL_PX } from "../types";
import type { PanelSizes } from "../types";

/* ------------------------------------------------------------------ */
/* SSR-safe media queries (no setState-in-effect, no hydration flash)  */
/* ------------------------------------------------------------------ */

const subscribeNoop = () => () => {};
const getMountedSnapshot = () => true;
const getServerSnapshot = () => false;

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    useCallback(
      (onStoreChange: () => void) => {
        const mediaQuery = window.matchMedia(query);
        mediaQuery.addEventListener("change", onStoreChange);
        return () => mediaQuery.removeEventListener("change", onStoreChange);
      },
      [query],
    ),
    useCallback(() => window.matchMedia(query).matches, [query]),
    getServerSnapshot,
  );
}

/**
 * Collapsed rail width as an EXACT percentage of the viewport.
 *
 * Deliberately NOT clamped to the expanded panel limits: while a sidebar is
 * collapsed, the panel's min/max are locked to this value, so the rail is
 * exactly RAIL_PX wide — on a 1024px screen and on a 3840px full screen
 * alike. The outer clamp only guards degenerate viewports.
 */
function computeRailPct(): number {
  if (typeof window === "undefined") return 3;
  const raw = (RAIL_PX / window.innerWidth) * 100;
  return Math.min(25, Math.max(1.25, raw));
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/* ------------------------------------------------------------------ */
/* AIWorkspace                                                         */
/* ------------------------------------------------------------------ */

export function AIWorkspace() {
  /* Mounted gate — avoids persisted-store hydration mismatches. */
  const mounted = useSyncExternalStore(
    subscribeNoop,
    getMountedSnapshot,
    getServerSnapshot,
  );

  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const isTablet = useMediaQuery("(min-width: 768px)");

  const sizes = useWorkspaceStore((s) => s.sizes);
  const collapsed = useWorkspaceStore((s) => s.collapsed);
  const section = useWorkspaceStore((s) => s.section);
  const navSheetOpen = useWorkspaceStore((s) => s.navSheetOpen);
  const chatSidebarSheetOpen = useWorkspaceStore((s) => s.chatSidebarSheetOpen);
  const repoSheetOpen = useWorkspaceStore((s) => s.repoSheetOpen);
  const setNavSheetOpen = useWorkspaceStore((s) => s.setNavSheetOpen);
  const setChatSidebarSheetOpen = useWorkspaceStore((s) => s.setChatSidebarSheetOpen);
  const setRepoSheetOpen = useWorkspaceStore((s) => s.setRepoSheetOpen);

  /**
   * Assistant-scoped chrome: the AI chat sidebar and the VSCode-style
   * repository panel belong to the Assistant destination only. Every other
   * destination renders as a focused two-panel layout (nav + main area).
   */
  const isAssistantSection = section === "assistant";

  /* Command palette mode (⌘K commands / ⌘P files). */
  const [paletteFilesMode, setPaletteFilesMode] = useState(false);

  /**
   * Re-render on viewport resize so the locked rail percentage tracks the
   * window (rAF-throttled). Without this, a collapsed rail could keep a
   * stale percentage after the window is resized.
   */
  const [, setViewportTick] = useState(0);
  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setViewportTick((t) => t + 1));
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
    };
  }, []);

  /* Panel imperative handles + focus targets. */
  const cmxPanelRef = useRef<ImperativePanelHandle | null>(null);
  const chatSidebarPanelRef = useRef<ImperativePanelHandle | null>(null);
  const chatPanelRef = useRef<ImperativePanelHandle | null>(null);
  const repoPanelRef = useRef<ImperativePanelHandle | null>(null);
  const cmxFocusRef = useRef<HTMLDivElement | null>(null);
  const chatSidebarFocusRef = useRef<HTMLDivElement | null>(null);
  const chatFocusRef = useRef<HTMLDivElement | null>(null);
  const repoFocusRef = useRef<HTMLDivElement | null>(null);

  /* Latest layout from onLayout — the "current panel size" for collapse. */
  const latestLayoutRef = useRef<PanelSizes>({ ...PANEL_DEFAULTS });

  /**
   * Layout writer. Mode-aware:
   * - Four-panel (Assistant) layout reports [cmx, chatSidebar, chat, repo].
   * - Two-panel layout reports [cmx, main] — only cmx may be written, the
   *   Assistant-only sizes must stay untouched.
   * A collapsed sidebar re-reports the rail width on every layout event —
   * the stored EXPANDED size is preserved instead of being corrupted.
   */
  const handleLayout = useCallback((layout: number[]) => {
    const s = useWorkspaceStore.getState();
    const fourPanel = layout.length >= 4;
    const next: PanelSizes = {
      cmx: s.collapsed.cmx ? s.sizes.cmx : (layout[0] ?? s.sizes.cmx),
      chatSidebar: fourPanel
        ? s.collapsed.chatSidebar
          ? s.sizes.chatSidebar
          : (layout[1] ?? s.sizes.chatSidebar)
        : s.sizes.chatSidebar,
      chat: fourPanel ? (layout[2] ?? s.sizes.chat) : s.sizes.chat,
      repo: fourPanel ? (layout[3] ?? s.sizes.repo) : s.sizes.repo,
    };
    latestLayoutRef.current = next;
    s.setSizes(next);
  }, []);

  /**
   * Collapse/expand flips. `defaultSize` covers the initial mount (including
   * a persisted collapsed state); only actual flips need imperative resizes,
   * so the first run on desktop is observed but skipped. The min/max lock
   * (collapsed → rail percentage) does the deterministic clamping.
   */
  const prevCollapsedCmxRef = useRef<boolean | null>(null);
  const prevCollapsedChatSidebarRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!isDesktop) {
      prevCollapsedCmxRef.current = null;
      return;
    }
    const wasCollapsed = prevCollapsedCmxRef.current;
    prevCollapsedCmxRef.current = collapsed.cmx;
    if (collapsed.cmx) {
      if (wasCollapsed === false) {
        const currentWidth =
          latestLayoutRef.current.cmx ||
          useWorkspaceStore.getState().sizes.cmx;
        useWorkspaceStore.getState().setExpandedWidth("cmx", currentWidth);
      }
      cmxPanelRef.current?.resize(computeRailPct());
    } else if (wasCollapsed === true) {
      cmxPanelRef.current?.resize(
        useWorkspaceStore.getState().expandedWidths.cmx || PANEL_DEFAULTS.cmx,
      );
    }
  }, [collapsed.cmx, isDesktop]);

  useEffect(() => {
    if (!isDesktop) {
      prevCollapsedChatSidebarRef.current = null;
      return;
    }
    const wasCollapsed = prevCollapsedChatSidebarRef.current;
    prevCollapsedChatSidebarRef.current = collapsed.chatSidebar;
    if (collapsed.chatSidebar) {
      if (wasCollapsed === false) {
        const currentWidth =
          latestLayoutRef.current.chatSidebar ||
          useWorkspaceStore.getState().sizes.chatSidebar;
        useWorkspaceStore.getState().setExpandedWidth("chatSidebar", currentWidth);
      }
      chatSidebarPanelRef.current?.resize(computeRailPct());
    } else if (wasCollapsed === true) {
      chatSidebarPanelRef.current?.resize(
        useWorkspaceStore.getState().expandedWidths.chatSidebar ||
          PANEL_DEFAULTS.chatSidebar,
      );
    }
  }, [collapsed.chatSidebar, isDesktop]);

  /**
   * Compact mode has no resizable sidebars, so a persisted "collapsed" flag
   * has no surface there — and would render the rail presentation inside the
   * nav Sheet. Normalize it on leaving desktop; the saved expanded widths
   * restore the sidebars when returning.
   */
  useEffect(() => {
    if (isDesktop) return;
    const state = useWorkspaceStore.getState();
    if (state.collapsed.cmx) state.toggleCmx();
    if (state.collapsed.chatSidebar) state.toggleChatSidebar();
  }, [isDesktop]);

  /**
   * Layout reset (command palette "Reset workspace layout"): the store reset
   * alone does not move the already-mounted panels — imperatively re-sync
   * them to the canonical composition (11% sidebars or exact 48px rails,
   * 39% | 39% split). Nonce stays transient (never persisted).
   */
  const layoutResetNonce = useWorkspaceStore((s) => s.layoutResetNonce);
  useEffect(() => {
    if (layoutResetNonce === 0 || !isDesktop) return;
    const s = useWorkspaceStore.getState();
    const rp = computeRailPct();
    cmxPanelRef.current?.resize(s.collapsed.cmx ? rp : PANEL_DEFAULTS.cmx);
    if (s.section === "assistant") {
      chatSidebarPanelRef.current?.resize(
        s.collapsed.chatSidebar ? rp : PANEL_DEFAULTS.chatSidebar,
      );
      chatPanelRef.current?.resize(PANEL_DEFAULTS.chat);
      repoPanelRef.current?.resize(PANEL_DEFAULTS.repo);
    }
  }, [layoutResetNonce, isDesktop]);

  /* ---------------------------------------------------------------- */
  /* Panel focus (⌘1–4 + "cmx-focus-panel" event contract)             */
  /* ---------------------------------------------------------------- */
  const focusPanel = useCallback((index: number) => {
    const targets = [cmxFocusRef, chatSidebarFocusRef, chatFocusRef, repoFocusRef];
    targets[index - 1]?.current?.focus();
  }, []);

  useEffect(() => {
    const onFocusPanel = (event: Event) => {
      const detail = (event as CustomEvent<{ index?: number }>).detail;
      const index = detail?.index;
      if (typeof index !== "number" || index < 1 || index > 4) return;
      focusPanel(index);
    };
    window.addEventListener("cmx-focus-panel", onFocusPanel);
    return () => window.removeEventListener("cmx-focus-panel", onFocusPanel);
  }, [focusPanel]);

  /**
   * "cmx-open-palette" event contract (dispatched by OverviewPanel): opens
   * the command palette in the requested mode.
   */
  useEffect(() => {
    const onOpenPalette = (event: Event) => {
      const detail = (event as CustomEvent<{ filesMode?: boolean }>).detail;
      setPaletteFilesMode(Boolean(detail?.filesMode));
      useWorkspaceStore.getState().setPaletteOpen(true);
    };
    window.addEventListener("cmx-open-palette", onOpenPalette);
    return () => window.removeEventListener("cmx-open-palette", onOpenPalette);
  }, []);

  const openPalette = useCallback((filesMode: boolean) => {
    setPaletteFilesMode(filesMode);
    useWorkspaceStore.getState().setPaletteOpen(true);
  }, []);

  /* ---------------------------------------------------------------- */
  /* Keyboard shortcuts                                                */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      // Palette keys are store-driven and bind even inside inputs.
      if (key === "k") {
        event.preventDefault();
        setPaletteFilesMode(false);
        useWorkspaceStore.getState().setPaletteOpen(true);
        return;
      }
      if (key === "p") {
        event.preventDefault();
        setPaletteFilesMode(true);
        useWorkspaceStore.getState().setPaletteOpen(true);
        return;
      }
      // Phase 6 §2 — global search (Ctrl/Cmd+Shift+F).
      if (key === "f" && event.shiftKey) {
        event.preventDefault();
        useWorkspaceStore.getState().setSection("search");
        return;
      }
      // Inside an editable target, browser/monaco semantics win — EXCEPT the
      // palette keys above. Inside a Monaco editor, Monaco's own bindings
      // already handle goto-line / quick-outline; don't double-fire.
      const insideMonaco =
        event.target instanceof Element &&
        event.target.closest(".monaco-editor") !== null;
      if (isEditableTarget(event.target) || insideMonaco) return;

      // Phase 6 §2 — go-to-line (Ctrl/Cmd+G) routed to the active editor.
      if (key === "g" && !event.shiftKey) {
        event.preventDefault();
        dispatchEditorCommand("goto-line");
        return;
      }
      // Phase 6 §2 — go-to-symbol (Ctrl/Cmd+Shift+O).
      if (key === "o" && event.shiftKey) {
        event.preventDefault();
        dispatchEditorCommand("quick-outline");
        return;
      }
      // Alt+B — e.key is a dead-key glyph on some layouts, so accept KeyB too.
      const isB = key === "b" || event.code === "KeyB";
      if (isB && event.altKey) {
        if (!isDesktop || !isAssistantSection) return;
        event.preventDefault();
        useWorkspaceStore.getState().toggleChatSidebar();
        return;
      }
      if (isB) {
        if (!isDesktop) return;
        event.preventDefault();
        useWorkspaceStore.getState().toggleCmx();
        return;
      }
      if (key === "i") {
        event.preventDefault();
        useWorkspaceStore.getState().requestComposerFocus();
        return;
      }
      if (key === "1" || key === "2" || key === "3" || key === "4") {
        event.preventDefault();
        focusPanel(Number(key));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusPanel, isAssistantSection, isDesktop]);

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */
  if (!mounted) {
    return (
      <div
        role="status"
        aria-label="Loading workspace"
        className="flex h-screen items-center justify-center bg-background"
      >
        <LatticeLoader cellSize={7} label="Preparing workspace" />
      </div>
    );
  }

  /** Render-time rail percentage for persisted collapsed sidebars. */
  const railPct =
    typeof window !== "undefined" ? computeRailPct() : PANEL_DEFAULTS.cmx;

  const focusWrapperClass =
    "h-full w-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <TopNavigation onOpenPalette={openPalette} />

      {isDesktop ? (
        // motion: panel-enter — once, reduced-motion aware
        <FadeIn className="min-h-0 flex-1">
          <ResizablePanelGroup
            direction="horizontal"
            id="cmx-workspace-v2"
            className="min-h-0 flex-1"
            onLayout={handleLayout}
          >
            {/**
             * CodeMind X sidebar — present on every destination. Defaults to
             * 11%, adjustable between 11% and 15% while expanded
             * (PANEL_LIMITS); locked to the exact rail width while collapsed
             * (min === max === rail percentage disables the handle).
             */}
            <ResizablePanel
              ref={cmxPanelRef}
              id="cmx"
              order={1}
              minSize={collapsed.cmx ? railPct : PANEL_LIMITS.cmx.min}
              maxSize={collapsed.cmx ? railPct : PANEL_LIMITS.cmx.max}
              defaultSize={collapsed.cmx ? railPct : sizes.cmx}
            >
              <div
                ref={cmxFocusRef}
                tabIndex={-1}
                data-workspace-panel="cmx"
                className={focusWrapperClass}
              >
                <AISidebar variant="panel" />
              </div>
            </ResizablePanel>

            {/* Sidebar boundary — resizable 11–15% while expanded, inert while collapsed. */}
            <PanelResizer disabled={collapsed.cmx} />

            {isAssistantSection ? (
              <>
                {/*
                 * AI chat sidebar — Assistant-scoped chrome.
                 */}
                <ResizablePanel
                  ref={chatSidebarPanelRef}
                  id="chat-sidebar"
                  order={2}
                  minSize={collapsed.chatSidebar ? railPct : PANEL_LIMITS.chatSidebar.min}
                  maxSize={collapsed.chatSidebar ? railPct : PANEL_LIMITS.chatSidebar.max}
                  defaultSize={collapsed.chatSidebar ? railPct : sizes.chatSidebar}
                >
                  <div
                    ref={chatSidebarFocusRef}
                    tabIndex={-1}
                    data-workspace-panel="chat-sidebar"
                    className={focusWrapperClass}
                  >
                    <AIChatSidebar />
                  </div>
                </ResizablePanel>

                {/* Sidebar boundary — resizable 11–15% while expanded, inert while collapsed. */}
                <PanelResizer disabled={collapsed.chatSidebar} />

                <ResizablePanel
                  ref={chatPanelRef}
                  id="chat"
                  order={3}
                  minSize={PANEL_LIMITS.chat.min}
                  maxSize={PANEL_LIMITS.chat.max}
                  defaultSize={sizes.chat}
                >
                  <div
                    ref={chatFocusRef}
                    tabIndex={-1}
                    data-workspace-panel="chat"
                    className={focusWrapperClass}
                  >
                    <ChatAreaRouter />
                  </div>
                </ResizablePanel>

                <PanelResizer />

                {/*
                 * VSCode-style repository workspace — Assistant-scoped chrome.
                 */}
                <ResizablePanel
                  ref={repoPanelRef}
                  id="repo"
                  order={4}
                  minSize={PANEL_LIMITS.repo.min}
                  maxSize={PANEL_LIMITS.repo.max}
                  defaultSize={sizes.repo}
                >
                  <div
                    ref={repoFocusRef}
                    tabIndex={-1}
                    data-workspace-panel="repo"
                    className={focusWrapperClass}
                  >
                    <RepositoryWorkspaceShell />
                  </div>
                </ResizablePanel>
              </>
            ) : (
              /*
               * Focused destination layout — the main area is the destination
               * (overview / repository page / search / settings / planned).
               */
              <ResizablePanel id="destination-main" order={2}>
                <div
                  ref={chatFocusRef}
                  tabIndex={-1}
                  data-workspace-panel="main"
                  className={focusWrapperClass}
                >
                  <ChatAreaRouter />
                </div>
              </ResizablePanel>
            )}
          </ResizablePanelGroup>
        </FadeIn>
      ) : (
        <div className="flex min-h-0 flex-1">
          {isTablet ? <AISidebar variant="rail" /> : null}
          {/* motion: panel-enter — once, reduced-motion aware */}
          <FadeIn className="min-h-0 flex-1">
            <ChatAreaRouter />
          </FadeIn>
        </div>
      )}

      {/* COMPACT sheets — closed (render nothing) until opened on <1024px.
          The AI chats + repository sheets are Assistant-scoped: their open
          triggers only exist on the Assistant destination. */}
      <Sheet open={!isDesktop && navSheetOpen} onOpenChange={setNavSheetOpen}>
        <SheetContent side="left" className="w-3/4 gap-0 sm:max-w-sm">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">
            CodeMind X destination navigation.
          </SheetDescription>
          <div className="min-h-0 flex-1">
            <AISidebar variant="panel" />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet
        open={!isDesktop && isAssistantSection && chatSidebarSheetOpen}
        onOpenChange={setChatSidebarSheetOpen}
      >
        <SheetContent
          side="left"
          className="w-[min(85vw,320px)] gap-0 sm:max-w-[320px]"
        >
          <SheetTitle className="sr-only">AI chats</SheetTitle>
          <SheetDescription className="sr-only">
            Conversation history.
          </SheetDescription>
          <div className="min-h-0 flex-1">
            <AIChatSidebar embedded />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet
        open={!isDesktop && isAssistantSection && repoSheetOpen}
        onOpenChange={setRepoSheetOpen}
      >
        <SheetContent
          side="right"
          className="w-[min(94vw,640px)] gap-0 p-0 sm:max-w-[640px]"
        >
          <SheetTitle className="sr-only">Repository</SheetTitle>
          <SheetDescription className="sr-only">
            Repository workspace files and tabs.
          </SheetDescription>
          <div className="min-h-0 flex-1">
            <RepositoryWorkspaceShell />
          </div>
        </SheetContent>
      </Sheet>

      <CommandPalette
        filesMode={paletteFilesMode}
        onFilesModeChange={setPaletteFilesMode}
      />
    </div>
  );
}
