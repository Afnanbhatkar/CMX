"use client";

/**
 * CodeMind X V2 — root component of the four-panel AI workspace shell.
 *
 * Composition (spec §29):
 * - TopNavigation (h-12) on every breakpoint.
 * - DESKTOP (≥1024px): ResizablePanelGroup "cmx-workspace-v1" with four
 *   panels — CodeMind X sidebar | AI chat sidebar | AI chat area | Repository
 *   — persisted via the workspace store (sizes + collapsed + expand widths).
 * - COMPACT (<1024px): persistent icon rail on tablets (≥768px), main chat
 *   area, and Sheets for navigation / chat sidebar / repository.
 * - CommandPalette mounted once, driven by store.paletteOpen plus a small
 *   `paletteFilesMode` React state (⌘K commands / ⌘P files).
 *
 * Sidebar collapse logic: when a sidebar flips to collapsed, its current
 * width is saved (`setExpandedWidth`) and the panel is resized to the rail
 * percentage; when it expands again the saved width is restored. The handle
 * before a collapsed sidebar is disabled.
 *
 * Panel focus contract: ⌘1–4 focuses the four panel wrappers. Other code can
 * dispatch the window CustomEvent "cmx-focus-panel" with `detail: {index}`
 * (1..4) — used by the command palette. "cmx-open-palette" with
 * `detail: {filesMode}` opens the palette in that mode (see OverviewPanel).
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

/** Collapsed rail width as a percentage of the viewport, clamped to limits. */
function computeRailPct(): number {
  const raw = (RAIL_PX / window.innerWidth) * 100;
  return Math.min(
    PANEL_LIMITS.cmx.max,
    Math.max(PANEL_LIMITS.cmx.min, raw),
  );
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
  const navSheetOpen = useWorkspaceStore((s) => s.navSheetOpen);
  const chatSidebarSheetOpen = useWorkspaceStore((s) => s.chatSidebarSheetOpen);
  const repoSheetOpen = useWorkspaceStore((s) => s.repoSheetOpen);
  const setNavSheetOpen = useWorkspaceStore((s) => s.setNavSheetOpen);
  const setChatSidebarSheetOpen = useWorkspaceStore((s) => s.setChatSidebarSheetOpen);
  const setRepoSheetOpen = useWorkspaceStore((s) => s.setRepoSheetOpen);

  /* Command palette mode (⌘K commands / ⌘P files). */
  const [paletteFilesMode, setPaletteFilesMode] = useState(false);

  /* Panel imperative handles + focus targets. */
  const cmxPanelRef = useRef<ImperativePanelHandle | null>(null);
  const chatSidebarPanelRef = useRef<ImperativePanelHandle | null>(null);
  const cmxFocusRef = useRef<HTMLDivElement | null>(null);
  const chatSidebarFocusRef = useRef<HTMLDivElement | null>(null);
  const chatFocusRef = useRef<HTMLDivElement | null>(null);
  const repoFocusRef = useRef<HTMLDivElement | null>(null);

  /* Latest layout from onLayout — the "current panel size" for collapse. */
  const latestLayoutRef = useRef<PanelSizes>({ ...PANEL_DEFAULTS });

  const handleLayout = useCallback((layout: number[]) => {
    const next: PanelSizes = {
      cmx: layout[0] ?? 0,
      chatSidebar: layout[1] ?? 0,
      chat: layout[2] ?? 0,
      repo: layout[3] ?? 0,
    };
    latestLayoutRef.current = next;
    useWorkspaceStore.getState().setSizes(next);
  }, []);

  /**
   * Collapse/expand flips. `defaultSize` covers the initial mount (including
   * a persisted collapsed state); only actual flips need imperative resizes,
   * so the first run on desktop is observed but skipped.
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
      if (isEditableTarget(event.target)) return;
      // Alt+B — e.key is a dead-key glyph on some layouts, so accept KeyB too.
      const isB = key === "b" || event.code === "KeyB";
      if (isB && event.altKey) {
        if (!isDesktop) return;
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
  }, [focusPanel, isDesktop]);

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
  const railPctSize =
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
            id="cmx-workspace-v1"
            className="min-h-0 flex-1"
            onLayout={handleLayout}
          >
            <ResizablePanel
              ref={cmxPanelRef}
              id="cmx"
              order={1}
              minSize={PANEL_LIMITS.cmx.min}
              maxSize={PANEL_LIMITS.cmx.max}
              defaultSize={collapsed.cmx ? railPctSize : sizes.cmx}
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

            <PanelResizer disabled={collapsed.cmx} />

            <ResizablePanel
              ref={chatSidebarPanelRef}
              id="chat-sidebar"
              order={2}
              minSize={PANEL_LIMITS.chatSidebar.min}
              maxSize={PANEL_LIMITS.chatSidebar.max}
              defaultSize={collapsed.chatSidebar ? railPctSize : sizes.chatSidebar}
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

            <PanelResizer disabled={collapsed.chatSidebar} />

            <ResizablePanel
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

            <ResizablePanel
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

      {/* COMPACT sheets — closed (render nothing) until opened on <1024px */}
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
        open={!isDesktop && chatSidebarSheetOpen}
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
        open={!isDesktop && repoSheetOpen}
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
