"use client";

/**
 * CodeMind X V2 — file intelligence panel (Phase 5, spec §6).
 *
 * "This information must come from backend analysis when available. Do not
 * invent it." — so every section is either REAL (backed by an API or by the
 * already-loaded tab content) or an explicitly labeled [PLANNED] slot with a
 * muted note. Nothing in between.
 *
 * REAL:   overview (provenance meta) · classification (V2.1 §A, when present)
 *         · imports (parsed from the loaded tab content, relative imports
 *           navigate) · tests (sibling-name heuristic) · git history (real
 *           `git log --follow`) · related files (real directory siblings)
 * PLANNED: AI summary · symbols · dependency graph · complexity · security ·
 *          documentation.
 */

import { memo, useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Bot, FileCode2, GitCommitVertical, History, Link2, ListTree, Package, RefreshCw, ShieldCheck, Sigma, TestTube2, FileText } from "lucide-react";
import { toast } from "sonner";

import type { RepoTreeNode } from "@/features/workspace/types";
import {
  getIntelligenceCapability,
  publishOutlineToNavigation,
  type TextSymbol,
} from "@/features/workspace/editor/code-intelligence";
import { monacoLanguageForPath } from "@/features/workspace/editor/monaco-setup";
import { parseWorkerClient, type ParseEngine } from "@/features/workspace/editor/parse-worker/parse-worker-client";
import { CapabilityBadge } from "@/features/workspace/editor/CapabilityBadge";
import { recordPerfSample } from "@/lib/perf/budgets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";

import { editorNavigation } from "@/features/workspace/editor-navigation";
import { FileIcon } from "./file-icons";
import { useFileIntelligence } from "./use-file-intelligence";

export interface FileIntelligencePanelProps {
  /** Active tab path, or null when nothing is open. */
  filePath: string | null;
}

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

function Section({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={label} className="border-b border-border-subtle px-3 py-2.5 last:border-b-0">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </h3>
      {children}
    </section>
  );
}

function PlannedNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] italic leading-snug text-muted-foreground/70">{children}</p>
  );
}

function RowButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px]",
        "hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Import scanning (real, from loaded tab content)                     */
/* ------------------------------------------------------------------ */

interface ParsedImport {
  specifier: string;
}

function scanImports(content: string): ParsedImport[] {
  const found: string[] = [];
  const push = (spec: string) => {
    if (spec && !found.includes(spec)) found.push(spec);
  };
  // ES modules: import ... from "spec" / import "spec" / export ... from "spec"
  const esPattern = /(?:^|\n)\s*(?:import|export)[^'";]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']/g;
  // CommonJS: require("spec")
  const cjsPattern = /require\(\s*["']([^"']+)["']\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = esPattern.exec(content)) !== null) {
    push(match[1] ?? match[2] ?? "");
  }
  while ((match = cjsPattern.exec(content)) !== null) {
    push(match[1] ?? "");
  }
  return found.slice(0, 24).map((specifier) => ({ specifier }));
}

