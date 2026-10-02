"use client";

/**
 * CodeMind X V2 — workspace overview (chat area when section === "overview").
 *
 * Renders the REAL capability status of this build from the workspace
 * registry — available destinations and honestly-labeled planned ones — plus
 * quick actions that only trigger real behavior. No simulated statistics.
 */

import { useCallback } from "react";
import { Plus } from "lucide-react";

import { FadeIn } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { WORKSPACE_DESTINATIONS } from "../registry";

/**
 * Palette-open event contract (documented alongside "cmx-focus-panel"):
 * AIWorkspace listens for "cmx-open-palette" with `detail: { filesMode }` and
 * opens the command palette in that mode. Used by surfaces that cannot
 * receive props (ChatAreaRouter has none by contract).
 */
function openFilePalette() {
  window.dispatchEvent(
    new CustomEvent("cmx-open-palette", { detail: { filesMode: true } }),
  );
}

export function OverviewPanel() {
  const newConversation = useWorkspaceStore((s) => s.newConversation);
  const setRepoSheetOpen = useWorkspaceStore((s) => s.setRepoSheetOpen);

  const onOpenFile = useCallback(() => {
    openFilePalette();
  }, []);

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      {/* motion: panel-enter (once, reduced-motion aware) */}
      <FadeIn className="mx-auto max-w-2xl space-y-6 p-6">
        <div>
          <h1 className="text-lg font-semibold">Workspace overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You are inside the CodeMind X AI software engineering workspace.
            Phase 2 ships the shell below — engines plug into it in later
            phases.
          </p>
        </div>

        <section aria-label="Capability status">
          <div className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle">
            {WORKSPACE_DESTINATIONS.map((destination) => {
              const planned = destination.availability === "planned";
              return (
                <div key={destination.id} className="flex items-start gap-3 px-3 py-2.5">
                  <destination.icon
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">{destination.label}</div>
                    {planned && destination.note ? (
                      <div className="mt-0.5 text-[11px] text-muted-foreground italic">
                        {destination.note}
                      </div>
                    ) : null}
                  </div>
                  {planned ? (
                    <span className="flex shrink-0 items-center gap-1.5 pt-0.5 text-xs text-muted-foreground">
                      <span
                        aria-hidden="true"
                        className="size-1.5 rounded-full bg-muted-foreground/50"
                      />
                      Planned
                    </span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-1.5 pt-0.5 text-xs text-success">
                      <span
                        aria-hidden="true"
                        className="size-1.5 rounded-full bg-success"
                      />
                      Available
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section aria-label="Quick actions" className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => newConversation()}>
            <Plus aria-hidden="true" />
            New chat
          </Button>
          <Button size="sm" variant="outline" onClick={onOpenFile}>
            Open file
          </Button>
          <Button size="sm" variant="outline" onClick={() => setRepoSheetOpen(true)}>
            Open repository
          </Button>
        </section>

        <p className="text-[11px] text-muted-foreground">
          Everything shown reflects the real capability state of this build.
          Nothing here is simulated.
        </p>
      </FadeIn>
    </div>
  );
}
