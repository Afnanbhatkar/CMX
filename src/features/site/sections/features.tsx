"use client";

/**
 * Features — expandable bento grid (spec §19-20).
 * Interaction pattern reconstructed from the supplied ExpandableBentoGrid
 * reference (layoutId shared-element expansion, outside click, Escape,
 * body scroll lock). Every card expands into a CodeMind-specific mini visual.
 */
import {
  Brain,
  FileDiff,
  FlaskConical,
  GitBranch,
  Network,
  Search,
  ShieldCheck,
  XCircle,
  CheckCircle2,
  FolderTree,
  Sparkles,
} from "lucide-react";
import type { BentoItem } from "@/components/layout/ExpandableBentoGrid";
import { ExpandableBentoGrid } from "@/components/layout/ExpandableBentoGrid";
import { CodePreview } from "@/components/product/CodePreview";
import { ThoughtChain, type ThoughtStep } from "@/components/ai/ThoughtChain";
import { SectionShell } from "../section-shell";

/* ── Compact demo visuals used inside expanded cards (all illustrative) ── */

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-sm border border-border-subtle bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      {children}
    </span>
  );
}

function MiniList({ rows }: { rows: { text: string; tone?: "ok" | "bad" | "hl" }[] }) {
  return (
    <ul className="space-y-1.5" role="list">
      {rows.map((r, i) => (
        <li
          key={i}
          className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground"
        >
          {r.tone === "ok" ? (
            <CheckCircle2 className="size-3.5 shrink-0 text-success" aria-hidden="true" />
          ) : r.tone === "bad" ? (
            <XCircle className="size-3.5 shrink-0 text-danger" aria-hidden="true" />
          ) : (
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />
          )}
          <span className={r.tone === "hl" ? "text-foreground" : undefined}>{r.text}</span>
        </li>
      ))}
    </ul>
  );
}

const DEMO_STEPS: ThoughtStep[] = [
  { id: "b1", kind: "search", label: "Searching repository", status: "done" },
  { id: "b2", kind: "read", label: "Reading related modules", status: "done" },
  { id: "b3", kind: "plan", label: "Summarizing context", status: "done" },
];

const BENTO_CODE = `export async function createCheckout(input: CheckoutInput) {
  const cart = await carts.get(input.cartId);
  if (!cart) throw new NotFoundError("cart");

  const total = priceCart(cart, { coupons: input.coupons });
  return payments.charge({ amount: total, currency: "usd" });
}`;