/** Resolve a relative import specifier against the file's directory. Null when unsafe. */
function resolveRelativeImport(fromPath: string, specifier: string): string | null {
  if (!specifier.startsWith("./") && !specifier.startsWith("../") && !specifier.startsWith("/")) {
    return null;
  }
  const dir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : "";
  const combined = specifier.startsWith("/") ? specifier.slice(1) : `${dir}/${specifier}`;
  const segments: string[] = [];
  for (const segment of combined.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null; // escapes the repo root
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

/* ------------------------------------------------------------------ */
/* Row lists (memoized)                                                */
/* ------------------------------------------------------------------ */

const CommitRow = memo(function CommitRow({
  sha,
  message,
  author,
  date,
}: {
  sha: string;
  message: string;
  author: string;
  date: string;
}) {
  const short = sha.slice(0, 7);
  const relative = (() => {
    try {
      return formatDistanceToNow(new Date(date), { addSuffix: true });
    } catch {
      return date;
    }
  })();
  return (
    <RowButton
      onClick={() => {
        void navigator.clipboard
          .writeText(sha)
          .then(() => toast.success("Commit SHA copied"))
          .catch(() => toast.error("Clipboard unavailable"));
      }}
      title={`${sha} — click to copy`}
    >
      <GitCommitVertical aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
      <span className="shrink-0 font-mono text-[10px] text-primary/80">{short}</span>
      <span className="min-w-0 flex-1 truncate text-foreground/85">{message}</span>
      <span className="shrink-0 text-[10px] text-muted-foreground/70" title={author}>
        {author}
      </span>
      <span className="shrink-0 text-[10px] text-muted-foreground/50">{relative}</span>
    </RowButton>
  );
});

const FileRow = memo(function FileRow({
  node,
  onOpen,
}: {
  node: RepoTreeNode;
  onOpen: (path: string) => void;
}) {
  return (
    <RowButton onClick={() => onOpen(node.path)} title={node.path}>
      <FileIcon name={node.name} />
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
    </RowButton>
  );
});

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

export function FileIntelligencePanel({ filePath }: FileIntelligencePanelProps) {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const { meta, metaError, commits, commitsError, siblings, testFiles, loading, reload } =
    useFileIntelligence(filePath);

  const activeTab = filePath ? tabs.find((t) => t.path === filePath) : undefined;
  const content = activeTab?.status === "ready" ? (activeTab.content ?? "") : null;

  const imports = useMemo(() => {
    if (!content || !filePath) return [];
    return scanImports(content);
  }, [content, filePath]);

  /* Phase 6 §3 outline — now parsed through the parse worker (V2.1 §B):
     files above the inline limit NEVER scan on the main thread. The engine
     that really ran is displayed (tree-sitter | structural scan). Also
     publishes the outline to the navigation registry so openSymbol() works
     app-wide (V2.1 §A). */
  const [symbols, setSymbols] = useState<TextSymbol[]>([]);
  const [symbolEngine, setSymbolEngine] = useState<ParseEngine>("unavailable");
  const [symbolParseMs, setSymbolParseMs] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      if (!content || !filePath) {
        setSymbols([]);
        setSymbolEngine("unavailable");
        setSymbolParseMs(null);
        return;
      }
      const result = await parseWorkerClient.parse({
        path: filePath,
        content,
        languageId: monacoLanguageForPath(filePath),
      });
      if (cancelled) return;
      setSymbols(result.symbols);
      setSymbolEngine(result.engine);
      setSymbolParseMs(result.parseMs);
      if (result.thread === "worker") {
        recordPerfSample("worker.parse", result.parseMs);
      }
      publishOutlineToNavigation(filePath, result.symbols);
    })();
    return () => {
      cancelled = true;
    };
  }, [content, filePath]);

  const openPath = (path: string) => {
    void editorNavigation.open({ filePath: path, sourceContext: "intelligence" });
  };

  if (!filePath) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
        <FileCode2 className="size-6 text-muted-foreground/50" aria-hidden="true" />
        <p className="text-[12px] text-foreground/80">No file selected</p>
        <p className="max-w-[220px] text-[11px] text-muted-foreground">
          Open a file to see its intelligence.
        </p>
      </div>
    );
  }

  const dirPrefix = filePath.includes("/") ? `${filePath.slice(0, filePath.lastIndexOf("/"))}/` : "";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Panel header */}
      <header className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border-subtle px-3">
        <span className="min-w-0 truncate text-[11px] uppercase tracking-wider text-muted-foreground">
          File Intelligence
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Reload intelligence data"
              onClick={reload}
              disabled={loading}
              className={cn(
                "ml-auto flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground",
                "hover:bg-surface-hover hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              <RefreshCw aria-hidden="true" className={cn("size-3.5", loading && "animate-spin")} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Reload intelligence data</TooltipContent>
        </Tooltip>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Overview — REAL */}
        <Section label="Overview">
          {loading && !meta && !metaError ? (
            <div aria-hidden="true" className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ) : metaError ? (
            <p className="text-[11px] text-muted-foreground">{metaError}</p>
          ) : meta ? (
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
              <span className="text-muted-foreground">Path</span>
              <span className="min-w-0 truncate font-mono" title={meta.path}>
                {filePath}
              </span>
              <span className="text-muted-foreground">Language</span>
              <span>{meta.language || "unknown"}</span>
              <span className="text-muted-foreground">Size</span>
              <span className="tabular-nums">
                {meta.size < 1024
                  ? `${meta.size} B`
                  : meta.size < 1024 * 1024
                    ? `${(meta.size / 1024).toFixed(1)} KB`
                    : `${(meta.size / (1024 * 1024)).toFixed(1)} MB`}
              </span>
              {meta.gitStatus ? (
                <>
                  <span className="text-muted-foreground">Status</span>
                  <span className="capitalize">{meta.gitStatus}</span>
                </>
              ) : null}
              {meta.branch ? (
                <>
                  <span className="text-muted-foreground">Branch</span>
                  <span className="font-mono">
                    {meta.branch}
                    {meta.commitSha ? ` @${meta.commitSha.slice(0, 7)}` : ""}
                  </span>
                </>
              ) : null}
              {meta.lastModifiedAt ? (
                <>
                  <span className="text-muted-foreground">Last modified</span>
                  <span title={meta.lastModifiedAt}>
                    {formatDistanceToNow(new Date(meta.lastModifiedAt), { addSuffix: true })}
                  </span>
                </>
              ) : null}
              {meta.binary ? (
                <>
                  <span className="text-muted-foreground">Type</span>
                  <span>Binary{meta.mimeType ? ` · ${meta.mimeType}` : ""}</span>
                </>
              ) : null}
            </div>
          ) : null}
        </Section>

        {/* Classification — REAL when present (V2.1 §A) */}
        {meta?.classification ? (
          <Section label="Classification">
            <div className="flex flex-col gap-1">
              <Badge
                variant="outline"
                className="w-fit border-stone-400/40 bg-stone-400/10 px-1.5 py-0 text-[10px] font-normal text-stone-500"
              >
                {meta.classification}
              </Badge>
              <p className="text-[10px] leading-snug text-muted-foreground/70">
                Informational, security-oriented tag from repository indexing (V2.1 §A). Content
                is never treated as AI instructions.
              </p>
            </div>
          </Section>
        ) : null}

        {/* AI summary — PLANNED */}
        <Section label="AI Summary" icon={<Bot aria-hidden="true" className="size-3" />}>
          <PlannedNote>Backend AI file analysis arrives in a later phase [PLANNED].</PlannedNote>
        </Section>

        {/* Symbols — REAL text-scan outline (Phase 6 §3, honest labeling) */}
        <Section label="Symbols" icon={<ListTree aria-hidden="true" className="size-3" />}>
          {content === null ? (
            <p className="text-[11px] text-muted-foreground">Open the file to scan its symbols.</p>
          ) : symbols.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No symbols detected in this file.</p>
          ) : (
            <div className="flex max-h-56 flex-col overflow-y-auto">
              {symbols.slice(0, 50).map((symbol) => (
                <RowButton
                  key={`${symbol.line}:${symbol.name}`}
                  onClick={() => {
                    void editorNavigation.openRange(filePath, symbol.line, symbol.line, "intelligence");
                  }}
                  title={`${symbol.kind} — line ${symbol.line} (click to open)`}
                >
                  <ListTree aria-hidden="true" className="size-3 shrink-0 text-muted-foreground/60" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-foreground/85">
                    {symbol.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground/60">{symbol.kind}</span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground/50">:{symbol.line}</span>
                </RowButton>
              ))}
            </div>
          )}
          <p className="mt-1 text-[10px] text-muted-foreground/60">
            {symbolEngine === "tree-sitter"
              ? "Parsed by tree-sitter (WASM) in the worker"
              : symbolEngine === "structural-scan"
                ? "Structural scan (regex over the file) — tree-sitter fallback"
                : "Open the file to parse its structure"}
            {symbolParseMs !== null ? ` · ${symbolParseMs} ms` : ""}
          </p>
          <div className="mt-1">
            <CapabilityBadge
              feature="symbols"
              source={
                symbolEngine === "tree-sitter"
                  ? "tree-sitter"
                  : symbolEngine === "structural-scan"
                    ? "structural-scan"
                    : "unavailable"
              }
              note={
                symbolEngine === "tree-sitter"
                  ? "AST symbols from a real tree-sitter parse of this file."
                  : symbolEngine === "structural-scan"
                    ? "Deterministic scan over the real file content."
                    : "No parse has run for this file yet."
              }
            />
          </div>
        </Section>

        {/* Imports — REAL (parsed from the loaded tab content) */}
        <Section label="Imports" icon={<Link2 aria-hidden="true" className="size-3" />}>
          {content === null ? (
            <p className="text-[11px] text-muted-foreground">
              Open the file to analyze its imports.
            </p>
          ) : imports.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No imports detected in this file.</p>
          ) : (
            <div className="flex flex-col">
              {imports.map(({ specifier }) => {
                const resolved =
                  activeTab?.status === "ready" ? resolveRelativeImport(filePath, specifier) : null;
                if (resolved) {
                  return (
                    <RowButton
                      key={specifier}
                      onClick={() => openPath(resolved)}
                      title={`Open ${resolved}`}
                    >
                      <FileIcon name={specifier} />
                      <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-foreground/85">
                        {specifier}
                      </span>
                      <span className="shrink-0 text-[10px] text-primary/70">open</span>
                    </RowButton>
                  );
                }
                return (
                  <span
                    key={specifier}
                    className="flex items-center gap-1.5 px-1 py-0.5 text-[11px]"
                    title="Package import"
                  >
                    <Package aria-hidden="true" className="size-3 shrink-0 text-muted-foreground/60" />
                    <span className="min-w-0 truncate font-mono text-[10.5px] text-muted-foreground">
                      {specifier}
                    </span>
                  </span>
                );
              })}
            </div>
          )}
        </Section>

        {/* Dependency graph — PLANNED */}
        <Section label="Dependencies" icon={<Package aria-hidden="true" className="size-3" />}>
          <PlannedNote>Project-wide dependency graph is [PLANNED].</PlannedNote>
        </Section>

        {/* Complexity — PLANNED */}
        <Section label="Complexity" icon={<Sigma aria-hidden="true" className="size-3" />}>
          <PlannedNote>Static analysis metrics are [PLANNED].</PlannedNote>
        </Section>

        {/* Security — PLANNED */}
        <Section label="Security" icon={<ShieldCheck aria-hidden="true" className="size-3" />}>
          <PlannedNote>Security scanning is [PLANNED].</PlannedNote>
        </Section>

        {/* Tests — REAL heuristic */}
        <Section label="Tests" icon={<TestTube2 aria-hidden="true" className="size-3" />}>
          {testFiles.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No sibling test files detected.</p>
          ) : (
            <div className="flex flex-col">
              {testFiles.map((node) => (
                <FileRow key={node.path} node={node} onOpen={openPath} />
              ))}
            </div>
          )}
        </Section>

        {/* Documentation — PLANNED */}
        <Section label="Documentation" icon={<FileText aria-hidden="true" className="size-3" />}>
          <PlannedNote>Doc extraction and linkage are [PLANNED].</PlannedNote>
        </Section>

        {/* Git history — REAL */}
        <Section label="Git History" icon={<History aria-hidden="true" className="size-3" />}>
          {commitsError ? (
            <p className="text-[11px] text-muted-foreground">{commitsError}</p>
          ) : commits.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No history available for this path.</p>
          ) : (
            <div className="flex max-h-48 flex-col overflow-y-auto">
              {commits.map((commit) => (
                <CommitRow
                  key={commit.sha}
                  sha={commit.sha}
                  message={commit.message}
                  author={commit.author}
                  date={commit.date}
                />
              ))}
            </div>
          )}
        </Section>

        {/* Related files — REAL siblings */}
        <Section label="Related Files">
          {siblings.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No sibling files.</p>
          ) : (
            <div className="flex max-h-48 flex-col overflow-y-auto">
              {siblings.slice(0, 12).map((node) => (
                <FileRow key={node.path} node={node} onOpen={openPath} />
              ))}
            </div>
          )}
          {siblings.length > 12 ? (
            <p className="px-1 pt-1 text-[10px] text-muted-foreground/60">
              Showing 12 of {siblings.length} — full list in the explorer{dirPrefix ? ` (${dirPrefix})` : ""}.
            </p>
          ) : null}
        </Section>
      </div>
    </div>
  );
}
