"use client";

/**
 * CodeMind X V2 — real filename search over the workspace tree
 * (chat area when section === "search").
 *
 * Fetches /api/repository/tree once on mount, flattens it to file paths and
 * filters by name substring. Selecting a result opens the file through the
 * EditorNavigationService. Hybrid code search arrives in a later phase —
 * this panel says so instead of pretending.
 */

import { useEffect, useMemo, useState } from "react";
import { File, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { editorNavigation } from "../editor-navigation";
import type { RepoTreeNode } from "../types";

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

type LoadState = "loading" | "ready" | "error";

export function SearchFilesPanel() {
  const [state, setState] = useState<LoadState>("loading");
  const [files, setFiles] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      // Yield first so no state update happens synchronously inside the
      // effect body (react-hooks/set-state-in-effect).
      await Promise.resolve();
      if (cancelled) return;
      try {
        const res = await fetch("/api/repository/tree", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; tree?: RepoTreeNode[] }
          | null;
        const flattened =
          data?.ok && Array.isArray(data.tree) ? flattenFiles(data.tree) : null;
        if (cancelled) return;
        if (flattened === null) {
          setState("error");
          return;
        }
        setFiles(flattened);
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [reloadNonce]);

  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return files;
    return files.filter((path) => path.toLowerCase().includes(query));
  }, [files, filter]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mx-auto flex w-full max-w-2xl min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-6">
        <div>
          <h1 className="text-lg font-semibold">Code search</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Filters real workspace files by name. Hybrid code search arrives in
            a later phase.
          </p>
        </div>

        <div className="relative shrink-0">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter files by name…"
            aria-label="Filter files by name"
            className="h-9 pl-8 text-[13px]"
          />
        </div>

        <div className="shrink-0 text-[11px] text-muted-foreground">
          {state === "ready" ? `${filtered.length} files` : null}
        </div>

        {state === "loading" && (
          <div className="space-y-1.5" role="status" aria-label="Loading files">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-[92%]" />
            <Skeleton className="h-7 w-[85%]" />
            <Skeleton className="h-7 w-[95%]" />
          </div>
        )}

        {state === "error" && (
          <div className="rounded-md border border-border-subtle p-4 text-sm">
            <p className="text-foreground/85">The file tree is unavailable.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The repository service did not return a workspace tree.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => setReloadNonce((n) => n + 1)}
            >
              Retry
            </Button>
          </div>
        )}

        {state === "ready" && filtered.length === 0 && (
          <div className="rounded-md border border-border-subtle p-4 text-sm text-muted-foreground">
            No files match your filter.
          </div>
        )}

        {state === "ready" && filtered.length > 0 && (
          <ul className="max-h-[50vh] min-h-0 divide-y divide-border-subtle overflow-y-auto rounded-md border border-border-subtle">
            {filtered.map((path) => (
              <li key={path}>
                <button
                  type="button"
                  onClick={() =>
                    void editorNavigation.open({
                      filePath: path,
                      sourceContext: "search",
                    })
                  }
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors",
                    "hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/60",
                  )}
                >
                  <File
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="truncate font-mono text-xs text-foreground/85">
                    {path}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-auto pt-2 text-[11px] text-muted-foreground">
          Results come from the real workspace tree. Nothing is simulated.
        </p>
      </div>
    </div>
  );
}
