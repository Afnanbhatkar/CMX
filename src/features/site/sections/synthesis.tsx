"use client";

/**
 * Synthesis sections — the composite "one connected context" demo (spec §30)
 * and the staggered product surface grid (spec §21-22, Vengeance-style
 * offset columns rebuilt with GSAP ScrollTrigger over CodeMind UI fragments).
 */
import { useEffect, useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { CheckCircle2, FileCode2, Folder, FolderTree, XCircle } from "lucide-react";
import { SectionShell } from "../section-shell";
import { CodePreview } from "@/components/product/CodePreview";
import { DemoBadge, StatusDot } from "@/components/product/shared";
import { ThoughtChain, type ThoughtStep } from "@/components/ai/ThoughtChain";
import { StaggeredProductGrid, type StaggeredGridItem } from "@/components/layout/StaggeredProductGrid";
import { motionDuration, motionEase } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

/* ═══════════════════════ Composite section ═══════════════════════ */

const COMPOSITE_CODE = `import { verifyRequest } from "../services/auth";

export async function authMiddleware(req: Request, next: Handler) {
  const ok = verifyRequest(req);
  if (!ok) return new Response("Unauthorized", { status: 401 });

  return next(req);
}`;

const COMPOSITE_STEPS: ThoughtStep[] = [
  { id: "cx-1", kind: "architecture", label: "authMiddleware → verifyRequest → token check", status: "done" },
  { id: "cx-2", kind: "test", label: "Covered by tests/auth.test.ts (4 cases)", status: "done" },
];

const COMPOSITE_TREE = [
  { name: "src/", depth: 0, folder: true },
  { name: "server/", depth: 1, folder: true },
  { name: "middleware.ts", depth: 2, active: true },
  { name: "services/", depth: 1, folder: true },
  { name: "auth.ts", depth: 2 },
  { name: "tests/", depth: 0, folder: true },
  { name: "auth.test.ts", depth: 1, test: true },
] as const;

const SEQUENCE_MS = [0, 450, 800, 1200, 1600] as const;

export function ContextComposite() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.35 });
  const prefersReduced = useReducedMotion();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const timers: number[] = [];
    // Deferred one tick so effect bodies never set state synchronously.
    const raf = requestAnimationFrame(() => {
      if (prefersReduced) {
        setStep(SEQUENCE_MS.length);
        return;
      }
      SEQUENCE_MS.forEach((ms, i) => {
        timers.push(window.setTimeout(() => setStep(i + 1), ms));
      });
    });
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [inView, prefersReduced]);

  const show = (n: number) => step >= n;

  const fade = (n: number) =>
    prefersReduced
      ? {}
      : {
          initial: { opacity: 0, y: 8 },
          animate: show(n) ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 },
          transition: { duration: motionDuration.base, ease: motionEase.outSoft },
        };

  return (
    <SectionShell
      id="context"
      eyebrow="One Connected Context"
      title="This is the difference"
      description="A file, its code, its place in the architecture, its tests and its explanation — one selection, everything connected. This is what the AI sees, and what you see."
      note="Choreographed demonstration with sample data."
    >
      <div
        ref={ref}
        className="overflow-hidden rounded-lg border border-border bg-surface shadow-[0_24px_60px_-30px_rgba(0,0,0,0.6)]"
      >
        {/* chrome */}
        <div className="flex h-8 items-center gap-2 border-b border-border-subtle bg-surface-elevated/60 px-3">
          <span className="flex gap-1.5" aria-hidden="true">
            <i className="size-2 rounded-full bg-muted-foreground/25" />
            <i className="size-2 rounded-full bg-muted-foreground/25" />
            <i className="size-2 rounded-full bg-muted-foreground/25" />
          </span>
          <span className="truncate font-mono text-[10.5px] text-muted-foreground">
            connected context — auth flow
          </span>
          <span className="ml-auto">
            <DemoBadge label="Sample" />
          </span>
        </div>

        <div className="grid grid-cols-1 gap-0 lg:grid-cols-[220px_1fr_300px]">
          {/* 1 — repository tree with selection */}
          <div className="border-b border-border-subtle p-3 lg:border-b-0 lg:border-r">
            <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
              <FolderTree className="size-3" aria-hidden="true" /> repository
            </p>
            <ul className="mt-2 space-y-0.5" role="list" aria-label="Repository files">
              {COMPOSITE_TREE.map((row) => (
                <li
                  key={row.name}
                  className={cn(
                    "flex items-center gap-1.5 rounded-sm px-1.5 py-1 font-mono text-[11px]",
                    "active" in row && row.active
                      ? "border-l-2 border-primary bg-primary/10 text-foreground"
                      : "text-muted-foreground",
                  )}
                  style={{ paddingLeft: 6 + row.depth * 10 }}
                >
                  {"folder" in row && row.folder ? (
                    <Folder className="size-3 shrink-0 opacity-60" aria-hidden="true" />
                  ) : (
                    <FileCode2 className="size-3 shrink-0 opacity-60" aria-hidden="true" />
                  )}
                  <span className="truncate">{row.name}</span>
                  {"test" in row && row.test && show(4) ? (
                    <CheckCircle2 className="ml-auto size-3 shrink-0 text-success" aria-hidden="true" />
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          {/* 2 — code opens, symbol highlights */}
          <div className="border-b border-border-subtle lg:border-b-0 lg:border-r">
            <CodePreview
              file="src/server/security/middleware.ts"
              code={COMPOSITE_CODE}
              highlightLines={[3]}
              showCopy={false}
              className="h-full rounded-none border-0"
            />
          </div>

          {/* 3 — graph highlights + related test + AI explanation */}
          <div className="flex flex-col gap-3 p-3">
            <div {...fade(3)}>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                architecture
              </p>
              <svg viewBox="0 0 280 92" className="mt-2 h-auto w-full" role="img" aria-label="Request path: client to middleware to service, with the middleware node highlighted">
                <path d="M12 46 H 88" stroke="rgba(214,209,200,0.25)" strokeWidth="1.5" fill="none" />
                <path d="M132 46 H 208" stroke={show(3) ? "rgba(217,142,74,0.65)" : "rgba(214,209,200,0.25)"} strokeWidth="1.5" fill="none" />
                <rect x="88" y="34" width="44" height="24" rx="5" className={show(3) ? "fill-primary/15 stroke-primary/60" : "fill-surface-elevated stroke-border-subtle"} strokeWidth="1" />
                {[
                  { x: 0, label: "client" },
                  { x: 88, label: "mw" },
                  { x: 208, label: "service" },
                ].map((n) => (
                  <text key={n.label} x={n.x + (n.label === "mw" ? 22 : n.label === "service" ? 36 : 24)} y={n.label === "mw" ? 49 : 50} textAnchor="middle" fontSize="9.5" className="fill-[#d6d1c8] font-mono">
                    {n.label}
                  </text>
                ))}
                <text x="140" y="86" textAnchor="middle" fontSize="9" className="fill-[#8a8378] font-mono">
                  request path
                </text>
              </svg>
            </div>

            <motion.div {...fade(4)} className="rounded-sm border border-border-subtle bg-surface-elevated px-2.5 py-2">
              <p className="flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground">
                <StatusDot tone="success" /> tests/auth.test.ts — 4 passing
              </p>
            </motion.div>

            <motion.div {...fade(5)} className="rounded-sm border border-primary/30 bg-primary/8 px-2.5 py-2">
              <ThoughtChain steps={COMPOSITE_STEPS} dense />
            </motion.div>
          </div>
        </div>
      </div>
    </SectionShell>
  );
}

/* ═══════════════════════ Surface grid ═══════════════════════ */

const GRID_CODE = `export function priceCart(cart: Cart, o: Options) {
  const sub = cart.items.reduce((s, i) => s + i.price * i.qty, 0);
  const discount = applyCoupons(sub, o.coupons);
  return round2(sub - discount);
}`;

function FragmentShell({
  title,
  children,
  badge,
}: {
  title: string;
  children: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <p className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
        {title}
        {badge ?? <DemoBadge />}
      </p>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function MiniTree() {
  return (
    <ul className="space-y-1 font-mono text-[10.5px] text-muted-foreground" role="list">
      {["src/", "  server/", "    middleware.ts", "  services/", "    auth.ts", "tests/"].map(
        (n) => (
          <li key={n} className="whitespace-pre truncate">
            {n}
          </li>
        ),
      )}
    </ul>
  );
}

function MiniSearch() {
  return (
    <div className="space-y-1.5">
      <p className="rounded-sm border border-border-subtle bg-surface-elevated px-2 py-1 font-mono text-[10px] text-muted-foreground">
        where is auth handled?
      </p>
      {["auth/middleware.ts", "services/auth.ts"].map((r) => (
        <p key={r} className="font-mono text-[10px] text-foreground/85">
          <mark className="rounded-[2px] bg-primary/25 px-0.5">auth</mark>
          {r.slice(4)}
        </p>
      ))}
    </div>
  );
}

function MiniGraph() {
  return (
    <svg viewBox="0 0 240 90" className="h-auto w-full" role="img" aria-label="Three connected service nodes">
      <path d="M60 22 C 100 22 100 45 120 45 M60 68 C 100 68 100 45 120 45 M160 45 H 190" fill="none" stroke="rgba(214,209,200,0.22)" strokeWidth="1.5" />
      {[
        { x: 8, y: 10 },
        { x: 8, y: 56 },
        { x: 120, y: 33, hl: true },
        { x: 190, y: 33 },
      ].map((n, i) => (
        <rect key={i} x={n.x} y={n.y} width={n.hl ? 40 : 42} height="24" rx="5" className={n.hl ? "fill-primary/15 stroke-primary/50" : "fill-surface-elevated stroke-border-subtle"} strokeWidth="1" />
      ))}
    </svg>
  );
}

function MiniSecurity() {
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5">
        <span className="rounded-sm border border-danger/30 bg-danger/15 px-1 py-0.5 font-mono text-[9px] uppercase text-danger">High</span>
        <span className="text-[10.5px] text-foreground">auth boundary issue</span>
      </p>
      <p className="font-mono text-[10px] text-muted-foreground">request → middleware → service</p>
    </div>
  );
}

function MiniTests() {
  return (
    <ul className="space-y-1" role="list">
      {[
        { t: "accepts valid token", ok: true },
        { t: "rejects expired token", ok: true },
        { t: "rejects cross-tenant", ok: false },
      ].map((r) => (
        <li key={r.t} className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          {r.ok ? (
            <CheckCircle2 className="size-3 text-success" aria-hidden="true" />
          ) : (
            <XCircle className="size-3 text-danger" aria-hidden="true" />
          )}
          {r.t}
        </li>
      ))}
    </ul>
  );
}

function MiniGit() {
  return (
    <ul className="space-y-1.5" role="list">
      {["a41fc2e fix: tenant token", "8be0113 feat: checkout", "f22c9aa chore: deps"].map((c, i) => (
        <li key={c} className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
          <span aria-hidden="true" className={cn("size-1.5 rounded-full", i === 0 ? "bg-primary" : "bg-muted-foreground/40")} />
          {c}
        </li>
      ))}
    </ul>
  );
}

const SURFACE_STEPS: ThoughtStep[] = [
  { id: "sg-1", kind: "search", label: "Searching repository", status: "done" },
  { id: "sg-2", kind: "plan", label: "Planning verification", status: "done" },
];

function MiniActivity() {
  return <ThoughtChain steps={SURFACE_STEPS} dense />;
}

function MiniTerminal() {
  return (
    <div className="space-y-1 font-mono text-[10px] leading-relaxed">
      <p className="text-muted-foreground">
        <span className="text-primary">$</span> codemind verify --diff
      </p>
      <p className="text-success/90">✓ 4 tests passed</p>
      <p className="text-success/90">✓ 0 security findings</p>
      <p className="text-muted-foreground/70">ready for review</p>
    </div>
  );
}

const SURFACE_ITEMS: StaggeredGridItem[] = [
  {
    id: "sf-editor",
    node: (
      <FragmentShell title="editor">
        <CodePreview file="services/checkout.ts" code={GRID_CODE} showCopy={false} compact className="rounded-none border-0" />
      </FragmentShell>
    ),
  },
  { id: "sf-tree", node: <FragmentShell title="repository"><MiniTree /></FragmentShell> },
  { id: "sf-search", node: <FragmentShell title="hybrid search"><MiniSearch /></FragmentShell> },
  { id: "sf-graph", node: <FragmentShell title="architecture"><MiniGraph /></FragmentShell> },
  { id: "sf-security", node: <FragmentShell title="security"><MiniSecurity /></FragmentShell> },
  { id: "sf-tests", node: <FragmentShell title="testing"><MiniTests /></FragmentShell> },
  { id: "sf-git", node: <FragmentShell title="git"><MiniGit /></FragmentShell> },
  { id: "sf-activity", node: <FragmentShell title="ai activity"><MiniActivity /></FragmentShell> },
  { id: "sf-terminal", node: <FragmentShell title="verification"><MiniTerminal /></FragmentShell> },
];

export function SurfaceSection() {
  return (
    <SectionShell
      id="surface"
      eyebrow="Product Surface"
      title="One surface, every engineering signal"
      description="Editor, repository, search, graph, security, tests, Git, activity and verification — composed into a single workspace instead of scattered tools."
      note="Interface fragments are illustrative compositions, not live data."
    >
      <StaggeredProductGrid items={SURFACE_ITEMS} />
    </SectionShell>
  );
}
