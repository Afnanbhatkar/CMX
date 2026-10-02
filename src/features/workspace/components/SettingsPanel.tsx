"use client";

/**
 * CodeMind X V2 — workspace settings (chat area when section === "settings").
 *
 * Real settings only: live panel sizes from the store with a working layout
 * reset, the full keyboard shortcut reference, an honest data/persistence
 * note and a build footer. Nothing here pretends to configure a backend.
 */

import { RotateCcw } from "lucide-react";

import { FadeIn } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { useWorkspaceStore } from "@/stores/workspace-store";

const kbdClass =
  "inline-flex h-5 select-none items-center rounded border border-border-subtle bg-surface-elevated px-1.5 font-mono text-[11px] font-medium text-foreground/85";

interface ShortcutRow {
  keys: string;
  description: string;
}

const SHORTCUTS: ShortcutRow[] = [
  { keys: "⌘K", description: "Command palette" },
  { keys: "⌘P", description: "Open file…" },
  { keys: "⌘B", description: "Toggle CodeMind X sidebar" },
  { keys: "⌘⌥B", description: "Toggle AI chat sidebar" },
  { keys: "⌘I", description: "Focus AI composer" },
  { keys: "⌘1–4", description: "Focus workspace panels" },
];

export function SettingsPanel() {
  const sizes = useWorkspaceStore((s) => s.sizes);
  const resetLayout = useWorkspaceStore((s) => s.resetLayout);

  const sizeEntries: { label: string; value: number }[] = [
    { label: "CodeMind X", value: sizes.cmx },
    { label: "AI chat sidebar", value: sizes.chatSidebar },
    { label: "AI chat area", value: sizes.chat },
    { label: "Repository", value: sizes.repo },
  ];

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      {/* motion: panel-enter (once, reduced-motion aware) */}
      <FadeIn className="mx-auto max-w-2xl space-y-6 p-6">
        <div>
          <h1 className="text-lg font-semibold">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Workspace-level settings for this browser session.
          </p>
        </div>

        {/* Layout */}
        <section className="space-y-3 rounded-lg border border-border-subtle bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium">Layout</h2>
            <Button size="sm" variant="outline" onClick={() => resetLayout()}>
              <RotateCcw aria-hidden="true" />
              Reset layout
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {sizeEntries.map((entry) => (
              <div
                key={entry.label}
                className="rounded-md border border-border-subtle bg-surface-elevated px-2.5 py-2"
              >
                <div className="truncate text-[11px] text-muted-foreground">
                  {entry.label}
                </div>
                <div className="font-mono text-[13px] text-foreground/90">
                  {entry.value.toFixed(1)}%
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Shortcuts */}
        <section className="space-y-2 rounded-lg border border-border-subtle bg-surface p-4">
          <h2 className="text-sm font-medium">Keyboard shortcuts</h2>
          <p className="text-[11px] text-muted-foreground">
            ⌘ on macOS — the same shortcuts work with Ctrl on Windows/Linux.
          </p>
          <ul className="divide-y divide-border-subtle">
            {SHORTCUTS.map((shortcut) => (
              <li
                key={shortcut.keys}
                className="flex items-center justify-between gap-3 py-1.5"
              >
                <span className="text-[13px] text-foreground/85">
                  {shortcut.description}
                </span>
                <kbd className={kbdClass}>{shortcut.keys}</kbd>
              </li>
            ))}
          </ul>
        </section>

        {/* Data — honest persistence note */}
        <section className="space-y-1.5 rounded-lg border border-border-subtle bg-surface p-4">
          <h2 className="text-sm font-medium">Data</h2>
          <p className="text-[13px] text-foreground/85">
            Conversations and layout persist in this browser&apos;s localStorage
            (schema v1). No secrets, tokens or file contents are stored.
          </p>
        </section>

        {/* About */}
        <section className="space-y-1.5 rounded-lg border border-border-subtle bg-surface p-4">
          <h2 className="text-sm font-medium">About</h2>
          <p className="text-[13px] text-foreground/85">
            CodeMind X — Phase 2 workspace shell · Next.js 16 · React 19 · Bun
          </p>
          <p className="text-[11px] text-muted-foreground">
            Later phases plug repository intelligence, search, agents, Git and
            security engines into this shell.
          </p>
        </section>
      </FadeIn>
    </div>
  );
}
