"use client";

/**
 * CodeMind X V2 — CodePreview (Phase 1, Task 2-c)
 *
 * A dark editor-style code visual with a hand-rolled regex tokenizer
 * (no dependencies), copy-to-clipboard affordance and a one-shot staggered
 * line entrance. Presentational only: the caller supplies the code and owns
 * the demo labeling (DemoBadge lives with the consumer, not here).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check, Copy, FileCode2 } from "lucide-react";
import { CODE_PALETTE, type CodeTokenKind } from "@/components/product/shared";
import { motionDuration, motionEase } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

export interface CodePreviewProps {
  /** File path shown in the tab, e.g. "src/server/security/middleware.ts". */
  file: string;
  /** Language label, e.g. "TypeScript". Default "TypeScript". */
  language?: string;
  /** Raw code string (single \n separated lines). */
  code: string;
  /** 1-based line numbers to emphasize (selection highlight). */
  highlightLines?: number[];
  /** Show the copy-to-clipboard button. Default true. */
  showCopy?: boolean;
  /** Compact density for embedding in larger mockups. Default false. */
  compact?: boolean;
  className?: string;
}

/* ── Tokenizer ──────────────────────────────────────────────────────── */

const KEYWORDS = new Set([
  "import",
  "from",
  "export",
  "const",
  "let",
  "function",
  "return",
  "if",
  "else",
  "for",
  "await",
  "async",
  "new",
  "type",
  "interface",
  "extends",
  "implements",
  "class",
  "try",
  "catch",
  "throw",
]);

const LITERALS = new Set(["true", "false", "null", "undefined"]);

/**
 * Single-pass line scanner: comments · strings · identifiers · numbers ·
 * punctuation. Unmatched gaps (mostly whitespace) fall through as plain.
 * Ordered alternation keeps `//` inside strings and quotes inside comments
 * from mis-tokenizing.
 */
const LINE_RE =
  /(\/\/.*)|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|([A-Za-z_$][\w$]*)|(\d[\w.]*)|([^\s\w$]+)/g;

interface CodeToken {
  text: string;
  kind: CodeTokenKind;
}

function tokenizeLine(line: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let last = 0;
  LINE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LINE_RE.exec(line)) !== null) {
    if (match.index > last) {
      tokens.push({ text: line.slice(last, match.index), kind: "plain" });
    }
    const [full, comment, str, ident, num, punct] = match;
    if (comment) {
      tokens.push({ text: full, kind: "comment" });
    } else if (str) {
      tokens.push({ text: full, kind: "string" });
    } else if (ident) {
      const followedByParen = /^\s*\(/.test(line.slice(match.index + full.length));
      if (KEYWORDS.has(ident)) tokens.push({ text: full, kind: "keyword" });
      else if (LITERALS.has(ident)) tokens.push({ text: full, kind: "number" });
      else if (followedByParen) tokens.push({ text: full, kind: "fn" });
      else if (/^[A-Z]/.test(ident)) tokens.push({ text: full, kind: "type" });
      else tokens.push({ text: full, kind: "plain" });
    } else if (num) {
      tokens.push({ text: full, kind: "number" });
    } else if (punct) {
      tokens.push({ text: full, kind: "punctuation" });
    }
    last = match.index + full.length;
  }
  if (last < line.length) {
    tokens.push({ text: line.slice(last), kind: "plain" });
  }
  return tokens;
}

/** Never crash on arbitrary input — fall back to a single plain span. */
function safeTokenize(line: string): CodeToken[] {
  try {
    return tokenizeLine(line);
  } catch {
    return [{ text: line, kind: "plain" }];
  }
}

/* ── Animation constants ────────────────────────────────────────────── */

const ANIMATED_LINE_COUNT = 12;
const LINE_STAGGER_S = 0.03;
const LINE_DURATION_S = 0.26;
const COPY_RESET_MS = 1600;

/* ── Component ──────────────────────────────────────────────────────── */

