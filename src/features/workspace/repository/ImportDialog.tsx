"use client";

/**
 * CodeMind X V2 — repository import dialog (Phase 4, spec §7).
 *
 * Live progress follows the REAL job pipeline — nothing here is simulated:
 * - POST /api/repositories/import (JSON) or /api/repositories/import/zip
 *   (FormData) → 202 { data: { jobId } };
 * - typed REPOSITORY_IMPORT / REPOSITORY_INDEXING / JOB_FAILED events from
 *   the existing SSE endpoint GET /api/events/stream, filtered by jobId,
 *   with a 1 s polling fallback against GET /api/jobs/[jobId] (the DB row is
 *   the source of truth — the poll alone can drive the whole UI if SSE is
 *   unavailable);
 * - the chained repository.index job is discovered through
 *   GET /api/repositories/import?jobId=… (chainedJobId from the import job's
 *   finalizing checkpoint) so the Indexing step shows REAL counts;
 * - NO FAKE PROGRESS: the Cloning step has no percentage upstream — it shows
 *   a spinner + "…"; Discovering/Parsing/Indexing show real computed values;
 * - Pause/Resume/Cancel use the existing /api/jobs/[id]/control routes
 *   (cancel reaches BOTH jobs once indexing is chained — an honest cancel
 *   must stop the chained index too);
 * - completion renders the honest result (repository slug + real indexed
 *   count) plus the real imported repositories list from
 *   GET /api/repositories.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  Check,
  CloudDownload,
  Github,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type SourceKind = "github" | "git" | "zip";
type ImportStage =
  | "validating"
  | "authenticating"
  | "cloning"
  | "extracting"
  | "discovering"
  | "parsing"
  | "indexing"
  | "finalizing";

type Phase = "form" | "running" | "done" | "failed" | "cancelled";

interface RepoRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  sourceUrl?: string | null;
  createdAt: string;
}

interface JobDto {
  jobId: string;
  type: string;
  status: string;
  stage: string | null;
  progress: number;
  error: string | null;
}

interface ImportEventShape {
  jobId: string;
  stage: ImportStage;
  message: string;
  filesDiscovered?: number;
  filesParsed?: number;
  currentPath?: string;
}

interface IndexingEventShape {
  jobId: string;
  filesIndexed: number;
  totalFiles?: number;
  currentPath?: string;
}

/** Checklist per spec §7 (connecting maps to the validating stage). */
const STEPS: { key: string; label: string; stages: ImportStage[] }[] = [
  { key: "connecting", label: "Connecting", stages: ["validating"] },
  { key: "authenticating", label: "Authenticating", stages: ["authenticating"] },
  { key: "cloning", label: "Cloning", stages: ["cloning", "extracting"] },
  { key: "discovering", label: "Discovering", stages: ["discovering"] },
  { key: "parsing", label: "Parsing", stages: ["parsing"] },
  { key: "indexing", label: "Indexing", stages: ["indexing"] },
  { key: "finalizing", label: "Finalizing", stages: ["finalizing"] },
];

function stageIndex(stage: ImportStage | null): number {
  if (!stage) return -1;
  return STEPS.findIndex((s) => s.stages.includes(stage));
}

export function ImportRepositoryButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-8 gap-1.5 border-border-subtle text-xs"
        aria-haspopup="dialog"
      >
        <Plus aria-hidden="true" className="size-3.5" />
        Import repository
      </Button>
      <ImportDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

