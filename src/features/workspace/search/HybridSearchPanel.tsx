"use client";

/**
 * CodeMind X V2 — hybrid code search panel (Phase 7).
 *
 * The real search-engine surface: mode selector (auto / natural-language /
 * semantic / keyword / exact / symbol / filename / regex / api / dependency
 * / git / security / documentation), filters (language, path, scope, active
 * file context), an honest activity strip, and compact results GROUPED BY
 * FILE — small rows, never giant cards.
 *
 * Clicking a result: opens the actual file through the EditorNavigationService
 * (openSearchResult → verified open → tab → jump to line → highlight match);
 * the query is preserved in the session store. All retrieval engines are
 * labeled honestly (capability chips + why-matched lines).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Sparkles, Timer } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { FileReferenceChip } from "../components/FileReferenceChip";
import { editorNavigation } from "../editor-navigation";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSearchSessionStore } from "./search-store";
import type { SearchHit } from "@/server/search/search-service";

/* ------------------------------------------------------------------ */
/* Modes (spec §2)                                                     */
/* ------------------------------------------------------------------ */

const MODES: Array<{ id: string; label: string; note: string }> = [
  { id: "auto", label: "Hybrid", note: "Full mix: lexical + semantic + symbol + path + graph + git, RRF-fused." },
  { id: "natural-language", label: "Natural language", note: "Ask like a person — English, Hindi or Hinglish (\"login ka pura flow kaha hai?\")." },
  { id: "semantic", label: "Semantic", note: "Dense relevance from local hashed n-gram vectors (no external embedding model)." },
  { id: "keyword", label: "Keyword", note: "Pure BM25 lexical scoring over the indexed workspace." },
  { id: "exact", label: "Exact", note: "Literal substring matching — case-insensitive, occurrences counted." },
  { id: "symbol", label: "Symbol", note: "Function/class/component names from the real symbol table." },
  { id: "filename", label: "Filename", note: "Path and basename matching over the workspace tree." },
  { id: "regex", label: "Regex", note: "Regular expression over file content (budget-capped, honest errors)." },
  { id: "api", label: "API", note: "Route handlers and outbound API calls detected in real code." },
  { id: "dependency", label: "Dependency", note: "Import statements and package.json dependencies." },
  { id: "git", label: "Git", note: "Working-tree status and recent commit paths from the real git CLI." },
  { id: "security", label: "Security", note: "Pattern-based security-oriented signals (eval, hardcoded secrets, SQL concat…)." },
  { id: "documentation", label: "Documentation", note: "Docs headings and documentation blocks in the real files." },
];

const METHOD_CHIP_CLASS: Record<string, string> = {
  semantic: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400",
  symbol: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  lexical: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  path: "border-teal-500/30 bg-teal-500/10 text-teal-600 dark:text-teal-400",
  graph: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
  metadata: "border-zinc-400/40 bg-zinc-400/10 text-zinc-500",
  reranker: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400",
  exact: "border-primary/40 bg-primary/10 text-primary",
  regex: "border-primary/40 bg-primary/10 text-primary",
  git: "border-stone-400/40 bg-stone-400/10 text-stone-500",
  security: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  documentation: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
};

const METHOD_LABELS: Record<string, string> = {
  semantic: "Semantic",
  symbol: "Symbol",
  lexical: "Keyword",
  path: "Path",
  graph: "Graph",
  metadata: "Metadata",
  reranker: "Reranker",
  exact: "Exact",
  regex: "Regex",
  git: "Git",
  security: "Security",
  documentation: "Docs",
};

/** Honest confidence tiers (V2.1 §D) — chips state the tier, tooltip the rule. */
const CONFIDENCE_CHIP: Record<
  "high" | "probable" | "weak",
  { label: string; className: string }
