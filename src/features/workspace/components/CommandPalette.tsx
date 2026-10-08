"use client";

/**
 * CodeMind X V2 — command palette (⌘K commands / ⌘P files).
 *
 * Commands mode only runs REAL actions (navigation, layout, composer focus).
 * Capabilities that do not exist in this build are listed under "Later
 * phases" as disabled items with their honest reason (RULES §9).
 *
 * Files mode fetches the real workspace tree from /api/repository/tree once
 * per open (60s ref cache, aborted on close) and opens the selected file via
 * the EditorNavigationService.
 *
 * Focus commands dispatch the window CustomEvent "cmx-focus-panel" with
 * `detail: { index: 1..4 }` (1 CodeMind X sidebar, 2 AI chat sidebar,
 * 3 AI chat area, 4 Repository) — handled by AIWorkspace.
 */

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Bug,
  ClipboardCheck,
  Code2,
  File,
  FlaskConical,
  Focus,
  FolderGit2,
  GitBranch,
  GitCompareArrows,
  History,
  Loader2,
  MessageSquare,
  Network,
  PanelLeft,
  Paperclip,
  Plus,
  Repeat,
  RotateCcw,
  ScanText,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { ComposerMode } from "@/features/workspace/assistant/contracts";
import { editorNavigation } from "../editor-navigation";
import { navigationHistory } from "../editor/navigation-history";
import { getDebugCapability } from "../debug/dap-contracts";
import type { RepoTreeNode } from "../types";
import { useAssistantRun } from "../chat/use-assistant-run";
import { useChatUiStore } from "../chat/chat-ui-store";

export interface CommandPaletteProps {
  filesMode: boolean;
  onFilesModeChange: (v: boolean) => void;
}

/** Tree cache lifetime for the files mode (milliseconds). */
const FILES_TTL_MS = 60_000;

function flattenFiles(nodes: RepoTreeNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type === "file") {
      out.push(node.path);
    } else if (Array.isArray(node.children) && node.children.length > 0) {
      flattenFiles(node.children, out);
    }
  }
  return out;
}

interface PaletteCommand {
  id: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  enabled?: boolean;
  disabledReason?: string;
  run: () => void;
}

