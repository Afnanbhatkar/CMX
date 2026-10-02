import type { Metadata } from "next";

import { WorkspaceScreen } from "./workspace-screen";

export const metadata: Metadata = {
  title: "CodeMind X — Workspace",
  description:
    "The CodeMind X AI software engineering workspace: AI chat navigation, AI conversation, and a real repository/code panel in a four-panel shell.",
  robots: { index: false },
};

/**
 * Phase 2 — /app is the main CodeMind X workspace (spec §0/§1).
 * The shell itself is a client experience (persisted layout, resizable
 * panels, keyboard contracts), so it mounts client-side only.
 */
export default function AppPage() {
  return <WorkspaceScreen />;
}
