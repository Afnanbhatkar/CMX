"use client";

/**
 * CodeMind X V2 — source control view (Phase 2, real meta only).
 *
 * Shows the REAL repository name + git branch from /api/repository/meta
 * (via useRepositoryMeta) and honestly states that Git intelligence (commit
 * history, working-tree status, branches) arrives in a later phase.
 * No commits, graphs or diffs are simulated.
 */

import { GitBranch } from "lucide-react";

import { useRepositoryMeta } from "@/features/workspace/use-repository-meta";
import { Skeleton } from "@/components/ui/skeleton";

export function GitPanel() {
  const { meta, loading, error } = useRepositoryMeta();

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-[12px]">
      {loading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-4 w-32" />
        </div>
      ) : error || !meta ? (
        <p className="text-muted-foreground">Repository metadata is unavailable right now.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <GitBranch className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-mono text-foreground/90">
            {meta.repository.branch ?? "Not connected"}
          </span>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <span className="truncate text-foreground/85">{meta.repository.name}</span>
          {meta.repository.connected ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-success">
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-success" />
              Connected (read-only)
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">Not connected</span>
          )}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Commit history, working-tree status, branches and Git intelligence arrive in a later phase.
        No repository data is simulated.
      </p>
    </div>
  );
}
