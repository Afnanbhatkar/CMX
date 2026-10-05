"use client";

/**
 * CodeMind X V2 — Phase 8.5 §7 response tables.
 *
 * Markdown tables render with a STICKY header, internal horizontal scroll
 * only (never page overflow), and a copy toolbar: Copy as Markdown and
 * Copy as CSV. Cell text is extracted from the markdown AST children the
 * renderer already produced — no application state is derived from it.
 */

import { isValidElement, memo, type ReactElement, type ReactNode } from "react";
import { Copy, FileSpreadsheet } from "lucide-react";

import { cn } from "@/lib/utils";

function cellText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(cellText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return cellText(node.props.children);
  return "";
}

/** Walk thead/tbody → tr → th/td into a string matrix. */
function collectRows(children: ReactNode): { head: string[]; rows: string[][] } {
  let head: string[] = [];
  const rows: string[][] = [];
  const toArr = (node: ReactNode): ReactNode[] => (Array.isArray(node) ? node : [node]);
  const cellsOf = (tr: ReactElement<{ children?: ReactNode }>): string[] => {
    const cells: string[] = [];
    for (const cell of toArr(tr.props.children)) {
      if (!isValidElement<{ children?: ReactNode }>(cell)) continue;
      const cellTag = typeof cell.type === "string" ? cell.type : "";
      if (cellTag === "td" || cellTag === "th") cells.push(cellText(cell.props.children).trim());
    }
    return cells;
  };
  const walk = (level: ReactNode, section: "head" | "body" | "unknown"): void => {
    for (const child of toArr(level)) {
      if (!isValidElement<{ children?: ReactNode }>(child)) continue;
      const tag = typeof child.type === "string" ? child.type : "";
      if (tag === "thead") walk(child.props.children, "head");
      else if (tag === "tbody" || tag === "tfoot") walk(child.props.children, "body");
      else if (tag === "tr") {
        const cells = cellsOf(child);
        if (cells.length === 0) continue;
        if (section === "head" && head.length === 0) head = cells;
        else rows.push(cells);
      } else {
        walk(child.props.children, section);
      }
    }
  };
  walk(children, "unknown");
  return { head, rows };
}

function toMarkdown(head: string[], rows: string[][]): string {
  const width = Math.max(head.length, ...rows.map((r) => r.length), 1);
  const pad = (cells: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => (cells[i] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`;
  const lines = [pad(head.length > 0 ? head : Array.from({ length: width }, () => ""))];
  lines.push(`| ${Array.from({ length: width }, () => "---").join(" | ")} |`);
  for (const row of rows) lines.push(pad(row));
  return lines.join("\n");
}

function toCsv(head: string[], rows: string[][]): string {
  const escape = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const all = head.length > 0 ? [head, ...rows] : rows;
  return all.map((row) => row.map(escape).join(",")).join("\n");
}

export const MarkdownTable = memo(function MarkdownTable({
  children,
}: {
  children?: ReactNode;
}) {
  const { head, rows } = collectRows(children);

  const copyAs = (text: string, label: string) => {
    try {
      void navigator.clipboard.writeText(text).catch(() => {
        // clipboard denied — table stays visible either way
      });
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <div
      className="my-2 overflow-hidden rounded-lg border border-border-subtle"
      data-testid="ai-table"
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/5 bg-surface px-2 py-1">
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <FileSpreadsheet aria-hidden="true" className="size-3" />
          Table{head.length > 0 ? ` · ${rows.length + 1} rows` : ""}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => copyAs(toMarkdown(head, rows), "markdown")}
            className="inline-flex h-5 items-center gap-1 rounded px-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label="Copy table as Markdown"
          >
            <Copy aria-hidden="true" className="size-3" />
            Markdown
          </button>
          <button
            type="button"
            onClick={() => copyAs(toCsv(head, rows), "csv")}
            className="inline-flex h-5 items-center gap-1 rounded px-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label="Copy table as CSV"
          >
            <Copy aria-hidden="true" className="size-3" />
            CSV
          </button>
        </div>
      </div>
      <div className="max-w-full overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          {children}
        </table>
      </div>
    </div>
  );
});

export function MarkdownTh({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "sticky top-0 z-10 whitespace-nowrap border-b border-border-subtle bg-surface-elevated px-2.5 py-1.5 text-left font-medium text-foreground",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function MarkdownTd({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <td className={cn("border-b border-border-subtle/60 px-2.5 py-1.5 align-top text-foreground/90", className)}>
      {children}
    </td>
  );
}
