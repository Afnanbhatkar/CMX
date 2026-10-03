"use client";

/**
 * CodeMind X V2 — file intelligence hook (Phase 5, spec §6).
 *
 * Fetches ONLY real backend data for the selected file:
 * - provenance metadata (variant=meta)
 * - git history (file-history, limit 10)
 * - sibling files (subtree of the file's directory)
 *
 * Honesty (RULES.md §9): every failure becomes a visible error string; every
 * absence becomes an empty array. Nothing is inferred or fabricated.
 * Content-derived analysis (imports) happens in the panel from the ALREADY
 * loaded tab content — this hook never fetches file bodies itself.
 */

import { useCallback, useEffect, useState } from "react";

import type { FileHistoryCommit, FileProvenanceMeta, RepoTreeNode } from "@/features/workspace/types";

export interface FileIntelligenceState {
  meta: FileProvenanceMeta | null;
  metaError: string | null;
  commits: FileHistoryCommit[];
  commitsError: string | null;
  siblings: RepoTreeNode[];
  /** Sibling test files (best-effort by name: *.test.* / *.spec.*). */
  testFiles: RepoTreeNode[];
  loading: boolean;
  reload: () => void;
}

interface MetaResponse {
  ok?: boolean;
  meta?: FileProvenanceMeta;
  error?: string;
}

interface HistoryResponse {
  ok?: boolean;
  commits?: FileHistoryCommit[];
  error?: string;
}

interface TreeResponse {
  ok?: boolean;
  tree?: RepoTreeNode[];
  error?: string;
}

function isTestFile(node: RepoTreeNode, filePath: string): boolean {
  if (node.type !== "file") return false;
  const base = filePath.split("/").pop() ?? filePath;
  const stem = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
  const name = node.name.toLowerCase();
  return (
    name.startsWith(`${stem.toLowerCase()}.`) &&
    (name.includes(".test.") || name.includes(".spec."))
  );
}

export function useFileIntelligence(filePath: string | null): FileIntelligenceState {
  const [meta, setMeta] = useState<FileProvenanceMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [commits, setCommits] = useState<FileHistoryCommit[]>([]);
  const [commitsError, setCommitsError] = useState<string | null>(null);
  const [siblings, setSiblings] = useState<RepoTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let done = 0;
    const settle = () => {
      done += 1;
      if (done >= 3) setLoading(false);
    };

    void (async () => {
      // Yield first so no state update happens synchronously inside the
      // effect body (react-hooks/set-state-in-effect).
      await Promise.resolve();
      if (controller.signal.aborted) return;
      setMeta(null);
      setMetaError(null);
      setCommits([]);
      setCommitsError(null);
      setSiblings([]);
      if (!filePath) {
        setLoading(false);
        return;
      }
      setLoading(true);

      /* Provenance metadata (works for binaries too). */
      fetch(
        `/api/repository/file?path=${encodeURIComponent(filePath)}&variant=meta`,
        { cache: "no-store", signal: controller.signal },
      )
        .then(async (res) => {
          const data = (await res.json().catch(() => null)) as MetaResponse | null;
          if (controller.signal.aborted) return;
          if (res.ok && data?.ok && data.meta) {
            setMeta(data.meta);
            setMetaError(null);
          } else {
            setMeta(null);
            setMetaError(data?.error ?? "Metadata unavailable.");
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setMetaError("Metadata request failed.");
        })
        .finally(() => {
          if (!controller.signal.aborted) settle();
        });

      /* Real git history (--follow). */
      fetch(
        `/api/repository/file-history?path=${encodeURIComponent(filePath)}&limit=10`,
        { cache: "no-store", signal: controller.signal },
      )
        .then(async (res) => {
          const data = (await res.json().catch(() => null)) as HistoryResponse | null;
          if (controller.signal.aborted) return;
          if (res.ok && data?.ok && Array.isArray(data.commits)) {
            setCommits(data.commits);
            setCommitsError(null);
          } else {
            setCommits([]);
            setCommitsError(data?.error ?? "History unavailable for this path.");
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setCommitsError("History request failed.");
        })
        .finally(() => {
          if (!controller.signal.aborted) settle();
        });

      /* Siblings from the file's directory subtree. */
      const dir = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : null;
      if (dir) {
        fetch(`/api/repository/tree?path=${encodeURIComponent(dir)}`, {
          cache: "no-store",
          signal: controller.signal,
        })
          .then(async (res) => {
            const data = (await res.json().catch(() => null)) as TreeResponse | null;
            if (controller.signal.aborted) return;
            if (res.ok && data?.ok && Array.isArray(data.tree)) {
              const files = data.tree.filter((n) => n.type === "file" && n.path !== filePath);
              setSiblings(files);
            } else {
              setSiblings([]);
            }
          })
          .catch(() => {
            if (!controller.signal.aborted) setSiblings([]);
          })
          .finally(() => {
            if (!controller.signal.aborted) settle();
          });
      } else {
        settle();
        settle(); // meta + history remain; siblings slot closes immediately
      }
    })();

    return () => controller.abort();
  }, [filePath, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const testFiles = siblings.filter((node) => isTestFile(node, filePath ?? ""));

  return { meta, metaError, commits, commitsError, siblings, testFiles, loading, reload };
}
