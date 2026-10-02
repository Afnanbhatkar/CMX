"use client";

/**
 * CodeMind X V2 — repository tree hook (Phase 2, real API).
 *
 * Fetches GET /api/repository/tree once per mount (AbortController, cleaned
 * up on unmount / reload) and exposes honest loading / error states plus a
 * memoized flattened file list (path) for client-side filtering.
 *
 * Honesty (RULES.md §9): the tree is never fabricated — an empty result means
 * the real workspace tree was empty; an error is surfaced, never masked.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import type { RepoTreeNode } from "@/features/workspace/types";

export interface RepositoryTreeState {
  tree: RepoTreeNode[];
  loading: boolean;
  error: boolean;
  reload: () => void;
  /** All file nodes (depth-first, server order) — for search/filter. */
  flattened: RepoTreeNode[];
}

function flattenFiles(nodes: RepoTreeNode[], out: RepoTreeNode[]): void {
  for (const node of nodes) {
    if (node.type === "file") out.push(node);
    if (node.children && node.children.length > 0) flattenFiles(node.children, out);
  }
}

export function useRepositoryTree(): RepositoryTreeState {
  const [tree, setTree] = useState<RepoTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);

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

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [nonce]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(false);
    setNonce((n) => n + 1);
  }, []);

  const flattened = useMemo(() => {
    const files: RepoTreeNode[] = [];
    flattenFiles(tree, files);
    return files;
  }, [tree]);

  return { tree, loading, error, reload, flattened };
}
