"use client";

/**
 * CodeMind X V2 — OCR Studio (REAL image text extraction).
 *
 * The honest extraction surface: upload / drag-drop / paste an image, pick
 * one of five extraction modes, and read the verbatim text the vision model
 * returned. Every visible value is measured truth from the backend job row
 * (duration, word/char counts, status) — nothing here is simulated.
 *
 * History is real: rows come from GET /api/ocr (the ocr_jobs table), click
 * re-opens a past extraction, delete removes it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ClipboardCopy,
  Clock,
  Download,
  FileImage,
  Loader2,
  ScanText,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

/* ------------------------------------------------------------------ */
/* Types (mirror of the backend OcrJobPublic contract)                 */
/* ------------------------------------------------------------------ */

interface OcrJob {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  mode: string;
  question: string | null;
  status: "processing" | "completed" | "failed";
  text: string | null;
  error: string | null;
  durationMs: number | null;
  language: string | null;
  wordCount: number;
  charCount: number;
  createdAt: string;
}

const MODES: Array<{ id: string; label: string; note: string }> = [
  { id: "plain", label: "Plain text", note: "Every visible word, verbatim — notes, signs, screenshots." },
  { id: "layout", label: "Layout", note: "Keeps headings, lists and paragraph structure." },
  { id: "code", label: "Code", note: "Code screenshots come back as clean, indented source." },
  { id: "table", label: "Tables", note: "Tabular data reconstructed as Markdown tables." },
  { id: "ask", label: "Ask", note: "Free-form question about the image, quotes verbatim." },
];

const MODE_CHIP_CLASS: Record<string, string> = {
  plain: "border-primary/40 bg-primary/10 text-primary",
  layout: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  code: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  table: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400",
  ask: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400",
};

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"]);

const SCROLLBAR_CLASS =
  "[scrollbar-color:var(--border-subtle)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border-subtle [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/* ------------------------------------------------------------------ */
/* OCR Studio panel                                                    */
/* ------------------------------------------------------------------ */

