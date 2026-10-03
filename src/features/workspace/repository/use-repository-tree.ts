"use client";

/**
 * CodeMind X V2 — repository tree hook (Phase 5).
 *
 * Phase 2 core (preserved): GET /api/repository/tree per mount/reload with an
 * AbortController, honest loading/error states, memoized flattened file list.
 *
 * Phase 5 additions (spec §2/§10):
 * - git working-tree status: GET /api/repository/status on mount + reload;
 *   the map is pushed into the workspace store (applyGitStatus) so tabs and
 *   tree rows share one honest source. A 503 becomes a visible note — never
 *   fabricated data.
 * - lazy directory loading: expanding a server-`truncated` directory fetches
 *   GET /api/repository/tree?path=<dir> and splices the fresh children into
 *   the tree, so capped trees stay navigable without rendering 50k nodes.
 * - per-request aborts; no state writes after unmount.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { RepoTreeNode, TreeGitStatus } from "@/features/workspace/types";
import { useWorkspaceStore } from "@/stores/workspace-store";

export interface RepositoryTreeState {
  tree: RepoTreeNode[];
  loading: boolean;
  error: boolean;
  reload: () => void;
  /** All file nodes (depth-first, server order) — for search/filter. */
  flattened: RepoTreeNode[];
  /** Honest git-status note when the status API is unavailable (503). */
  statusNote: string | null;
  /** Directories currently being lazy-loaded. */
  loadingDirs: ReadonlySet<string>;
  /** Lazy-load (or refresh) a truncated directory's children. */
  loadDir: (path: string) => Promise<void>;
}

function flattenFiles(nodes: RepoTreeNode[], out: RepoTreeNode[]): void {
  for (const node of nodes) {
    if (node.type === "file") out.push(node);
    if (node.children && node.children.length > 0) flattenFiles(node.children, out);
  }
}

/** Immutably replace the children of the node at `dirPath`. */
function spliceChildren(
  nodes: RepoTreeNode[],
  dirPath: string,
  children: RepoTreeNode[],
): RepoTreeNode[] {
  return nodes.map((node) => {
    if (node.path === dirPath) {
      return { ...node, children, truncated: false };
    }
    if (node.children && node.children.length > 0) {
      return { ...node, children: spliceChildren(node.children, dirPath, children) };
    }
    return node;
  });
}

export function useRepositoryTree(): RepositoryTreeState {
  const [tree, setTree] = useState<RepoTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [loadingDirs, setLoadingDirs] = useState<ReadonlySet<string>>(() => new Set());
  const dirControllersRef = useRef(new Map<string, AbortController>());

  const applyGitStatus = useWorkspaceStore((s) => s.applyGitStatus);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    fetch("/api/repository/tree", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) return null;
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; tree?: RepoTreeNode[] }
          | null;
        if (!data?.ok || !Array.isArray(data.tree)) return null;
        return data.tree;
      })
      .then((result) => {
        if (cancelled) return;
        if (result === null) {
          setTree([]);
          setError(true);
        } else {
          setTree(result);
          setError(false);
        }
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setTree([]);
        setError(true);
        setLoading(false);
      });

    // Working-tree status — same lifecycle, separate endpoint, honest failure.
    fetch("/api/repository/status", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; status?: Record<string, TreeGitStatus>; error?: string }
          | null;
        if (cancelled) return;
        if (res.ok && data?.ok && data.status) {
          applyGitStatus(data.status);
          setStatusNote(null);
        } else {
          setStatusNote(data?.error ?? "Working-tree status is unavailable right now.");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setStatusNote("Working-tree status is unavailable right now.");
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [nonce, applyGitStatus]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(false);
    setNonce((n) => n + 1);
  }, []);

  const loadDir = useCallback(
    async (path: string) => {
      if (dirControllersRef.current.has(path)) return;
      const controller = new AbortController();
      dirControllersRef.current.set(path, controller);
      setLoadingDirs((prev) => new Set(prev).add(path));
      try {
        const res = await fetch(
          `/api/repository/tree?path=${encodeURIComponent(path)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; tree?: RepoTreeNode[] }
          | null;
        if (res.ok && data?.ok && Array.isArray(data.tree)) {
          setTree((prev) => spliceChildren(prev, path, data.tree as RepoTreeNode[]));
        }
      } catch {
        // Aborted or unreachable — the truncated marker stays and the user
        // can retry by collapsing/re-expanding. Honest, never fabricated.
      } finally {
        if (dirControllersRef.current.get(path) === controller) {
          dirControllersRef.current.delete(path);
        }
        setLoadingDirs((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      }
    },
    [],
  );

  useEffect(() => {
    const controllers = dirControllersRef.current;
    return () => {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
    };
  }, []);

  const flattened = useMemo(() => {
    const files: RepoTreeNode[] = [];
    flattenFiles(tree, files);
    return files;
  }, [tree]);

  return { tree, loading, error, reload, flattened, statusNote, loadingDirs, loadDir };
}