export function ImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [sourceKind, setSourceKind] = useState<SourceKind>("github");
  const [url, setUrl] = useState("");
  const [ref, setRef] = useState("");
  const [token, setToken] = useState("");
  const [zipFile, setZipFile] = useState<File | null>(null);

  const [phase, setPhase] = useState<Phase>("form");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const [chainedJobId, setChainedJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [stage, setStage] = useState<ImportStage | null>(null);
  const [stageMessage, setStageMessage] = useState<string>("");
  const [counts, setCounts] = useState({ discovered: 0, parsed: 0, indexed: 0, totalIndexed: 0 });
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [result, setResult] = useState<{ slug: string; filesIndexed: number } | null>(null);
  const [repositories, setRepositories] = useState<RepoRow[] | null>(null);

  const jobIdRef = useRef<string | null>(null);
  const chainedJobIdRef = useRef<string | null>(null);
  const countsRef = useRef(counts);
  useEffect(() => {
    countsRef.current = counts;
  }, [counts]);

  const fetchChainLink = useCallback(
    async (
      id: string,
    ): Promise<{ chainedJobId: string | null; repositorySlug: string | null } | null> => {
      try {
        const res = await fetch(`/api/repositories/import?jobId=${encodeURIComponent(id)}`, {
          cache: "no-store",
        });
        if (!res.ok) return null;
        const body = (await res.json()) as {
          success?: boolean;
          data?: { chainedJobId: string | null; repositorySlug: string | null };
        };
        return body.success && body.data ? body.data : null;
      } catch {
        return null;
      }
    },
    [],
  );

  const fetchJob = useCallback(async (id: string): Promise<JobDto | null> => {
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!res.ok) return null;
      const body = (await res.json()) as { success?: boolean; data?: JobDto };
      return body.success && body.data ? body.data : null;
    } catch {
      return null;
    }
  }, []);

  const fetchRepositories = useCallback(async () => {
    try {
      const res = await fetch("/api/repositories", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { success?: boolean; data?: { repositories: RepoRow[] } };
      if (body.success && body.data) setRepositories(body.data.repositories);
    } catch {
      setRepositories(null); // honest: list unavailable right now
    }
  }, []);

  /* Reset everything when the dialog closes. */
  useEffect(() => {
    if (open) return;
    setSourceKind("github");
    setUrl("");
    setRef("");
    setToken("");
    setZipFile(null);
    setPhase("form");
    setSubmitting(false);
    setFormError(null);
    setJobId(null);
    setChainedJobId(null);
    setJobStatus(null);
    setJobError(null);
    setPaused(false);
    setStage(null);
    setStageMessage("");
    setCounts({ discovered: 0, parsed: 0, indexed: 0, totalIndexed: 0 });
    setCurrentPath(null);
    setResult(null);
    jobIdRef.current = null;
    chainedJobIdRef.current = null;
  }, [open]);

  /* Real imported repositories list (rendered inside the dialog). */
  useEffect(() => {
    if (open) void fetchRepositories();
  }, [open, fetchRepositories]);

  const finish = useCallback(
    (slug: string | null) => {
      setResult({ slug: slug ?? "repository", filesIndexed: countsRef.current.indexed });
      setPhase("done");
      setJobStatus("COMPLETED");
      void fetchRepositories();
    },
    [fetchRepositories],
  );

  const fail = useCallback((message: string, cancelled: boolean) => {
    setJobError(message);
    setPhase(cancelled ? "cancelled" : "failed");
  }, []);

  /* Polling fallback (1 s) — the DB row is the source of truth and this loop
   * alone can drive every transition (SSE only makes it snappier). */
  useEffect(() => {
    if (phase !== "running" || !jobId) return;
    const tick = async () => {
      const active = chainedJobIdRef.current ?? jobIdRef.current;
      if (!active) return;
      const job = await fetchJob(active);
      if (!job) return;

      if (job.status === "QUEUED" || job.status === "RUNNING" || job.status === "PAUSED") {
        setJobStatus(job.status);
        setPaused(job.status === "PAUSED");
        return;
      }
      if (job.status === "FAILED" || job.status === "CANCELLED") {
        fail(job.error ?? `Job ${job.status.toLowerCase()}.`, job.status === "CANCELLED");
        return;
      }
      /* COMPLETED */
      if (active === chainedJobIdRef.current) {
        const chain = await fetchChainLink(jobIdRef.current ?? "");
        finish(chain?.repositorySlug ?? null);
        return;
      }
      // Import job completed → attach to the chained index job (or finish).
      const chain = await fetchChainLink(jobIdRef.current!);
      if (chain?.chainedJobId) {
        chainedJobIdRef.current = chain.chainedJobId;
        setChainedJobId(chain.chainedJobId);
        setStage("indexing");
        setStageMessage("Indexing repository files");
        const chained = await fetchJob(chain.chainedJobId);
        if (chained) {
          if (chained.status === "COMPLETED") {
            finish(chain.repositorySlug ?? null);
          } else if (chained.status === "FAILED" || chained.status === "CANCELLED") {
            fail(chained.error ?? `Indexing ${chained.status.toLowerCase()}.`, chained.status === "CANCELLED");
          } else {
            setJobStatus(chained.status);
            setPaused(chained.status === "PAUSED");
          }
        }
        return;
      }
      finish(chain?.repositorySlug ?? null);
    };
    const interval = setInterval(() => void tick(), 1000);
    return () => clearInterval(interval);
  }, [phase, jobId, fetchJob, fetchChainLink, finish, fail]);

  /* SSE subscription — typed events from the existing stream endpoint. */
  useEffect(() => {
    if (phase !== "running" || !jobId) return;
    let source: EventSource | null = null;
    try {
      source = new EventSource("/api/events/stream?replay=1");

      source.addEventListener("REPOSITORY_IMPORT", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent<string>).data) as ImportEventShape;
          if (data.jobId !== jobIdRef.current) return;
          setStage(data.stage);
          setStageMessage(data.message);
          if (data.filesDiscovered !== undefined)
            setCounts((c) => ({ ...c, discovered: data.filesDiscovered as number }));
          if (data.filesParsed !== undefined)
            setCounts((c) => ({ ...c, parsed: data.filesParsed as number }));
          if (data.currentPath !== undefined) setCurrentPath(data.currentPath);
        } catch {
          // malformed frame — the poll remains the source of truth
        }
      });

      source.addEventListener("REPOSITORY_INDEXING", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent<string>).data) as IndexingEventShape;
          if (!chainedJobIdRef.current || data.jobId !== chainedJobIdRef.current) return;
          setCounts((c) => ({
            ...c,
            indexed: data.filesIndexed,
            totalIndexed: data.totalFiles ?? c.totalIndexed,
          }));
          if (data.currentPath) setCurrentPath(data.currentPath);
        } catch {
          // ignore — poll fallback
        }
      });

      source.addEventListener("JOB_FAILED", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent<string>).data) as { jobId: string; error: string };
          const relevant = data.jobId === jobIdRef.current || data.jobId === chainedJobIdRef.current;
          if (relevant) fail(data.error, false);
        } catch {
          // ignore — poll fallback
        }
      });
    } catch {
      // EventSource unavailable — the 1 s poll drives the UI alone.
    }
    return () => {
      source?.close();
    };
  }, [phase, jobId, fail]);

  const submit = useCallback(async () => {
    setFormError(null);
    setSubmitting(true);
    try {
      let res: Response;
      if (sourceKind === "zip") {
        if (!zipFile) {
          setFormError("Choose a .zip archive to import.");
          return;
        }
        const form = new FormData();
        form.set("file", zipFile);
        res = await fetch("/api/repositories/import/zip", { method: "POST", body: form });
      } else {
        if (!url.trim()) {
          setFormError(
            sourceKind === "github" ? "Enter a GitHub repository URL." : "Enter an HTTPS git URL.",
          );
          return;
        }
        const payload: Record<string, unknown> = { kind: sourceKind, url: url.trim() };
        if (ref.trim()) payload.ref = ref.trim();
        if (token.trim()) payload.token = token.trim();
        res = await fetch("/api/repositories/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      const body = (await res.json().catch(() => null)) as
        | { success?: boolean; data?: { jobId: string }; error?: { message: string } }
        | null;

      if (res.status === 202 && body?.success && body.data?.jobId) {
        jobIdRef.current = body.data.jobId;
        setJobId(body.data.jobId);
        setPhase("running");
        setStage(null);
        setStageMessage("Queued…");
        return;
      }
      setFormError(body?.error?.message ?? `The import request failed (HTTP ${res.status}).`);
    } catch {
      setFormError("The import service is unreachable right now.");
    } finally {
      setSubmitting(false);
    }
  }, [sourceKind, url, ref, token, zipFile]);

  const control = useCallback(
    async (action: "pause" | "resume" | "cancel") => {
      if (!jobId) return;
      try {
        // Cancel reaches BOTH jobs during the indexing stage (the chained job
        // would otherwise keep running — an honest cancel stops it too).
        const targets = [jobId];
        if (action === "cancel" && chainedJobIdRef.current && chainedJobIdRef.current !== jobId) {
          targets.push(chainedJobIdRef.current);
        }
        for (const target of targets) {
          await fetch(`/api/jobs/${encodeURIComponent(target)}/control`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
          }).catch(() => undefined);
        }
        const job = await fetchJob(jobId);
        if (job) {
          setJobStatus(job.status);
          setPaused(job.status === "PAUSED");
        }
      } catch {
        // control unreachable — the poll reflects the real state shortly
      }
    },
    [jobId, fetchJob],
  );

  /* ---------------- derived checklist state ---------------- */
  const activeIdx = stageIndex(stage);
  const chainedActive = Boolean(chainedJobId) || stage === "indexing";
  const parsingPct =
    counts.discovered > 0 ? Math.round((counts.parsed / counts.discovered) * 100) : null;
  const indexingPct =
    counts.totalIndexed > 0
      ? Math.min(100, Math.round((counts.indexed / counts.totalIndexed) * 100))
      : null;

  const stepState = (idx: number): "pending" | "active" | "done" => {
    if (phase === "done") return "done";
    if (idx < activeIdx) return "done";
    if (idx === activeIdx) return "active";
    return "pending";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" aria-describedby="import-dialog-description">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <CloudDownload aria-hidden="true" className="size-4 text-primary" />
            Import repository
          </DialogTitle>
          <DialogDescription id="import-dialog-description" className="text-xs">
            Clones or uploads a repository into an isolated workspace, then indexes it with a real
            background job. Nothing here is simulated.
          </DialogDescription>
        </DialogHeader>

        {phase === "form" && (
          <div className="flex flex-col gap-3 px-1 py-1">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import-source-kind" className="text-xs">
                Source
              </Label>
              <Select value={sourceKind} onValueChange={(value) => setSourceKind(value as SourceKind)}>
                <SelectTrigger id="import-source-kind" className="h-8 text-xs" aria-label="Import source kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="github" className="text-xs">
                    GitHub
                  </SelectItem>
                  <SelectItem value="git" className="text-xs">
                    Git URL (HTTPS)
                  </SelectItem>
                  <SelectItem value="zip" className="text-xs">
                    ZIP upload
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {sourceKind !== "zip" ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="import-url" className="text-xs">
                    {sourceKind === "github" ? "GitHub URL" : "Git URL (HTTPS)"}
                  </Label>
                  <Input
                    id="import-url"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder={
                      sourceKind === "github"
                        ? "https://github.com/owner/repo"
                        : "https://git.example.com/owner/repo.git"
                    }
                    className="h-8 text-xs"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="import-ref" className="text-xs">
                    Ref <span className="text-muted-foreground">(optional — branch, tag or commit)</span>
                  </Label>
                  <Input
                    id="import-ref"
                    value={ref}
                    onChange={(event) => setRef(event.target.value)}
                    placeholder="main"
                    className="h-8 font-mono text-xs"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="import-token" className="text-xs">
                    Token <span className="text-muted-foreground">(optional — private repositories)</span>
                  </Label>
                  <Input
                    id="import-token"
                    type="password"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder="personal access token"
                    className="h-8 text-xs"
                    autoComplete="off"
                  />
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Used for this request only — never stored. GitHub OAuth app authorization is [PLANNED].
                  </p>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="import-zip" className="text-xs">
                  Archive (.zip)
                </Label>
                <Input
                  id="import-zip"
                  type="file"
                  accept=".zip,application/zip"
                  onChange={(event) => setZipFile(event.target.files?.[0] ?? null)}
                  className="h-8 cursor-pointer text-xs"
                  aria-describedby="import-zip-help"
                />
                <p id="import-zip-help" className="text-[11px] leading-relaxed text-muted-foreground">
                  Up to 32 MB. Entries are sanitized (traversal, size and ratio guards) before anything is written.
                </p>
              </div>
            )}

            {formError && (
              <p
                role="alert"
                className="flex items-start gap-1.5 rounded-md bg-warning/10 px-2 py-1.5 text-[11px] leading-relaxed text-warning"
              >
                <AlertTriangle aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
                {formError}
              </p>
            )}
          </div>
        )}

        {phase !== "form" && (
          <div className="flex flex-col gap-3 px-1 py-1">
            <ol className="flex flex-col gap-1" aria-label="Import progress checklist">
              {STEPS.map((step, idx) => {
                const state = stepState(idx);
                const isClone = step.key === "cloning";
                return (
                  <li
                    key={step.key}
                    className="flex items-center gap-2 text-xs"
                    aria-current={state === "active" ? "step" : undefined}
                  >
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-full border",
                        state === "done" && "border-primary/60 bg-primary/15 text-primary",
                        state === "active" && "border-primary/60 text-primary",
                        state === "pending" && "border-border-subtle text-muted-foreground/50",
                      )}
                    >
                      {state === "done" ? (
                        <Check aria-hidden="true" className="size-2.5" strokeWidth={3} />
                      ) : state === "active" && isClone ? (
                        <LoaderCircle aria-hidden="true" className="size-3 animate-spin" />
                      ) : (
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            state === "active" ? "bg-primary" : "bg-muted-foreground/30",
                          )}
                        />
                      )}
                    </span>
                    <span
                      className={cn(
                        state === "done" && "text-muted-foreground",
                        state === "active" && "font-medium text-foreground",
                        state === "pending" && "text-muted-foreground/60",
                      )}
                    >
                      {step.label}
                    </span>
                    {state === "active" && isClone && (
                      <span className="text-muted-foreground" aria-label="No percentage available while cloning">
                        …
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>

            {/* Real computed percentages only — never a fabricated number. */}
            {(stage === "parsing" || chainedActive) && (
              <div className="flex flex-col gap-1">
                <Progress
                  value={chainedActive ? (indexingPct ?? 0) : (parsingPct ?? 0)}
                  className="h-1.5"
                  aria-label={chainedActive ? "Indexing progress" : "Parsing progress"}
                />
                <p className="text-[11px] text-muted-foreground">
                  {chainedActive
                    ? `${counts.indexed}${counts.totalIndexed > 0 ? ` / ${counts.totalIndexed}` : ""} files indexed`
                    : `${counts.parsed} / ${counts.discovered} files parsed`}
                </p>
              </div>
            )}

            <div className="rounded-md border border-border-subtle bg-surface px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
              <p className="text-foreground/90">
                {paused ? "Paused" : (stageMessage || "Working…")}
              </p>
              {counts.discovered > 0 && !chainedActive && (
                <p>
                  {counts.discovered} files discovered
                  {counts.parsed > 0 ? ` · ${counts.parsed} parsed` : ""}
                </p>
              )}
              {currentPath && (stage === "discovering" || stage === "parsing" || chainedActive) && (
                <p className="truncate font-mono" title={currentPath}>
                  {currentPath}
                </p>
              )}
              {paused && <p className="text-warning">Paused — resume to continue.</p>}
            </div>

            {(phase === "failed" || phase === "cancelled") && (
              <p
                role="alert"
                className="flex items-start gap-1.5 rounded-md bg-warning/10 px-2 py-1.5 text-[11px] leading-relaxed text-warning"
              >
                <AlertTriangle aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
                {jobError ?? `Import ${phase}.`}
              </p>
            )}

            {phase === "done" && result && (
              <div className="flex items-start gap-1.5 rounded-md bg-primary/10 px-2 py-1.5 text-[11px] leading-relaxed text-foreground">
                <Check aria-hidden="true" className="mt-0.5 size-3 shrink-0 text-primary" strokeWidth={3} />
                <span>
                  Imported <span className="font-mono font-medium">{result.slug}</span>
                  {result.filesIndexed > 0 ? ` — ${result.filesIndexed} files indexed.` : "."}
                </span>
              </div>
            )}

            {phase === "running" && (
              <div className="flex items-center gap-2">
                {paused ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 text-[11px]"
                    onClick={() => void control("resume")}
                  >
                    <Play aria-hidden="true" className="size-3" />
                    Resume
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 text-[11px]"
                    onClick={() => void control("pause")}
                  >
                    <Pause aria-hidden="true" className="size-3" />
                    Pause
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-[11px]"
                  onClick={() => void control("cancel")}
                >
                  <X aria-hidden="true" className="size-3" />
                  Cancel
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Real imported repositories (GET /api/repositories). */}
        {repositories !== null && repositories.length > 0 && (
          <div className="mt-1 flex flex-col gap-1 border-t border-border-subtle px-1 pt-2">
            <p className="text-[11px] font-medium text-foreground/80">Imported repositories</p>
            <div className="max-h-40 overflow-y-auto pr-1">
              <ul className="flex flex-col gap-1" aria-label="Imported repositories">
                {repositories
                  .filter((repo) => repo.slug !== "workspace")
                  .map((repo) => (
                    <li
                      key={repo.id}
                      className="flex items-center gap-2 rounded-md border border-border-subtle px-2 py-1.5 text-[11px]"
                    >
                      <Github aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
                      <span
                        className="min-w-0 flex-1 truncate font-mono text-foreground/90"
                        title={repo.sourceUrl ?? repo.slug}
                      >
                        {repo.name}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "shrink-0 px-1.5 py-0 text-[10px]",
                          repo.status === "connected" && "border-primary/40 text-primary",
                          repo.status === "indexing" && "border-border-subtle text-muted-foreground",
                          repo.status === "unavailable" && "border-warning/40 text-warning",
                        )}
                      >
                        {repo.status}
                      </Badge>
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        )}

        <DialogFooter className="mt-2">
          {phase === "form" ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => void submit()}
                disabled={submitting}
              >
                {submitting ? (
                  <LoaderCircle aria-hidden="true" className="size-3 animate-spin" />
                ) : (
                  <Archive aria-hidden="true" className="size-3.5" />
                )}
                {submitting ? "Starting…" : "Import"}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => onOpenChange(false)}
            >
              {phase === "done" ? "Close" : "Hide"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
