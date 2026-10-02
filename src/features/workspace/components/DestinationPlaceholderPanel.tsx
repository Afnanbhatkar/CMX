"use client";

/**
 * CodeMind X V2 — honest placeholder for planned destinations.
 *
 * Shown in the chat area when the active section is a planned destination.
 * It states exactly what it is: a wired extension point for a future engine
 * UI — never a simulated feature (RULES §9).
 */

import { FadeIn } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { DESTINATION_MAP } from "../registry";
import type { WorkspaceSectionId } from "../types";

export interface DestinationPlaceholderPanelProps {
  sectionId: WorkspaceSectionId;
}

export function DestinationPlaceholderPanel({
  sectionId,
}: DestinationPlaceholderPanelProps) {
  const setSection = useWorkspaceStore((s) => s.setSection);
  const destination = DESTINATION_MAP[sectionId];

  if (!destination) {
    // Unreachable with the current registry — kept honest and typed anyway.
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <p className="max-w-md text-sm text-muted-foreground">
          This destination ({sectionId}) is not registered yet.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      {/* motion: panel-enter (once, reduced-motion aware) */}
      <FadeIn className="mx-auto my-auto max-w-md p-8 text-center">
        <span
          aria-hidden="true"
          className="mx-auto flex size-14 items-center justify-center rounded-full border border-border-subtle bg-surface"
        >
          <destination.icon className="size-8 text-muted-foreground" />
        </span>
        <h1 className="mt-4 text-base font-medium">{destination.label}</h1>
        {destination.note ? (
          <p className="mt-1.5 text-sm text-muted-foreground">{destination.note}</p>
        ) : null}
        <p className="mt-3 text-sm text-muted-foreground">
          This destination is a wired extension point for the{" "}
          {destination.label} engine&apos;s future UI. Nothing is simulated
          here.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-5"
          onClick={() => setSection("assistant")}
        >
          Back to Assistant
        </Button>
      </FadeIn>
    </div>
  );
}
