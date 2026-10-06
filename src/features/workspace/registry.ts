/**
 * CodeMind X V2 — workspace registries.
 *
 * Single source of truth for the CodeMind X sidebar destinations and the
 * command palette. Availability reflects the REAL capability state of the
 * running application (see CAPABILITIES.md) — planned destinations are
 * rendered honestly as future extension points, never as fake features.
 */

import {
  Activity,
  BookOpen,
  Bot,
  ClipboardCheck,
  FolderGit2,
  GitBranch,
  GitCompareArrows,
  LayoutDashboard,
  Network,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  FlaskConical,
  type LucideIcon,
} from "lucide-react";

import type { DestinationMeta, WorkspaceSectionId } from "./types";

/* ------------------------------------------------------------------ */
/* CodeMind X sidebar destinations                                     */
/* ------------------------------------------------------------------ */

export interface DestinationEntry extends DestinationMeta {
  icon: LucideIcon;
}

export const WORKSPACE_DESTINATIONS: DestinationEntry[] = [
  {
    id: "overview",
    label: "Overview",
    availability: "available",
    icon: LayoutDashboard,
  },
  {
    id: "assistant",
    label: "Assistant",
    availability: "available",
    icon: Sparkles,
  },
  {
    id: "orchestrator",
    label: "Orchestrator",
    availability: "available",
    note: "Phase 9 multi-agent orchestrator: planner, parallel specialist agents, critic verification — high-level trace only.",
    icon: Bot,
  },
  {
    id: "repository",
    label: "Repository",
    availability: "available",
    icon: FolderGit2,
  },
  {
    id: "search",
    label: "Code Search",
    availability: "available",
    note: "Hybrid retrieval over the real workspace — BM25 + local dense vectors + symbols + paths + import graph + git. English, Hindi and Hinglish queries.",
    icon: Search,
  },
  {
    id: "architecture",
    label: "Architecture",
    availability: "planned",
    note: "Architecture intelligence arrives in a later phase.",
    icon: Network,
  },
  {
    id: "security",
    label: "Security",
    availability: "planned",
    note: "Security intelligence arrives in a later phase.",
    icon: ShieldCheck,
  },
  {
    id: "testing",
    label: "Testing",
    availability: "planned",
    note: "Testing intelligence arrives in a later phase.",
    icon: FlaskConical,
  },
  {
    id: "documentation",
    label: "Documentation",
    availability: "planned",
    note: "Documentation workspace arrives in a later phase.",
    icon: BookOpen,
  },
  {
    id: "change-impact",
    label: "Change Impact",
    availability: "planned",
    note: "ChangeSet / diff workspace arrives in a later phase.",
    icon: GitCompareArrows,
  },
  {
    id: "git",
    label: "Git Intelligence",
    availability: "planned",
    note: "Git intelligence arrives in a later phase. The repository panel shows the real current branch.",
    icon: GitBranch,
  },
  {
    id: "health",
    label: "Repository Health",
    availability: "planned",
    note: "Repository health arrives in a later phase.",
    icon: Activity,
  },
  {
    id: "evaluation",
    label: "Evaluation",
    availability: "planned",
    note: "Evaluation arrives in a later phase.",
    icon: ClipboardCheck,
  },
  {
    id: "settings",
    label: "Settings",
    availability: "available",
    icon: Settings,
  },
];

export const DESTINATION_MAP: Record<WorkspaceSectionId, DestinationEntry> =
  Object.fromEntries(
    WORKSPACE_DESTINATIONS.map((d) => [d.id, d]),
  ) as Record<WorkspaceSectionId, DestinationEntry>;

/**
 * Chat-area routing for CodeMind X sidebar destinations:
 * - "assistant"               → the live conversation (AIChatPanel)
 * - "repository"              → focused repository page (real meta + real
 *                               file browser + read-only preview) — NOT the
 *                               VSCode-style panel, which is Assistant-scoped
 * - "overview"                → real workspace capability overview
 * - "search"                  → real filename filter over the workspace tree
 * - "settings"                → real workspace settings (layout reset, shortcuts)
 * - everything else           → honest "arrives in a later phase" placeholder
 */
export const CONVERSATION_SECTIONS: ReadonlySet<WorkspaceSectionId> = new Set([
  "assistant",
] satisfies WorkspaceSectionId[]);