export function CommandPalette({ filesMode, onFilesModeChange }: CommandPaletteProps) {
  const open = useWorkspaceStore((s) => s.paletteOpen);
  const setPaletteOpen = useWorkspaceStore((s) => s.setPaletteOpen);
  const setSection = useWorkspaceStore((s) => s.setSection);
  const newConversation = useWorkspaceStore((s) => s.newConversation);
  const requestComposerFocus = useWorkspaceStore((s) => s.requestComposerFocus);
  const setRepoSheetOpen = useWorkspaceStore((s) => s.setRepoSheetOpen);
  const setRepoRailView = useWorkspaceStore((s) => s.setRepoRailView);
  const toggleCmx = useWorkspaceStore((s) => s.toggleCmx);
  const toggleChatSidebar = useWorkspaceStore((s) => s.toggleChatSidebar);
  const resetLayout = useWorkspaceStore((s) => s.resetLayout);

  const mode = filesMode ? "files" : "commands";

  /* Composer commands (Phase 8A) — modes, attach, cancel, regenerate. */
  const composerMode = useChatUiStore((s) => s.mode);
  const setComposerMode = useChatUiStore((s) => s.setMode);
  const requestAttachFile = useChatUiStore((s) => s.requestAttachFile);
  const { stop: stopAssistantRun, regenerate: regenerateAssistantRun, isGenerating } =
    useAssistantRun();
  const lastIsAssistant = useWorkspaceStore((s) => {
    const conversation = s.conversations.find((c) => c.id === s.activeConversationId);
    const messages = conversation?.messages ?? [];
    return messages.length > 0 && messages[messages.length - 1].role === "assistant";
  });

  const runComposerCommand = (action: () => void) => {
    setSection("assistant");
    action();
    close();
  };

  const composerModeCommand = (
    id: string,
    target: ComposerMode,
    icon: LucideIcon,
    shortcut: string,
  ): PaletteCommand => ({
    id,
    label: `Composer mode: ${target[0]!.toUpperCase()}${target.slice(1)}`,
    icon,
    shortcut,
    run: () => runComposerCommand(() => setComposerMode(target)),
  });

  const [fileState, setFileState] = useState<{
    status: "loading" | "ready" | "error";
    files: string[];
  }>({ status: "loading", files: [] });
  const filesCacheRef = useRef<{ files: string[] | null; at: number }>({
    files: null,
    at: 0,
  });

  const close = () => setPaletteOpen(false);

  const focusPanel = (index: number) => {
    window.dispatchEvent(
      new CustomEvent("cmx-focus-panel", { detail: { index } }),
    );
  };

  /* ---------------------------------------------------------------- */
  /* Files mode — real workspace tree, fetched once per open (60s TTL) */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    if (!open || mode !== "files") return;

    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      // Yield first so no state update happens synchronously inside the
      // effect body (react-hooks/set-state-in-effect).
      await Promise.resolve();
      if (cancelled) return;

      const cached = filesCacheRef.current;
      if (cached.files && Date.now() - cached.at < FILES_TTL_MS) {
        setFileState({ status: "ready", files: cached.files });
        return;
      }

      setFileState((s) =>
        s.status === "loading" ? s : { status: "loading", files: [] },
      );
      try {
        const res = await fetch("/api/repository/tree", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; tree?: RepoTreeNode[] }
          | null;
        const files =
          data?.ok && Array.isArray(data.tree) ? flattenFiles(data.tree) : null;
        if (cancelled) return;
        if (files === null) {
          setFileState({ status: "error", files: [] });
          return;
        }
        filesCacheRef.current = { files, at: Date.now() };
        setFileState({ status: "ready", files });
      } catch {
        if (!cancelled) setFileState({ status: "error", files: [] });
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [open, mode]);

  /* ---------------------------------------------------------------- */
  /* Command groups (commands mode)                                    */
  /* ---------------------------------------------------------------- */
  const commandGroups: { heading: string; commands: PaletteCommand[] }[] = [
    {
      heading: "Workspace",
      commands: [
        {
          id: "open-file",
          label: "Open file…",
          icon: File,
          shortcut: "⌘P",
          run: () => onFilesModeChange(true),
        },
        {
          id: "ask-ai",
          label: "Ask AI",
          icon: Sparkles,
          run: () => {
            setSection("assistant");
            requestComposerFocus();
            close();
          },
        },
        {
          id: "new-chat",
          label: "New chat",
          icon: Plus,
          run: () => {
            newConversation();
            close();
          },
        },
        {
          id: "search-files",
          label: "Search files",
          icon: Search,
          shortcut: "⌘⇧F",
          run: () => {
            setSection("search");
            close();
          },
        },
        {
          id: "open-ocr-studio",
          label: "Open OCR Studio",
          icon: ScanText,
          run: () => {
            setSection("ocr");
            close();
          },
        },
        {
          id: "nav-back",
          label: "Navigate back",
          icon: ArrowLeft,
          shortcut: "Alt+←",
          run: () => {
            navigationHistory.back();
            close();
          },
        },
        {
          id: "nav-forward",
          label: "Navigate forward",
          icon: ArrowRight,
          shortcut: "Alt+→",
          run: () => {
            navigationHistory.forward();
            close();
          },
        },
        {
          id: "nav-bookmark",
          label: "Toggle bookmark on active file",
          icon: Bookmark,
          run: () => {
            const path = useWorkspaceStore.getState().activeTabPath;
            if (path) navigationHistory.toggleBookmark(path);
            close();
          },
        },
        {
          id: "nav-recent",
          label: "Recent locations",
          icon: History,
          run: () => {
            const recent = navigationHistory.recentLocations();
            if (recent.length > 0) {
              void editorNavigation.openRange(
                recent[0]!.path,
                recent[0]!.line ?? 1,
                recent[0]!.line ?? 1,
                "manual",
              );
            }
            close();
          },
        },
        {
          id: "open-repository",
          label: "Open repository panel",
          icon: FolderGit2,
          run: () => {
            setRepoSheetOpen(true);
            close();
          },
        },
        {
          id: "open-source-control",
          label: "Open source control",
          icon: GitBranch,
          run: () => {
            setRepoRailView("git");
            setRepoSheetOpen(true);
            close();
          },
        },
        {
          id: "focus-composer",
          label: "Focus AI composer",
          icon: Sparkles,
          shortcut: "⌘I",
          run: () => {
            requestComposerFocus();
            close();
          },
        },
      ],
    },
    {
      heading: "Composer",
      commands: [
        composerModeCommand("composer-mode-search", "search", Search, "Alt+1"),
        composerModeCommand("composer-mode-code", "code", Code2, "Alt+2"),
        composerModeCommand("composer-mode-agent", "agent", Workflow, "Alt+3"),
        composerModeCommand("composer-mode-loop", "loop", Repeat, "Alt+4"),
        {
          id: "composer-cycle-mode",
          label: `Composer: cycle mode (current: ${composerMode})`,
          icon: Workflow,
          shortcut: "Alt+M",
          run: () =>
            runComposerCommand(() => {
              const order: ComposerMode[] = ["search", "code", "agent", "loop"];
              const current = order.indexOf(useChatUiStore.getState().mode);
              setComposerMode(order[(current + 1) % order.length]!);
            }),
        },
        {
          id: "composer-attach-file",
          label: "Attach a repository file to composer",
          icon: Paperclip,
          run: () => runComposerCommand(requestAttachFile),
        },
        {
          id: "composer-cancel-run",
          label: "Cancel assistant run",
          icon: Square,
          enabled: isGenerating,
          disabledReason: "No assistant run is active.",
          run: () => {
            stopAssistantRun();
            close();
          },
        },
        {
          id: "composer-regenerate",
          label: "Regenerate last response",
          icon: RotateCcw,
          enabled: lastIsAssistant && !isGenerating,
          disabledReason: "The latest message must be an assistant reply.",
          run: () => {
            regenerateAssistantRun();
            close();
          },
        },
      ],
    },
    {
      heading: "View",
      commands: [
        {
          id: "toggle-cmx",
          label: "Toggle CodeMind X sidebar",
          icon: PanelLeft,
          shortcut: "⌘B",
          run: () => {
            toggleCmx();
            close();
          },
        },
        {
          id: "toggle-chat-sidebar",
          label: "Toggle AI chat sidebar",
          icon: MessageSquare,
          shortcut: "⌘⌥B",
          run: () => {
            toggleChatSidebar();
            close();
          },
        },
        {
          id: "reset-layout",
          label: "Reset workspace layout",
          icon: RotateCcw,
          run: () => {
            resetLayout();
            close();
          },
        },
        {
          id: "focus-cmx",
          label: "Focus CodeMind X sidebar",
          icon: Focus,
          shortcut: "⌘1",
          run: () => {
            focusPanel(1);
            close();
          },
        },
        {
          id: "focus-chat-sidebar",
          label: "Focus AI chat sidebar",
          icon: Focus,
          shortcut: "⌘2",
          run: () => {
            focusPanel(2);
            close();
          },
        },
        {
          id: "focus-chat",
          label: "Focus AI chat area",
          icon: Focus,
          shortcut: "⌘3",
          run: () => {
            focusPanel(3);
            close();
          },
        },
        {
          id: "focus-repo",
          label: "Focus Repository",
          icon: Focus,
          shortcut: "⌘4",
          run: () => {
            focusPanel(4);
            close();
          },
        },
      ],
    },
    {
      heading: "Later phases",
      commands: [
        {
          id: "start-debugging",
          label: "Start Debugging",
          icon: Bug,
          enabled: false,
          disabledReason: getDebugCapability().reason,
          run: () => {},
        },
        {
          id: "analyze-security",
          label: "Analyze Security",
          icon: ShieldCheck,
          enabled: false,
          disabledReason: "Security intelligence arrives in a later phase.",
          run: () => {},
        },
        {
          id: "generate-tests",
          label: "Generate Tests",
          icon: FlaskConical,
          enabled: false,
          disabledReason: "Testing intelligence arrives in a later phase.",
          run: () => {},
        },
        {
          id: "architecture-graph",
          label: "Open Architecture graph",
          icon: Network,
          enabled: false,
          disabledReason: "Architecture intelligence arrives in a later phase.",
          run: () => {},
        },
        {
          id: "run-evaluation",
          label: "Run Evaluation",
          icon: ClipboardCheck,
          enabled: false,
          disabledReason: "Evaluation arrives in a later phase.",
          run: () => {},
        },
        {
          id: "create-branch",
          label: "Create Branch",
          icon: GitBranch,
          enabled: false,
          disabledReason: "Git operations arrive in a later phase.",
          run: () => {},
        },
        {
          id: "compare-branches",
          label: "Compare Branches",
          icon: GitCompareArrows,
          enabled: false,
          disabledReason: "Git operations arrive in a later phase.",
          run: () => {},
        },
        {
          id: "git-intelligence",
          label: "Git Intelligence",
          icon: GitBranch,
          enabled: false,
          disabledReason: "Git intelligence arrives in a later phase.",
          run: () => {},
        },
        {
          id: "repository-settings",
          label: "Repository Settings",
          icon: Settings,
          enabled: false,
          disabledReason: "Repository settings arrive in a later phase.",
          run: () => {},
        },
      ],
    },
  ];

  return (
    <CommandDialog
      open={open}
      onOpenChange={setPaletteOpen}
      title={mode === "files" ? "Open file" : "Command palette"}
      description={
        mode === "files"
          ? "Search a real workspace file to open…"
          : "Search for a command to run…"
      }
    >
      {/* key={mode} remounts the input so switching modes clears the query. */}
      <CommandInput
        key={mode}
        placeholder={mode === "files" ? "Search files…" : "Type a command or search…"}
      />
      <CommandList>
        {mode === "commands" ? (
          <>
            {commandGroups.map((group) => (
              <CommandGroup key={group.heading} heading={group.heading}>
                {group.commands.map((command) => {
                  const enabled = command.enabled !== false;
                  return (
                    <CommandItem
                      key={command.id}
                      value={`${command.label} ${command.id}`}
                      disabled={!enabled}
                      onSelect={() => {
                        if (!enabled) return;
                        command.run();
                      }}
                      className="text-[13px]"
                    >
                      <command.icon className="size-4 shrink-0" aria-hidden="true" />
                      <span>{command.label}</span>
                      {enabled && command.shortcut ? (
                        <CommandShortcut className="font-mono">
                          {command.shortcut}
                        </CommandShortcut>
                      ) : null}
                      {!enabled && command.disabledReason ? (
                        <span className="ml-auto max-w-[55%] truncate pl-4 text-[11px] text-muted-foreground">
                          {command.disabledReason}
                        </span>
                      ) : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
            <CommandEmpty>No commands found.</CommandEmpty>
          </>
        ) : (
          <>
            {fileState.status === "loading" && (
              <CommandItem
                disabled
                value="loading-files"
                className="pointer-events-none text-muted-foreground"
              >
                <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
                <span>Loading files…</span>
              </CommandItem>
            )}
            {fileState.status === "error" && (
              <CommandItem
                disabled
                value="file-tree-unavailable"
                className="pointer-events-none text-muted-foreground"
              >
                <File className="size-4 shrink-0" aria-hidden="true" />
                <span>File tree unavailable.</span>
              </CommandItem>
            )}
            {fileState.status === "ready" &&
              fileState.files.map((path) => (
                <CommandItem
                  key={path}
                  value={path}
                  onSelect={() => {
                    close();
                    void editorNavigation.open({
                      filePath: path,
                      sourceContext: "palette",
                    });
                  }}
                  className="font-mono text-xs"
                >
                  <File className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{path}</span>
                </CommandItem>
              ))}
            <CommandEmpty>No files found.</CommandEmpty>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