> = {
  high: {
    label: "High confidence",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  probable: {
    label: "Probable",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  weak: {
    label: "Related",
    className: "border-border-subtle bg-surface text-muted-foreground",
  },
};

/* ------------------------------------------------------------------ */
/* Result pieces                                                       */
/* ------------------------------------------------------------------ */

function highlightTokens(text: string, tokens: string[]): React.ReactNode[] {
  if (!text || tokens.length === 0) return [text];
  const escaped = tokens
    .filter((t) => t.length >= 2)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (escaped.length === 0) return [text];
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) && i % 2 === 1 ? (
      <mark key={i} className="rounded-sm bg-warning/25 px-0.5 text-foreground">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.max(4, Math.round(score * 100));
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-block h-1 w-10 shrink-0 overflow-hidden rounded-full bg-surface-elevated" aria-hidden="true">
          <span
            className="block h-full rounded-full bg-primary/70"
            style={{ width: `${pct}%` }}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent side="left" className="text-[10px]">
        relevance {(score * 100).toFixed(0)}% (RRF-fused, display-normalized)
      </TooltipContent>
    </Tooltip>
  );
}

function HitRow({ hit, tokens, onOpen }: { hit: SearchHit; tokens: string[]; onOpen: (hit: SearchHit) => void }) {
  const snippetLines = hit.snippet.split("\n").slice(0, 3);
  return (
    <button
      type="button"
      data-testid="search-hit"
      onClick={() => onOpen(hit)}
      className={cn(
        "group flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left",
        "hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
      )}
    >
      <span className="flex items-center gap-2">
        {hit.symbol ? (
          <span className="min-w-0 shrink-0 truncate font-mono text-[11px] font-medium text-primary/90">
            {hit.symbol}()
          </span>
        ) : null}
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          L{hit.lineStart}
          {hit.lineEnd > hit.lineStart ? `–${hit.lineEnd}` : ""}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {hit.confidence ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  data-testid="search-confidence"
                  data-confidence={hit.confidence}
                  className={cn(
                    "rounded border px-1 py-0 text-[9px] leading-3.5",
                    CONFIDENCE_CHIP[hit.confidence].className,
                  )}
                >
                  {CONFIDENCE_CHIP[hit.confidence].label}
                </span>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-52 text-[10px]">
                {hit.confidenceReason}
              </TooltipContent>
            </Tooltip>
          ) : null}
          {hit.retrievalMethod.map((method) => (
            <span
              key={method}
              className={cn(
                "rounded border px-1 py-0 text-[9px] leading-3.5",
                METHOD_CHIP_CLASS[method] ?? "border-border-subtle text-muted-foreground",
              )}
            >
              {METHOD_LABELS[method] ?? method}
            </span>
          ))}
          <ScoreBar score={hit.score} />
        </span>
      </span>
      {hit.whyMatched.length > 0 ? (
        <span className="truncate text-[10px] text-muted-foreground/80" title={hit.whyMatched.join(" · ")}>
          Match: {hit.whyMatched.join(" · ")}
        </span>
      ) : null}
      {snippetLines.length > 0 && snippetLines[0] ? (
        <span className="line-clamp-3 whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-muted-foreground">
          {snippetLines.map((line, i) => (
            <span key={i} className="block">
              {highlightTokens(line.slice(0, 200), tokens)}
            </span>
          ))}
        </span>
      ) : null}
    </button>
  );
}

interface FileGroup {
  path: string;
  language: string;
  gitStatus: string | null;
  hits: SearchHit[];
}

