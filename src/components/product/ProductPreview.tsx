"use client";

/**
 * CodeMind X V2 — ProductPreview (Phase 1 public site)
 *
 * A miniature but realistic preview of the future CodeMind X workspace
 * layout (Phase 2): CodeMind X sidebar + AI Chat sidebar + AI Chat +
 * Repository/Code, in the conceptual 11% / 11% / 39% / 39% proportions.
 *
 * This is a PRODUCT PREVIEW, not the workspace itself:
 * - no interactive controls (decorative divs only, no nested buttons)
 * - content is illustrative and labeled via the frame's demo badge
 * - the entrance choreography runs once, then everything settles
 * - reduced motion renders the fully settled state immediately
 *
 * Loaded client-side via next/dynamic so it never delays first paint.
 */
import { motion, useReducedMotion, type Variants } from "framer-motion";
import {
  FlaskConical,
  FolderTree,
  GitBranch,
  MessageSquare,
  Plus,
  Search,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { ThoughtChain, type ThoughtStep } from "@/components/ai/ThoughtChain";
import { LatticeLoader } from "@/components/ai/LatticeLoader";
import { CodePreview } from "@/components/product/CodePreview";
import { DemoBadge } from "@/components/product/shared";
import { motionDuration, motionEase } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

const AUTH_CODE = `import { createHmac, timingSafeEqual } from "node:crypto";

import type { RequestContext } from "../types";

// Verifies the bearer token attached to an incoming request.
export function verifyRequest(req: RequestContext): boolean {
  const token = req.headers.authorization?.slice(7);
  if (!token) return false;

  const digest = createHmac("sha256", secret).update(token).digest();
  return timingSafeEqual(digest, expected);
}`;

const CHAT_STEPS: ThoughtStep[] = [
  { id: "pp-s1", kind: "search", label: "Searching repository for auth modules", status: "done" },
  { id: "pp-s2", kind: "read", label: "Reading src/server/security/middleware.ts", status: "done" },
  { id: "pp-s3", kind: "plan", label: "Tracing request path", status: "done" },
];

const TREE_ROWS = [
  { depth: 0, name: "src/", folder: true },
  { depth: 1, name: "server/", folder: true },
  { depth: 2, name: "security/", folder: true },
  { depth: 2, name: "middleware.ts" },
  { depth: 1, name: "services/", folder: true },
  { depth: 2, name: "auth.ts", active: true },
  { depth: 1, name: "api/", folder: true },
  { depth: 2, name: "users.ts" },
  { depth: 0, name: "tests/", folder: true },
  { depth: 1, name: "auth.test.ts" },
] as const;

/* ── Entrance choreography ──────────────────────────────────────────── */

const shellVariants: Variants = {
  hidden: { opacity: 0, y: 24, scale: 0.985 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: motionDuration.slow, ease: motionEase.outSoft },
  },
};

/** Panel-level entrance: each pane settles in sequence, then stops. */
function panel(delay: number): Variants {
  return {
    hidden: { opacity: 0, x: -8 },
    show: {
      opacity: 1,
      x: 0,
      transition: { delay, duration: motionDuration.base, ease: motionEase.outSoft },
    },
  };
}

/** Inner content entrance: streams in after its panel lands, then stops. */
function content(delay: number, y = 8): Variants {
  return {
    hidden: { opacity: 0, y },
    show: {
      opacity: 1,
      y: 0,
      transition: { delay, duration: motionDuration.base, ease: motionEase.outSoft },
    },
  };
}

/* ── Small pieces ───────────────────────────────────────────────────── */

const SIDEBAR_ICONS = [
  { icon: MessageSquare, label: "AI chat", active: true },
  { icon: FolderTree, label: "Repository", active: false },
  { icon: Search, label: "Search", active: false },
  { icon: GitBranch, label: "Git", active: false },
  { icon: ShieldCheck, label: "Security", active: false },
  { icon: FlaskConical, label: "Testing", active: false },
] as const;

function CodeSidebar() {
  return (
    <div className="flex h-full flex-col items-center gap-1 py-2" aria-hidden="true">
      {/* Brand mark */}
      <div className="mb-1 grid size-7 place-items-center rounded-sm border border-primary/30 bg-primary/10">
        <span className="font-mono text-[10px] font-semibold text-primary">CX</span>
      </div>
      {SIDEBAR_ICONS.map(({ icon: Icon, label, active }) => (
        <span
          key={label}
          title={label}
          className={cn(
            "grid size-7 place-items-center rounded-sm",
            active
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground/70 hover:bg-surface-hover",
          )}
        >
          <Icon className="size-3.5" />
        </span>
      ))}
      <span className="mt-auto grid size-7 place-items-center rounded-sm text-muted-foreground/70">
        <Settings className="size-3.5" />
      </span>
    </div>
  );
}

function ChatSidebar() {
  const sessions = [
    { title: "Trace auth flow", active: true },
    { title: "Fix checkout validation", active: false },
    { title: "Add rate limiting", active: false },
  ];
  return (
    <div className="flex h-full flex-col py-2" aria-hidden="true">
      <div className="mx-2 mb-2 flex items-center gap-1.5 rounded-sm border border-border-subtle bg-surface-elevated px-2 py-1.5">
        <Plus className="size-3 text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground">New session</span>
      </div>
      <p className="px-2.5 pb-1 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/60">
        Sessions
      </p>
      {sessions.map((s) => (
        <div
          key={s.title}
          className={cn(
            "mx-1.5 truncate rounded-sm px-2 py-1.5 text-[10.5px]",
            s.active
              ? "bg-primary/12 text-foreground"
              : "text-muted-foreground/80 hover:bg-surface-hover",
          )}
        >
          {s.title}
        </div>
      ))}
    </div>
  );
}