const ITEMS: BentoItem[] = [
  {
    id: "repository-intelligence",
    title: "Repository Intelligence",
    subtitle: "The codebase as a structure, not a pile of files",
    description:
      "Files, symbols, ownership and relationships indexed into a queryable model of your repository.",
    icon: FolderTree,
    span: "wide",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Designed to index your repository into a connected model: directories, symbols,
          dependencies and change history — then use it for every answer.
        </p>
        <MiniList
          rows={[
            { text: "src/services/checkout.ts → createCheckout()", tone: "hl" },
            { text: "3 callers · 2 dependents · 1 test file" },
            { text: "last change: feat: coupon stacking (#482)" },
          ]}
        />
        <div className="flex flex-wrap gap-1.5">
          <Chip>files</Chip>
          <Chip>symbols</Chip>
          <Chip>dependencies</Chip>
          <Chip>ownership</Chip>
        </div>
      </div>
    ),
  },
  {
    id: "ai-search",
    title: "AI Search",
    subtitle: "Hybrid retrieval across your whole repo",
    description:
      "Keyword, semantic and symbol search fused into one ranked result set with citations.",
    icon: Search,
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          The workspace is built to fuse three retrievers — exact keywords, meaning-based
          similarity and symbol navigation — into one answer with file citations.
        </p>
        <MiniList
          rows={[
            { text: "keyword   auth/middleware.ts:14", tone: "hl" },
            { text: "semantic  services/auth.ts — token verification" },
            { text: "symbol    verifyRequest() · AuthMiddleware" },
          ]}
        />
      </div>
    ),
  },
  {
    id: "code-understanding",
    title: "Code Understanding",
    subtitle: "Ask about any function, get the full picture",
    description:
      "Callers, dependencies, related tests and history for any symbol — explained in context.",
    icon: Brain,
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Select a symbol and the assistant gathers everything connected to it:
        </p>
        <ThoughtChain steps={DEMO_STEPS} dense />
        <div className="flex flex-wrap gap-1.5">
          <Chip>callers</Chip>
          <Chip>dependencies</Chip>
          <Chip>related tests</Chip>
          <Chip>history</Chip>
        </div>
      </div>
    ),
  },
  {
    id: "architecture",
    title: "Architecture Intelligence",
    subtitle: "See how services actually connect",
    description:
      "A living service graph with boundaries, dependencies and drift detection.",
    icon: Network,
    span: "tall",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          The platform can render your service graph — nodes, edges and boundaries — and
          highlight what a proposed change would touch.
        </p>
        <div className="rounded-md border border-border-subtle bg-surface p-3">
          <svg viewBox="0 0 320 150" className="h-auto w-full" role="img" aria-label="Miniature service graph: web, API, worker and database">
            <path d="M60 40 C 110 40 110 75 150 75" fill="none" stroke="rgba(214,209,200,0.2)" strokeWidth="1.5" />
            <path d="M60 110 C 110 110 110 75 150 75" fill="none" stroke="rgba(214,209,200,0.2)" strokeWidth="1.5" />
            <path d="M230 75 C 260 75 260 40 290 40" fill="none" stroke="rgba(217,142,74,0.5)" strokeWidth="1.5" />
            <path d="M230 75 C 260 75 260 110 290 110" fill="none" stroke="rgba(214,209,200,0.2)" strokeWidth="1.5" />
            {[
              { x: 20, y: 28, label: "web" },
              { x: 20, y: 98, label: "cli" },
              { x: 150, y: 63, label: "api", hl: true },
              { x: 240, y: 28, label: "ai" },
              { x: 240, y: 98, label: "db" },
            ].map((n) => (
              <g key={n.label}>
                <rect
                  x={n.x}
                  y={n.y}
                  width="60"
                  height="24"
                  rx="6"
                  className={n.hl ? "fill-primary/15 stroke-primary/50" : "fill-surface-elevated stroke-border-subtle"}
                />
                <text x={n.x + 30} y={n.y + 16} textAnchor="middle" className="fill-[#d6d1c8] font-mono" fontSize="10">
                  {n.label}
                </text>
              </g>
            ))}
          </svg>
        </div>
        <p className="text-[11px] text-muted-foreground/70">
          Concept visualization — the graph engine lands in a later phase.
        </p>
      </div>
    ),
  },
  {
    id: "security",
    title: "Security Intelligence",
    subtitle: "Findings with evidence, not noise",
    description:
      "Authorization boundaries, injection risks and unsafe patterns — each with a path and evidence.",
    icon: ShieldCheck,
    content: (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="rounded-sm border border-danger/30 bg-danger/15 px-1.5 py-0.5 font-mono text-[10px] uppercase text-danger">
            High
          </span>
          <span className="text-sm text-foreground">Potential authorization boundary issue</span>
        </div>
        <MiniList
          rows={[
            { text: "request → middleware → controller → service", tone: "hl" },
            { text: "auth/middleware.ts · api/users.ts" },
            { text: "evidence: missing tenant check in users.get()", tone: "bad" },
          ]}
        />
        <p className="text-[11px] text-muted-foreground/70">
          Findings always carry the affected path and the evidence to review.
        </p>
      </div>
    ),
  },
  {
    id: "testing",
    title: "Testing Intelligence",
    subtitle: "Know what a change breaks before merging",
    description:
      "Affected tests, coverage and regression risk surfaced alongside every change.",
    icon: FlaskConical,
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">auth › verifyRequest — synthetic demo run:</p>
        <MiniList
          rows={[
            { text: "accepts valid token", tone: "ok" },
            { text: "rejects expired token", tone: "ok" },
            { text: "rejects cross-tenant token", tone: "bad" },
          ]}
        />
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted-foreground/15">
            <div className="h-full w-[68%] rounded-full bg-success/70" />
          </div>
          <span className="font-mono text-[10px] text-muted-foreground">coverage 68%</span>
        </div>
      </div>
    ),
  },
  {
    id: "git",
    title: "Git Intelligence",
    subtitle: "History with impact, not just diffs",
    description:
      "Commit chains, changed files and the symbols they affect — connected to the graph.",
    icon: GitBranch,
    content: (
      <div className="space-y-3">
        <MiniList
          rows={[
            { text: "a41fc2e fix: reject cross-tenant token", tone: "hl" },
            { text: "services/auth.ts  +12 −3" },
            { text: "impact: 2 callers · 1 test file" },
          ]}
        />
        <p className="text-[11px] text-muted-foreground/70">
          Sample data — the Git engine connects real history in a later phase.
        </p>
      </div>
    ),
  },
  {
    id: "ai-coding",
    title: "AI Coding",
    subtitle: "Proposals, not silent edits",
    description:
      "ChangeSets with diffs, verification and an explicit approval step before anything applies.",
    icon: FileDiff,
    span: "wide",
    content: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          The coding workflow is explicit: understand context → plan → propose a ChangeSet →
          verify → apply. Nothing touches your repository without a visible diff and your
          approval.
        </p>
        <CodePreview
          file="services/checkout.ts — proposed change"
          code={BENTO_CODE}
          highlightLines={[4]}
          showCopy={false}
          compact
        />
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
          <span className="text-[11px] text-muted-foreground">
            AI proposes · human reviews · system verifies · then applied
          </span>
        </div>
      </div>
    ),
  },
];

export function FeaturesSection() {
  return (
    <SectionShell
      id="features"
      eyebrow="Features"
      title="One platform for the whole engineering loop"
      description="Eight connected capabilities around a single source of truth: your repository. Expand any card for the product detail."
      note="Expanded cards show conceptual product behavior — live capability arrives phase by phase."
    >
      <ExpandableBentoGrid items={ITEMS} />
    </SectionShell>
  );
}
