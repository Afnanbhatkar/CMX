"use client";

/**
 * CodeMind X V2 — chat markdown renderer.
 *
 * Memoized react-markdown (v10) with a compact component map tuned for the
 * chat density. Fenced code is delegated to AICodeBlock (8.5: fences can
 * receive their TYPED structured metadata — filename / line range / status
 * — by fence order; the markdown body itself is never parsed to derive
 * application state). Tables get sticky headers + copy toolbars; mermaid
 * fences render through the sandboxed diagram component.
 */

import { memo, isValidElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import type { StructuredCodeBlock } from "@/features/workspace/assistant/contracts";
import { AICodeBlock } from "./AICodeBlock";
import { MarkdownTable, MarkdownTd, MarkdownTh } from "./MarkdownTable";
import { MermaidBlock } from "./MermaidBlock";
import { cn } from "@/lib/utils";

export interface ChatMarkdownProps {
  content: string;
  /**
   * 8.5: typed metadata for the draft's fenced code blocks, IN ORDER
   * (from StructuredResponse.code). Absent entries render as plain blocks.
   */
  codeMeta?: StructuredCodeBlock[];
}

/** Flatten a react-markdown child tree to plain text (code contents). */
function extractText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  return "";
}

interface CodeElementProps {
  className?: string;
  children?: ReactNode;
}

function buildComponents(codeMeta: StructuredCodeBlock[] | undefined): Components {
  /** Fence counter — react-markdown renders <pre> blocks in document order. */
  let fenceIndex = 0;
  return {
    /* Fenced / indented code: take over <pre> and render the real block. */
    pre: ({ node: _node, children }) => {
      const child = Array.isArray(children) ? children[0] : children;
      if (isValidElement<CodeElementProps>(child)) {
        const language = /language-([\w+-]+)/.exec(child.props.className ?? "")?.[1];
        const code = extractText(child.props.children).replace(/\n$/, "");
        const index = fenceIndex++;
        if (language?.toLowerCase() === "mermaid") {
          return <MermaidBlock code={code} />;
        }
        const meta = codeMeta?.[index];
        return (
          <AICodeBlock
            code={code}
            language={language}
            filename={meta?.filename ?? null}
            lineStart={meta?.lineStart ?? null}
            lineEnd={meta?.lineEnd ?? null}
            status={meta?.status ?? null}
            fileStatus={meta?.fileStatus ?? null}
            highlightLines={meta?.highlightLines}
          />
        );
      }
      return (
        <pre className="overflow-x-auto rounded-lg border border-border-subtle bg-[#131110] p-2.5 font-mono text-[11.5px] leading-[1.6]">
          {children}
        </pre>
      );
    },
    /* Inline code (fenced code never reaches here — <pre> is replaced). */
    code: ({ node: _node, className, children, ...rest }) => (
      <code
        className={cn(
          "rounded bg-surface-hover px-1 py-0.5 font-mono text-[12px]",
          className,
        )}
        {...rest}
      >
        {children}
      </code>
    ),
    a: ({ node: _node, children, ...rest }) => (
      <a
        {...rest}
        target="_blank"
        rel="noreferrer"
        className="text-primary underline underline-offset-2 hover:underline"
      >
        {children}
      </a>
    ),
    p: ({ node: _node, children }) => (
      <p className="my-2 text-[13px] leading-relaxed">{children}</p>
    ),
    ul: ({ node: _node, children }) => (
      <ul className="my-2 list-disc space-y-1 pl-5 text-[13px] leading-relaxed">
        {children}
      </ul>
    ),
    ol: ({ node: _node, children }) => (
      <ol className="my-2 list-decimal space-y-1 pl-5 text-[13px] leading-relaxed">
        {children}
      </ol>
    ),
    li: ({ node: _node, children }) => (
      <li className="marker:text-muted-foreground">{children}</li>
    ),
    blockquote: ({ node: _node, children }) => (
      <blockquote className="my-2 border-l-2 border-primary/40 pl-3 text-[13px] italic leading-relaxed text-muted-foreground">
        {children}
      </blockquote>
    ),
    h1: ({ node: _node, children }) => (
      <h1 className="mb-2 mt-4 text-[15px] font-semibold leading-snug">{children}</h1>
    ),
    h2: ({ node: _node, children }) => (
      <h2 className="mb-2 mt-4 text-[14px] font-semibold leading-snug">{children}</h2>
    ),
    h3: ({ node: _node, children }) => (
      <h3 className="mb-1.5 mt-3 text-[13px] font-semibold leading-snug">{children}</h3>
    ),
    h4: ({ node: _node, children }) => (
      <h4 className="mb-1.5 mt-3 text-[13px] font-semibold leading-snug">{children}</h4>
    ),
    strong: ({ node: _node, children }) => (
      <strong className="font-semibold text-foreground">{children}</strong>
    ),
    em: ({ node: _node, children }) => <em className="italic">{children}</em>,
    /* ---- 8.5 §7: tables — sticky header, internal h-scroll, copy toolbar ---- */
    table: ({ node: _node, children }) => <MarkdownTable>{children}</MarkdownTable>,
    th: ({ node: _node, children, className }) => (
      <MarkdownTh className={className}>{children}</MarkdownTh>
    ),
    td: ({ node: _node, children, className }) => (
      <MarkdownTd className={className}>{children}</MarkdownTd>
    ),
  };
}

export const ChatMarkdown = memo(function ChatMarkdown({
  content,
  codeMeta,
}: ChatMarkdownProps) {
  return (
    <div className="text-[13px] leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      {/* remark-gfm: GFM tables (8.5 §7), strikethrough, task lists — the
          table itself renders through MarkdownTable with the sticky header
          + copy toolbar. */}
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={buildComponents(codeMeta)}>
        {content}
      </ReactMarkdown>
    </div>
  );
});