function groupByFile(hits: SearchHit[]): FileGroup[] {
  const groups = new Map<string, FileGroup>();
  for (const hit of hits) {
    const group = groups.get(hit.file);
    if (group) {
      group.hits.push(hit);
      if (!group.gitStatus && hit.gitStatus) group.gitStatus = hit.gitStatus;
    } else {
      groups.set(hit.file, {
        path: hit.file,
        language: hit.language,
        gitStatus: hit.gitStatus,
        hits: [hit],
      });
    }
  }
  return [...groups.values()];
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

interface IndexInfo {
  built: boolean;
  stats: { files: number; symbols: number; buildMs: number; languages: Record<string, number> } | null;
}

export function HybridSearchPanel() {
  const store = useSearchSessionStore();
  const activeTabPath = useWorkspaceStore((s) => s.activeTabPath);
  const setSection = useWorkspaceStore((s) => s.setSection);

  const [indexInfo, setIndexInfo] = useState<IndexInfo | null>(null);
  const [evaluation, setEvaluation] = useState<{
    status: string;
    aggregate?: { precisionAt5: number; recallAt5: number; mrr: number; ndcgAt10: number; meanLatencyMs: number } | null;
  } | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /* Index info for the language filter + honest footer (never fabricated). */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      try {
        const res = await fetch("/api/search/index", { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as
          | { success?: boolean; data?: IndexInfo }
          | null;
        const payload = data?.data ?? null;
        if (!cancelled && payload) setIndexInfo(payload);
      } catch {
        // honest absence — footer shows "index not built yet"
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* Evaluation status (§11): real state or exactly "Evaluation not run." */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      try {
        const res = await fetch("/api/search/evaluate", { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as
          | { success?: boolean; data?: { status: string; aggregate?: { precisionAt5: number; recallAt5: number; mrr: number; ndcgAt10: number; meanLatencyMs: number } | null } }
          | null;
        if (!cancelled && data?.success && data.data) setEvaluation(data.data);
      } catch {
        // stays null → footer shows the honest not-run state
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runSearch = useCallback(
    async (overrideQuery?: string) => {
      const query = (overrideQuery ?? store.query).trim();
      if (!query) return;
      store.beginSearch();
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query,
            mode: store.mode,
            limit: 30,
            filters: {
              language: store.languageFilter,
              pathPrefix: store.pathFilter,
              scope: store.scope,
            },
            context: store.useCurrentFileContext
              ? { currentFile: activeTabPath ?? null, currentSymbol: null }
              : undefined,
          }),
        });
        const data = (await res.json().catch(() => null)) as
          | { success?: boolean; data?: import("@/server/search/search-service").SearchResponse; error?: { message?: string } }
          | null;
        if (res.ok && data?.success && data.data) {
          store.finishSearch(data.data);
        } else {
          store.failSearch(data?.error?.message ?? `Search failed (HTTP ${res.status}).`);
        }
      } catch {
        store.failSearch("The search service is unreachable right now.");
      }
    },
    [store, activeTabPath],
  );

  /* Filename mode: debounce-as-you-type (fast path, like a file finder). */
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (store.mode !== "filename" || !store.query.trim()) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void runSearch(), 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [store.query, store.mode]);

  /* Register every hit so openSearchResult(id) is the navigation route. */
  const results = store.response?.results ?? [];
  useEffect(() => {
    editorNavigation.registerTargets(
      "search-result",
      results.map((hit) => ({
        id: `res:${hit.file}:${hit.lineStart}:${hit.symbol ?? ""}`,
        filePath: hit.file,
        line: hit.lineStart,
        label: hit.symbol ?? hit.file,
      })),
    );
    return () => editorNavigation.unregisterTargets("search-result");
  }, [results]);

  const openHit = useCallback(
    (hit: SearchHit) => {
      const id = `res:${hit.file}:${hit.lineStart}:${hit.symbol ?? ""}`;
      void editorNavigation.openSearchResult(id).then((result) => {
        if (result.ok) {
          // The editor lives on the Assistant destination — surface it.
          if (useWorkspaceStore.getState().section !== "assistant") setSection("assistant");
        }
      });
    },
    [setSection],
  );

  const groups = useMemo(() => groupByFile(results), [results]);
  const tokens = useMemo(() => {
    const q = store.query.trim().toLowerCase();
    return q.split(/[\s,?."']+/).filter((t) => t.length >= 2);
  }, [store.query]);

  const runEvaluation = async () => {
    setEvaluating(true);
    try {
      const res = await fetch("/api/search/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataset: "builtin" }),
      });
      const data = (await res.json().catch(() => null)) as
        | { success?: boolean; data?: { evaluation?: { aggregate?: { precisionAt5: number; recallAt5: number; mrr: number; ndcgAt10: number; meanLatencyMs: number } } } }
        | null;
      if (data?.success && data.data?.evaluation?.aggregate) {
        setEvaluation({ status: "ok", aggregate: data.data.evaluation.aggregate });
      }
    } catch {
      // honest: evaluation unavailable stays displayed as not run
    } finally {
      setEvaluating(false);
    }
  };

  const searching = store.status === "searching";
  const languages = Object.entries(indexInfo?.stats?.languages ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="hybrid-search-panel">
      <div className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-6">
        {/* Header */}
        <div>
          <h1 className="text-lg font-semibold">Code search</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Hybrid retrieval over the real workspace — lexical BM25 + local dense
            vectors + symbols + paths + import graph + git. Understands English,
            Hindi and Hinglish queries.
          </p>
        </div>

        {/* Query + mode */}
        <div className="flex shrink-0 gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              ref={inputRef}
              value={store.query}
              onChange={(event) => store.setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void runSearch();
              }}
              placeholder="login ka pura flow kaha hai?  ·  where is the API request created?"
              aria-label="Search query"
              data-testid="search-input"
              className="h-9 pl-8 text-[13px]"
            />
          </div>
          <Select value={store.mode} onValueChange={(v) => store.setMode(v)}>
            <SelectTrigger className="h-9 w-36 shrink-0 text-[12px]" aria-label="Search mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODES.map((mode) => (
                <SelectItem key={mode.id} value={mode.id} title={mode.note}>
                  {mode.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-9 shrink-0 px-3" onClick={() => void runSearch()} disabled={searching || !store.query.trim()}>
            {searching ? "…" : "Search"}
          </Button>
        </div>

        {/* Filters row */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-[11px]">
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[10.5px]"
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
          >
            {showFilters ? "Hide filters" : "Filters"}
          </Button>
          <div className="flex items-center gap-1.5 rounded-md border border-border-subtle px-2 py-1">
            <Sparkles aria-hidden="true" className="size-3 text-muted-foreground" />
            <span className="text-muted-foreground">current file context</span>
            <Switch
              checked={store.useCurrentFileContext}
              onCheckedChange={store.setUseCurrentFileContext}
              aria-label="Use current file context — iske callers"
            />
            {store.useCurrentFileContext && activeTabPath ? (
              <span className="max-w-40 truncate font-mono text-[10px] text-muted-foreground/70" title={activeTabPath}>
                {activeTabPath.split("/").pop()}
              </span>
            ) : null}
          </div>
          {showFilters ? (
            <>
              <Select
                value={store.languageFilter ?? "any"}
                onValueChange={(v) => store.setLanguageFilter(v === "any" ? null : v)}
              >
                <SelectTrigger className="h-7 w-28 text-[10.5px]" aria-label="Language filter">
                  <SelectValue placeholder="language" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">any language</SelectItem>
                  {languages.map(([language, count]) => (
                    <SelectItem key={language} value={language}>
                      {language} ({count})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={store.scope} onValueChange={(v) => store.setScope(v as typeof store.scope)}>
                <SelectTrigger className="h-7 w-28 text-[10.5px]" aria-label="Scope filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">all files</SelectItem>
                  <SelectItem value="code">code only</SelectItem>
                  <SelectItem value="tests">tests</SelectItem>
                  <SelectItem value="docs">docs</SelectItem>
                  <SelectItem value="config">config</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={store.pathFilter ?? ""}
                onChange={(event) => store.setPathFilter(event.target.value || null)}
                placeholder="path contains…"
                aria-label="Path filter"
                className="h-7 w-44 text-[10.5px]"
              />
            </>
          ) : null}
        </div>

        {/* Query contract (V2.1 §A): original → normalized → rewritten,
            with detected language, intent, repository and scope. */}
        {store.response ? (
          <div
            className="shrink-0 rounded-md border border-border-subtle bg-surface-elevated/40 px-3 py-2 text-[10.5px] text-muted-foreground"
            data-testid="search-query-contract"
          >
            <span className="font-mono">
              “{store.response.query.original.trim().slice(0, 80)}”
            </span>
            <span className="mx-1.5 text-muted-foreground/50">→</span>
            <span className="font-mono text-foreground/70">
              {store.response.query.normalized || "(empty after normalization)"}
            </span>
            {store.response.query.rewritten ? (
              <>
                <span className="mx-1.5 text-muted-foreground/50">→</span>
                <span className="font-mono text-primary/80" title="interpretation-rewritten retrieval query">
                  {store.response.query.rewritten}
                </span>
              </>
            ) : null}
            <span className="ml-2 inline-flex flex-wrap items-center gap-1 align-baseline">
              <span className="rounded border border-border-subtle px-1 py-0 text-[9px] leading-3.5">
                lang: {store.response.query.language}
              </span>
              {store.response.query.intent && store.response.query.intent !== "general" ? (
                <span className="rounded border border-border-subtle px-1 py-0 text-[9px] leading-3.5">
                  intent: {store.response.query.intent}
                </span>
              ) : null}
              {store.response.query.repository ? (
                <span className="rounded border border-border-subtle px-1 py-0 text-[9px] leading-3.5">
                  repo: {store.response.query.repository}
                </span>
              ) : null}
              <span className="rounded border border-border-subtle px-1 py-0 text-[9px] leading-3.5">
                scope: {store.response.query.scope.scope}
              </span>
            </span>
          </div>
        ) : null}

        {/* Interpretation (honest, spec §5/§9) */}
        {store.response?.query.interpretation.length ? (
          <div className="flex shrink-0 flex-wrap gap-1.5">
            {store.response.query.interpretation.map((note, i) => (
              <Badge
                key={i}
                variant="outline"
                className="border-primary/30 bg-primary/5 px-1.5 py-0 text-[10px] font-normal text-primary/80"
              >
                {note}
              </Badge>
            ))}
          </div>
        ) : null}

        {/* Activity strip (spec §8) — safe execution summary */}
        {searching ? (
          <div className="shrink-0 space-y-1 rounded-md border border-border-subtle bg-surface-elevated/40 p-3" role="status" aria-label="Searching">
            <p className="flex items-center gap-2 text-[11px]">
              <span className="inline-block size-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary" aria-hidden="true" />
              Searching repository
            </p>
            <p className="pl-5 text-[11px] text-muted-foreground">“{store.query}”</p>
          </div>
        ) : store.response ? (
          <div className="shrink-0 rounded-md border border-border-subtle bg-surface-elevated/40 p-3" data-testid="activity-summary">
            <p className="text-[11px] font-medium">{store.response.activity.label}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {store.response.activity.summary} · {store.response.timings.totalMs} ms
              {store.response.index.rebuilt ? " · index rebuilt" : ""}
            </p>
            {store.response.activity.topFiles.length > 0 ? (
              <p className="mt-1 flex flex-wrap gap-1">
                {store.response.activity.topFiles.map((file) => (
                  <span key={file} className="max-w-64 truncate rounded bg-surface px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground" title={file}>
                    {file}
                  </span>
                ))}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Error */}
        {store.status === "error" ? (
          <div className="shrink-0 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-[11px] text-destructive">
            {store.error}
          </div>
        ) : null}

        {/* Loading skeletons */}
        {searching && results.length === 0 ? (
          <div className="space-y-1.5" aria-hidden="true">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-16 w-[92%]" />
            <Skeleton className="h-16 w-[85%]" />
          </div>
        ) : null}

        {/* Grouped results */}
        {store.status !== "searching" && groups.length > 0 ? (
          <div className="min-h-0 space-y-2" data-testid="search-results">
            {groups.map((group) => (
              <div key={group.path} className="rounded-md border border-border-subtle">
                <div className="flex items-center gap-1.5 border-b border-border-subtle px-2 py-1">
                  <FileReferenceChip path={group.path} source="search" />
                  {group.gitStatus ? (
                    <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 px-1.5 py-0 text-[9px] font-normal text-amber-600 dark:text-amber-400">
                      {group.gitStatus}
                    </Badge>
                  ) : null}
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                    {group.hits.length} hit{group.hits.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="divide-y divide-border-subtle/60 p-0.5">
                  {group.hits.map((hit, i) => (
                    <HitRow
                      key={`${hit.file}:${hit.lineStart}:${i}`}
                      hit={hit}
                      tokens={tokens}
                      onOpen={openHit}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* Empty states */}
        {store.status === "done" && results.length === 0 ? (
          <div className="shrink-0 rounded-md border border-border-subtle p-4 text-sm text-muted-foreground">
            No results. Try a broader query, another mode, or clear the filters.
          </div>
        ) : null}
        {store.status === "idle" ? (
          <div className="shrink-0 rounded-md border border-border-subtle p-4 text-[12px] text-muted-foreground">
            Ask where something lives — “authentication check kaha ho raha hai?”,
            “which component renders the dashboard?”, “payment ka backend dikhao”.
          </div>
        ) : null}

        {/* Footer — index truth + evaluation (spec §11) */}
        <div className="mt-auto shrink-0 space-y-1.5 border-t border-border-subtle pt-2 text-[10.5px] text-muted-foreground">
          <div className="flex flex-wrap items-center gap-2">
            {indexInfo?.built && indexInfo.stats ? (
              <span data-testid="index-stats">
                index: {indexInfo.stats.files} files · {indexInfo.stats.symbols} symbols · built in {indexInfo.stats.buildMs} ms
              </span>
            ) : (
              <span>index: builds on first search (real workspace, allowlist-respecting)</span>
            )}
            <span className="flex items-center gap-1">
              <Timer aria-hidden="true" className="size-3" />
              {evaluation?.aggregate ? (
                <span data-testid="evaluation-metrics" title={`P@5 ${evaluation.aggregate.precisionAt5} · R@5 ${evaluation.aggregate.recallAt5} · MRR ${evaluation.aggregate.mrr}`}>
                  eval: NDCG@10 {evaluation.aggregate.ndcgAt10} · MRR {evaluation.aggregate.mrr} · P@5 {evaluation.aggregate.precisionAt5} · mean {evaluation.aggregate.meanLatencyMs} ms
                </span>
              ) : (
                <span>Evaluation not run.</span>
              )}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-6 px-2 text-[10px]"
              onClick={() => void runEvaluation()}
              disabled={evaluating}
            >
              {evaluating ? "Running…" : "Run evaluation"}
            </Button>
          </div>
          <p>Results come from the real workspace. Nothing is simulated; semantic mode uses local hashed n-gram vectors (no external embedding model).</p>
        </div>
      </div>
    </div>
  );
}