export function OcrStudioPanel() {
  /* Selection state */
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  /* Run state */
  const [mode, setMode] = useState("plain");
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<OcrJob | null>(null);

  /* History */
  const [history, setHistory] = useState<OcrJob[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);

  const inputRef = useRef<HTMLInputElement | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/ocr", { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as
        | { success?: boolean; data?: { jobs?: OcrJob[] } }
        | null;
      setHistory(body?.success && body.data?.jobs ? body.data.jobs : []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  /* Object URL lifecycle for the preview */
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const acceptFile = useCallback(
    (candidate: File | null | undefined) => {
      if (!candidate) return;
      if (!ALLOWED_MIME.has(candidate.type)) {
        toast({
          title: "Unsupported image type",
          description: "Allowed: PNG, JPEG, WebP, GIF, BMP.",
          variant: "destructive",
        });
        return;
      }
      if (candidate.size > MAX_UPLOAD_BYTES) {
        toast({
          title: "Image too large",
          description: `Maximum upload size is ${formatBytes(MAX_UPLOAD_BYTES)}.`,
          variant: "destructive",
        });
        return;
      }
      setFile(candidate);
      setResult(null);
    },
    [],
  );

  /* Global paste — a screenshot pasted anywhere while this panel is open
     lands in the drop zone (real clipboard files only). */
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.kind === "file") {
          const pasted = item.getAsFile();
          if (pasted && pasted.type.startsWith("image/")) {
            event.preventDefault();
            acceptFile(pasted);
            return;
          }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [acceptFile]);

  const runExtraction = useCallback(async () => {
    if (!file || running) return;
    if (mode === "ask" && question.trim().length === 0) {
      toast({
        title: "Question required",
        description: "Ask mode needs a question about the image.",
        variant: "destructive",
      });
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("mode", mode);
      if (mode === "ask") form.append("question", question.trim());

      const res = await fetch("/api/ocr", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as
        | { success?: boolean; data?: OcrJob; error?: { code: string; message: string } }
        | null;

      if (!body?.success || !body.data) {
        toast({
          title: "Extraction failed",
          description: body?.error?.message ?? `The server answered ${res.status}.`,
          variant: "destructive",
        });
        return;
      }
      setResult(body.data);
      if (body.data.status === "completed") {
        if (body.data.wordCount === 0 && body.data.charCount === 0) {
          toast({ title: "No readable text found", description: "The image completed but contains no text the model could read." });
        } else {
          toast({ title: "Text extracted", description: `${body.data.wordCount} words in ${body.data.durationMs ?? "?"} ms.` });
        }
      } else {
        toast({
          title: "Extraction failed",
          description: body.data.error ?? "The vision model could not process this image.",
          variant: "destructive",
        });
      }
      void loadHistory();
    } catch {
      toast({
        title: "Extraction failed",
        description: "The request to the OCR endpoint failed.",
        variant: "destructive",
      });
    } finally {
      setRunning(false);
    }
  }, [file, running, mode, question, loadHistory]);

  const copyResult = useCallback(async () => {
    if (!result?.text) return;
    try {
      await navigator.clipboard.writeText(result.text);
      toast({ title: "Copied", description: "Extracted text copied to the clipboard." });
    } catch {
      toast({
        title: "Copy failed",
        description: "The clipboard is unavailable in this context.",
        variant: "destructive",
      });
    }
  }, [result]);

  const downloadResult = useCallback(() => {
    if (!result?.text) return;
    const blob = new Blob([result.text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${result.filename.replace(/\.[^.]+$/, "") || "ocr"}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const deleteJob = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/ocr/${id}`, { method: "DELETE" });
        if (!res.ok && res.status !== 204) throw new Error(String(res.status));
        setHistory((prev) => (prev ? prev.filter((job) => job.id !== id) : prev));
        setResult((prev) => (prev?.id === id ? null : prev));
      } catch {
        toast({
          title: "Delete failed",
          description: "The history row could not be removed.",
          variant: "destructive",
        });
      }
    },
    [],
  );

  const activeMode = MODES.find((m) => m.id === mode) ?? MODES[0]!;

  return (
    <div className="h-full min-h-0 overflow-y-auto" aria-label="OCR Studio">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:py-8">
        {/* ---------------- Header ---------------- */}
        <header className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-surface"
          >
            <ScanText className="size-5 text-primary" />
          </span>
          <div className="min-w-0">
            <h1 className="text-base font-semibold leading-tight">OCR Studio</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Real text extraction from images through the vision model. Output is the
              model&apos;s verbatim reading — nothing is simulated.
            </p>
          </div>
          <Badge variant="outline" className="ml-auto hidden shrink-0 sm:inline-flex">
            <Sparkles className="mr-1 size-3" aria-hidden="true" />
            Vision model
          </Badge>
        </header>

        {/* ---------------- Main grid ---------------- */}
        <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-2">
          {/* -------- Input column -------- */}
          <section aria-label="Image input" className="flex min-w-0 flex-col gap-4">
            {/* Drop zone / preview */}
            <div
              role="button"
              tabIndex={0}
              aria-label={
                file ? `Selected image: ${file.name}. Click to replace.` : "Upload an image: click, drag and drop, or paste"
              }
              onClick={() => inputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  inputRef.current?.click();
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                acceptFile(event.dataTransfer.files?.[0]);
              }}
              className={cn(
                "group relative flex min-h-44 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed p-4 text-center transition-colors",
                dragActive
                  ? "border-primary bg-primary/5"
                  : "border-border bg-surface/40 hover:border-primary/50 hover:bg-surface",
              )}
            >
              {previewUrl ? (
                <>
                  <img
                    src={previewUrl}
                    alt={`Selected image: ${file?.name ?? "upload"}`}
                    className="max-h-72 w-auto max-w-full rounded-md object-contain"
                  />
                  <div className="mt-3 flex w-full items-center justify-center gap-2 text-xs text-muted-foreground">
                    <FileImage className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="max-w-48 truncate">{file?.name}</span>
                    <span aria-hidden="true">·</span>
                    <span className="shrink-0">{file ? formatBytes(file.size) : ""}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-1 size-6"
                      aria-label="Remove selected image"
                      onClick={(event) => {
                        event.stopPropagation();
                        setFile(null);
                        setResult(null);
                      }}
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <Upload
                    className={cn(
                      "size-7 transition-colors",
                      dragActive ? "text-primary" : "text-muted-foreground group-hover:text-primary",
                    )}
                    aria-hidden="true"
                  />
                  <p className="mt-2 text-sm font-medium">
                    {dragActive ? "Drop the image here" : "Drop an image, click to browse, or paste"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    PNG, JPEG, WebP, GIF or BMP — up to {formatBytes(MAX_UPLOAD_BYTES)}. Ctrl/Cmd+V works from anywhere.
                  </p>
                </>
              )}
              <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
                className="sr-only"
                aria-label="Choose an image file"
                onChange={(event) => {
                  acceptFile(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </div>

            {/* Mode pills */}
            <div role="radiogroup" aria-label="Extraction mode" className="flex flex-wrap gap-1.5">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.id}
                  onClick={() => setMode(m.id)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    mode === m.id
                      ? MODE_CHIP_CLASS[m.id]
                      : "border-border bg-transparent text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">{activeMode.note}</p>

            {/* Ask-mode question */}
            {mode === "ask" ? (
              <div className="space-y-1.5">
                <label htmlFor="ocr-question" className="text-xs font-medium text-foreground">
                  Your question about the image
                </label>
                <Input
                  id="ocr-question"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="e.g. What is the invoice total? Which language is this?"
                  maxLength={500}
                />
              </div>
            ) : null}

            {/* Run button */}
            <Button
              onClick={runExtraction}
              disabled={!file || running}
              className="w-full sm:w-auto sm:self-start"
            >
              {running ? (
                <>
                  <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
                  Extracting…
                </>
              ) : (
                <>
                  <ScanText className="mr-1.5 size-4" aria-hidden="true" />
                  Extract text
                </>
              )}
            </Button>
          </section>

          {/* -------- Result column -------- */}
          <section aria-label="Extraction result" className="flex min-w-0 flex-col">
            {result ? (
              <div className="flex min-h-0 flex-col rounded-lg border border-border bg-surface/40">
                {/* Meta strip */}
                <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2.5">
                  <Badge
                    variant="outline"
                    className={cn(
                      result.status === "completed"
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
                    )}
                  >
                    {result.status}
                  </Badge>
                  <Badge variant="outline" className={MODE_CHIP_CLASS[result.mode] ?? ""}>
                    {activeModeFor(result.mode)}
                  </Badge>
                  {result.status === "completed" ? (
                    <>
                      <Badge variant="outline">{result.wordCount} words</Badge>
                      <Badge variant="outline">{result.charCount} chars</Badge>
                      {result.durationMs !== null ? (
                        <Badge variant="outline">
                          <Clock className="mr-1 size-3" aria-hidden="true" />
                          {result.durationMs} ms
                        </Badge>
                      ) : null}
                      {result.language ? (
                        <Badge variant="outline">{result.language}</Badge>
                      ) : null}
                    </>
                  ) : null}
                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={copyResult}
                      disabled={!result.text}
                      aria-label="Copy extracted text"
                    >
                      <ClipboardCopy className="size-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={downloadResult}
                      disabled={!result.text}
                      aria-label="Download extracted text as .txt"
                    >
                      <Download className="size-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>

                {/* Text / error body */}
                {result.status === "failed" ? (
                  <p className="px-3 py-4 text-sm text-red-600 dark:text-red-400">
                    {result.error ?? "The extraction failed."}
                  </p>
                ) : result.wordCount === 0 && result.charCount === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">
                    The model completed the job but found no readable text in this image.
                  </p>
                ) : (
                  <pre
                    className={cn(
                      "max-h-96 min-h-40 overflow-y-auto whitespace-pre-wrap break-words px-3 py-3 font-mono text-[13px] leading-relaxed text-foreground",
                      SCROLLBAR_CLASS,
                    )}
                  >
                    {result.text}
                  </pre>
                )}
              </div>
            ) : (
              <div className="flex min-h-44 flex-1 flex-col items-center justify-center rounded-lg border border-border-subtle bg-surface/20 p-8 text-center">
                <ScanText className="size-8 text-muted-foreground/60" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium">No extraction yet</p>
                <p className="mt-1 max-w-56 text-xs text-muted-foreground">
                  Pick an image and a mode, then run the extraction. Results appear here
                  with honest measurements.
                </p>
              </div>
            )}
          </section>
        </div>

        {/* ---------------- History ---------------- */}
        <section aria-label="Extraction history" className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recent extractions</h2>
            <Button variant="ghost" size="sm" onClick={() => void loadHistory()}>
              Refresh
            </Button>
          </div>

          {historyLoading ? (
            <div className="mt-3 space-y-2" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-md bg-surface" />
              ))}
            </div>
          ) : !history || history.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              No extractions yet — your job history will appear here.
            </p>
          ) : (
            <ul className={cn("mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-1", SCROLLBAR_CLASS)}>
              {history.map((job) => (
                <li key={job.id}>
                  <div
                    className={cn(
                      "group flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
                      result?.id === job.id
                        ? "border-primary/50 bg-primary/5"
                        : "border-border bg-surface/40 hover:bg-surface-hover",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setResult(job)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      aria-label={`Open extraction result for ${job.filename}`}
                    >
                      <FileImage className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="max-w-40 truncate font-medium sm:max-w-56">{job.filename}</span>
                      <Badge
                        variant="outline"
                        className={cn("hidden shrink-0 sm:inline-flex", MODE_CHIP_CLASS[job.mode] ?? "")}
                      >
                        {activeModeFor(job.mode)}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn(
                          "shrink-0",
                          job.status === "completed"
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : job.status === "failed"
                              ? "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"
                              : "",
                        )}
                      >
                        {job.status}
                      </Badge>
                      <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">
                        {job.wordCount} words
                      </span>
                      <span className="ml-auto hidden shrink-0 text-xs text-muted-foreground sm:inline">
                        {timeAgo(job.createdAt)}
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => void deleteJob(job.id)}
                      aria-label={`Delete history entry for ${job.filename}`}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/** Mode label from id (history rows may outlive the current selection). */
function activeModeFor(mode: string): string {
  return MODES.find((m) => m.id === mode)?.label ?? mode;
}
