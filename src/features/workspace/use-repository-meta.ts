"use client";

/**
 * CodeMind X V2 — real repository meta hook.
 *
 * Fetches /api/repository/meta (real project name + real git branch) and
 * caches it module-wide for the session. Honest states: loading / error /
 * null branch ("Not connected"). Never fabricates repository facts.
 */

import { useCallback, useEffect, useState } from "react";

import type { RepoMeta } from "./types";

let cached: RepoMeta | null = null;
let inflight: Promise<RepoMeta | null> | null = null;

async function fetchMeta(): Promise<RepoMeta | null> {
  if (cached) return cached;
  if (!inflight) {
    inflight = fetch("/api/repository/meta", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return null;
        const data = (await res.json()) as { ok?: boolean } & RepoMeta;
        if (!data?.ok) return null;
        cached = {
          repository: data.repository,
          indexing: data.indexing,
        };
        return cached;
      })
      .catch(() => null)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export interface RepositoryMetaState {
  meta: RepoMeta | null;
  loading: boolean;
  error: boolean;
  reload: () => void;
}

interface MetaSnapshot {
  meta: RepoMeta | null;
  loading: boolean;
  error: boolean;
}

export function useRepositoryMeta(): RepositoryMetaState {
  const [snapshot, setSnapshot] = useState<MetaSnapshot>(() => ({
    meta: cached,
    loading: cached === null,
    error: false,
  }));
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // fetchMeta resolves asynchronously even on cache hit, so setState always
    // happens in a microtask callback (never synchronously in the effect body).
    fetchMeta().then((result) => {
      if (cancelled) return;
      setSnapshot({ meta: result, loading: false, error: result === null });
    });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const reload = useCallback(() => {
    cached = null;
    setNonce((n) => n + 1);
    setSnapshot((s) => ({ ...s, loading: true, error: false }));
  }, []);

  return { meta: snapshot.meta, loading: snapshot.loading, error: snapshot.error, reload };
}