function ChatArea() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          AI Chat
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <LatticeLoader cellSize={4} label="Working" />
          <span className="font-mono text-[9.5px] text-muted-foreground/70">assistant ready</span>
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* User turn */}
        <motion.div variants={content(0.62)} className="self-end">
          <p className="max-w-[85%] rounded-sm rounded-br-none border border-border-subtle bg-surface-elevated px-2.5 py-1.5 text-[11px] leading-snug text-foreground">
            Find where authentication is handled and explain the request flow.
          </p>
        </motion.div>
        {/* Activity trace */}
        <motion.div variants={content(0.78)}>
          <ThoughtChain steps={CHAT_STEPS} dense className="max-w-[92%]" />
        </motion.div>
        {/* Assistant turn */}
        <motion.div variants={content(0.94)} className="max-w-[92%]">
          <div className="rounded-sm rounded-bl-none border border-border-subtle bg-surface-elevated px-2.5 py-2">
            <p className="text-[11px] leading-snug text-foreground/90">
              Authentication is handled in{" "}
              <code className="font-mono text-[10px] text-primary">auth/middleware.ts</code>. Each
              request passes through the middleware, which calls{" "}
              <code className="font-mono text-[10px] text-primary">verifyRequest()</code> before a
              route handler runs.
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {["auth/middleware.ts", "services/auth.ts", "tests/auth.test.ts"].map((f) => (
                <span
                  key={f}
                  className="rounded-sm border border-border-subtle bg-surface px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground"
                >
                  {f}
                </span>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function RepoPanel() {
  return (
    <div className="flex h-full overflow-hidden">
      {/* Mini tree */}
      <motion.div
        variants={content(0.86, 6)}
        className="hidden w-[38%] shrink-0 flex-col gap-px overflow-hidden border-r border-border-subtle p-2 sm:flex"
        aria-hidden="true"
      >
        <p className="pb-1 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/60">
          Repository
        </p>
        {TREE_ROWS.map((row) => (
          <div
            key={`${row.depth}-${row.name}`}
            className={cn(
              "flex items-center gap-1 rounded-sm px-1 py-[3px] font-mono text-[10px]",
              "active" in row && row.active
                ? "bg-primary/12 text-primary"
                : "text-muted-foreground/85",
            )}
            style={{ paddingLeft: `${8 + row.depth * 10}px` }}
          >
            <FolderTree
              className={cn("size-2.5 shrink-0", "folder" in row && row.folder ? "opacity-70" : "opacity-0")}
            />
            <span className="truncate">{row.name}</span>
          </div>
        ))}
      </motion.div>
      {/* Editor */}
      <div className="min-w-0 flex-1">
        <motion.div variants={content(0.98, 6)} className="h-full">
          <CodePreview
            file="src/services/auth.ts"
            code={AUTH_CODE}
            highlightLines={[7]}
            compact
            showCopy={false}
            className="h-full rounded-none border-0 bg-[#131110]"
          />
        </motion.div>
      </div>
    </div>
  );
}

/* ── Component ──────────────────────────────────────────────────────── */

export interface ProductPreviewProps {
  className?: string;
}

export function ProductPreview({ className }: ProductPreviewProps) {
  const prefersReduced = useReducedMotion();
  const reduced = Boolean(prefersReduced);

  return (
    <motion.div
      variants={shellVariants}
      initial={reduced ? false : "hidden"}
      animate="show"
      role="img"
      aria-label="Preview of the CodeMind X workspace: navigation sidebar, AI chat sidebar, AI chat with an activity trace, and a repository code panel"
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-surface",
        "shadow-[0_32px_80px_-24px_rgba(0,0,0,0.65)]",
        className,
      )}
    >
      {/* Window chrome */}
      <div className="flex h-8 items-center gap-2 border-b border-border-subtle bg-surface-elevated px-3">
        <span className="flex gap-1.5" aria-hidden="true">
          <i className="size-2 rounded-full bg-muted-foreground/25" />
          <i className="size-2 rounded-full bg-muted-foreground/25" />
          <i className="size-2 rounded-full bg-muted-foreground/25" />
        </span>
        <span className="truncate font-mono text-[10.5px] text-muted-foreground">
          codemind-x — workspace
        </span>
        <span className="ml-auto">
          <DemoBadge label="Preview" />
        </span>
      </div>

      {/* 4-pane workspace: 11 / 11 / 39 / 39 (mobile: chat + code stacked) */}
      <div className="grid h-[420px] grid-cols-1 grid-rows-[1.15fr_1fr] sm:h-[440px] sm:grid-cols-[11fr_39fr_39fr] sm:grid-rows-1 md:h-[480px] md:grid-cols-[11fr_11fr_39fr_39fr]">
        <motion.nav
          variants={panel(0.12)}
          className="hidden border-r border-border-subtle bg-[#161412] md:block"
          aria-hidden="true"
        >
          <CodeSidebar />
        </motion.nav>

        <motion.div
          variants={panel(0.24)}
          className="hidden border-r border-border-subtle bg-[#161412] sm:block"
          aria-hidden="true"
        >
          <ChatSidebar />
        </motion.div>

        <motion.section variants={panel(0.38)} className="min-w-0 border-r border-border-subtle">
          <ChatArea />
        </motion.section>

        <motion.section variants={panel(0.52)} className="min-w-0">
          <RepoPanel />
        </motion.section>
      </div>
    </motion.div>
  );
}
