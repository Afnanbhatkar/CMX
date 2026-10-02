"use client";

/**
 * CodeMind X V2 — GraphPreview (Phase 1, Task 2-c)
 *
 * A conceptual service-graph visual: 8 labeled nodes, gently curved edges,
 * a single AI pulse, all drawn in one responsive inline SVG (no graph
 * library). Clearly-labeled sample architecture — the DemoBadge in the
 * header marks it as illustrative, not live topology.
 */
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { DemoBadge, PreviewFrame } from "@/components/product/shared";
import { motionDuration, motionEase } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

export interface GraphPreviewProps {
  className?: string;
}

/* ── Sample topology (illustrative — labeled by DemoBadge) ──────────── */

const VIEW_BOX = "0 0 640 360";
const NODE_W = 110;
const NODE_H = 34;

type DotTone = "primary" | "success" | "info" | "muted";

/** Status-semantic dot colors (no blue/indigo chrome — warm info tone). */
const DOT_COLORS: Record<DotTone, string> = {
  primary: "#d98e4a", // copper — AI / API
  success: "#4ec98a", // Tests
  info: "#79aec4", // Search (token-derived warm info)
  muted: "#6f675c",
};

interface GraphNode {
  id: string;
  label: string;
  x: number;
  y: number;
  tone: DotTone;
}

const NODES: GraphNode[] = [
  { id: "frontend", label: "Frontend", x: 80, y: 80, tone: "muted" },
  { id: "ai", label: "AI", x: 320, y: 60, tone: "primary" },
  { id: "api", label: "API", x: 320, y: 180, tone: "primary" },
  { id: "auth", label: "Auth", x: 540, y: 80, tone: "muted" },
  { id: "tests", label: "Tests", x: 540, y: 180, tone: "success" },
  { id: "database", label: "Database", x: 540, y: 280, tone: "muted" },
  { id: "queue", label: "Queue", x: 320, y: 320, tone: "muted" },
  { id: "search", label: "Search", x: 80, y: 280, tone: "info" },
];

interface GraphEdge {
  id: string;
  d: string;
  /** AI-related edges render in copper. */
  copper?: boolean;
}

/** Center-to-center beziers; nodes paint over the endpoints. */
const EDGES: GraphEdge[] = [
  { id: "frontend-api", d: "M 80 80 C 150 80 250 180 320 180" },
  { id: "api-auth", d: "M 320 180 C 390 180 470 80 540 80" },
  { id: "api-database", d: "M 320 180 C 400 180 460 280 540 280" },
  { id: "api-queue", d: "M 320 180 C 334 227 306 273 320 320" },
  { id: "api-search", d: "M 320 180 C 250 180 150 280 80 280" },
  { id: "api-ai", d: "M 320 180 C 306 140 334 100 320 60", copper: true },
  { id: "api-tests", d: "M 320 180 C 400 170 460 190 540 180" },
  { id: "ai-database", d: "M 320 60 C 440 84 468 214 540 280", copper: true },
  { id: "auth-database", d: "M 540 80 C 562 146 562 214 540 280" },
];

const AI_NODE = NODES.find((node) => node.id === "ai") as GraphNode;

/* ── Sequence timing (runs once, settles) ───────────────────────────── */

const NODE_STAGGER_S = 0.05;
const EDGE_BASE_DELAY_S = 0.5;
const EDGE_STAGGER_S = 0.08;
const EDGE_DURATION_S = 0.5;
const PULSE_DELAY_S = 1.75;

const nodeVariants: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: (i: number) => ({
    opacity: 1,
    scale: 1,
    transition: {
      delay: i * NODE_STAGGER_S,
      duration: motionDuration.base,
      ease: motionEase.outSoft,
    },
  }),
};

const edgeVariants: Variants = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: (i: number) => ({
    pathLength: 1,
    opacity: 1,
    transition: {
      delay: EDGE_BASE_DELAY_S + i * EDGE_STAGGER_S,
      duration: EDGE_DURATION_S,
      ease: motionEase.inOut,
    },
  }),
};

/** One subtle opacity ring around the AI node, then static (opacity 0). */
const pulseVariants: Variants = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: {
    opacity: [0, 0.45, 0],
    scale: [0.8, 1.25, 1.7],
    transition: { delay: PULSE_DELAY_S, duration: 1.2, ease: "easeOut", times: [0, 0.5, 1] },
  },
};

/* ── Component ──────────────────────────────────────────────────────── */

export function GraphPreview({ className }: GraphPreviewProps) {
  const prefersReduced = useReducedMotion();
  const reduced = Boolean(prefersReduced);

  return (
    <PreviewFrame
      title="architecture — service graph"
      badge={<DemoBadge label="Sample" />}
      className={cn("w-full", className)}
      bodyClassName="p-2 md:p-3"
    >
      <motion.svg
        initial={reduced ? false : "hidden"}
        whileInView="visible"
        viewport={{ once: true, amount: 0.25 }}
        viewBox={VIEW_BOX}
        className="block h-auto w-full font-mono"
        role="img"
        aria-label="Conceptual architecture graph: frontend, API, auth, database, queue, search, AI and tests"
      >
        {/* Edges draw in after the nodes settle */}
        <g>
          {EDGES.map((edge, i) => (
            <motion.path
              key={edge.id}
              d={edge.d}
              fill="none"
              stroke={edge.copper ? "rgba(217, 142, 74, 0.35)" : "rgba(214, 209, 200, 0.14)"}
              strokeWidth={1.25}
              variants={edgeVariants}
              custom={i}
            />
          ))}
        </g>

        {/* Nodes — scale/fade from their own centers (framer measures the bbox) */}
        <g>
          {NODES.map((node, i) => {
            const left = node.x - NODE_W / 2;
            const top = node.y - NODE_H / 2;
            return (
              <motion.g key={node.id} variants={nodeVariants} custom={i}>
                <rect
                  x={left}
                  y={top}
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  fill="#1a1815"
                  stroke="rgba(214, 209, 200, 0.16)"
                  strokeWidth={1}
                />
                <circle
                  cx={left + 13}
                  cy={node.y}
                  r={2.5}
                  fill={DOT_COLORS[node.tone]}
                />
                <text
                  x={left + 22}
                  y={node.y}
                  textAnchor="start"
                  dominantBaseline="central"
                  fontSize={11}
                  fill="#d6d1c8"
                >
                  {node.label}
                </text>
              </motion.g>
            );
          })}
        </g>

        {/* Single AI pulse — invisible (opacity 0) once it settles */}
        {!reduced ? (
          <motion.circle
            cx={AI_NODE.x}
            cy={AI_NODE.y}
            r={22}
            fill="none"
            stroke="rgba(217, 142, 74, 0.6)"
            strokeWidth={1}
            variants={pulseVariants}
          />
        ) : null}
      </motion.svg>
    </PreviewFrame>
  );
}
