"use client";

import dynamic from "next/dynamic";

import { LatticeLoader } from "@/components/ai";

/**
 * Client-only mount for the four-panel workspace.
 * The AIWorkspace root owns its own hydration gate; the ssr:false dynamic
 * import additionally guarantees no server/client markup mismatch for the
 * persisted (localStorage-backed) layout model.
 */
const AIWorkspace = dynamic(
  () => import("@/features/workspace").then((m) => m.AIWorkspace),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background"
        aria-busy="true"
        aria-label="Loading CodeMind X workspace"
      >
        <LatticeLoader size={36} />
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          CodeMind X
        </p>
      </div>
    ),
  },
);

export function WorkspaceScreen() {
  return <AIWorkspace />;
}