export function CodePreview({
  file,
  language = "TypeScript",
  code,
  highlightLines = [],
  showCopy = true,
  compact = false,
  className,
}: CodePreviewProps) {
  const prefersReduced = useReducedMotion();
  const reduced = Boolean(prefersReduced);

  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);

  // Reset any pending "Copied" timeout on unmount.
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) window.clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const highlightSet = useMemo(() => new Set(highlightLines), [highlightLines]);
  const lines = useMemo(() => code.split("\n"), [code]);
  const tokenized = useMemo(() => lines.map(safeTokenize), [lines]);

  const handleCopy = () => {
    if (copied) return;
    try {
      navigator.clipboard
        .writeText(code)
        .then(() => {
          setCopied(true);
          if (copyTimeoutRef.current !== null) window.clearTimeout(copyTimeoutRef.current);
          copyTimeoutRef.current = window.setTimeout(() => setCopied(false), COPY_RESET_MS);
        })
        .catch(() => {
          /* clipboard unavailable or rejected — button stays idle */
        });
    } catch {
      /* navigator.clipboard missing (insecure context) — stay idle */
    }
  };

  const gutterWidth = compact ? "w-7 pr-2" : "w-9 pr-3";

  const renderRow = (tokens: CodeToken[], idx: number) => {
    const lineNumber = idx + 1;
    const highlighted = highlightSet.has(lineNumber);
    const rowClassName = cn(
      "flex border-l-2 border-l-transparent",
      highlighted && "border-primary",
    );
    const rowContent = (
      <>
        <span
          className={cn(
            "shrink-0 select-none text-right font-mono text-[11px] text-muted-foreground/50",
            gutterWidth,
            highlighted && "text-foreground",
          )}
        >
          {lineNumber}
        </span>
        <code className="whitespace-pre pr-4">
          {tokens.length === 0
            ? "\u00a0"
            : tokens.map((token, tokenIdx) => (
                <span key={tokenIdx} style={{ color: CODE_PALETTE[token.kind] }}>
                  {token.text}
                </span>
              ))}
        </code>
      </>
    );

    if (reduced || idx >= ANIMATED_LINE_COUNT) {
      return (
        <div
          key={lineNumber}
          className={rowClassName}
          style={highlighted ? { backgroundColor: "rgba(217, 142, 74, 0.12)" } : undefined}
        >
          {rowContent}
        </div>
      );
    }

    return (
      <motion.div
        key={lineNumber}
        className={rowClassName}
        style={highlighted ? { backgroundColor: "rgba(217, 142, 74, 0.12)" } : undefined}
        initial={{ opacity: 0, x: -8 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true, amount: 0.1 }}
        transition={{
          duration: LINE_DURATION_S,
          delay: idx * LINE_STAGGER_S,
          ease: motionEase.outSoft,
        }}
      >
        {rowContent}
      </motion.div>
    );
  };

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-border bg-[#131110]",
        className,
      )}
    >
      {/* Tab strip */}
      <div className="flex h-8 items-stretch border-b border-border-subtle bg-surface-elevated/40">
        <div className="relative flex items-center gap-1.5 border-r border-border-subtle bg-surface-elevated/60 px-3">
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-px bg-primary/70"
          />
          <FileCode2 className="size-3 shrink-0 text-primary/80" aria-hidden="true" />
          <span className="truncate font-mono text-[11px] text-foreground/90">{file}</span>
        </div>
        <span className="ml-auto flex items-center gap-2 pr-2">
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 sm:inline">
            {language}
          </span>
          {showCopy ? (
            <button
              type="button"
              onClick={handleCopy}
              title={copied ? "Copied" : "Copy code"}
              aria-label={copied ? "Copied to clipboard" : "Copy code to clipboard"}
              className="inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              {copied ? (
                <Check className="size-3.5 text-success" aria-hidden="true" />
              ) : (
                <Copy className="size-3.5" aria-hidden="true" />
              )}
            </button>
          ) : null}
        </span>
      </div>

      {/* Code area — horizontal scroll contained here only */}
      <div className="overflow-x-auto">
        <div
          className={cn(
            "w-max min-w-full py-2.5 font-mono",
            compact ? "text-[11px] leading-[1.55]" : "text-xs leading-[1.65]",
          )}
        >
          {tokenized.map(renderRow)}
        </div>
      </div>
    </div>
  );
}
