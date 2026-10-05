# Task 5-2-c — Phase 5 Task 2-c: explorer type contracts + workspace store additions

Agent: Z.ai (Phase 5 agent 2-c)
Status: COMPLETED
Scope touched: ONLY src/features/workspace/types.ts + src/stores/workspace-store.ts (+ worklog.md append). No git commit, no dev-server restart.

## What parallel agents can rely on (exact contracts)

### Types (src/features/workspace/types.ts)
```ts
export type TreeGitStatus = "modified" | "added" | "deleted" | "untracked" | "renamed";

export type ContentClassification =
  | "repository_data" | "repository_documentation" | "repository_comment"
  | "repository_fixture" | "repository_generated_output";

export interface FileProvenanceMeta {
  path: string; language: string; size: number; truncated: boolean; binary: boolean;
  mimeType: string | null; gitStatus: TreeGitStatus | null; branch: string | null;
  commitSha: string | null; lastModifiedAt: string | null; classification: ContentClassification | null;
}

export interface FileHistoryCommit { sha: string; author: string; date: string /* ISO */; message: string; }

// RepoTreeNode (additive optional — NO gitStatus in the tree, it comes via a status map):
language?: string; truncated?: boolean;

// OpenTab (additive optional):
gitStatus?: TreeGitStatus | null;

export const WORKSPACE_LAYOUT_VERSION = 5; // v5 adds persisted intelligenceOpen (file-intelligence panel)
```

### Store (src/stores/workspace-store.ts) — useWorkspaceStore
Persisted (schema v5):
- `intelligenceOpen: boolean` (default true) + `setIntelligenceOpen(open: boolean): void`

Session-only (NEVER persisted; rebuilt each session):
- `recentTabs: string[]` — MRU open paths, max 12 (MAX_RECENT_TABS). openTab unshift+dedupe; setActiveTab moves to front; closeTab/closeOtherTabs/closeAllTabs prune.
- `closedTabs: Array<{ path: string }>` — reopen stack, max 10 (MAX_CLOSED_TABS), most recent first.
- `queuedChatFile: string | null` + `queueChatFile(path: string): void` (also sets section "assistant") + `consumeQueuedChatFile(): string | null` (returns and clears).
- `treeReveal: { path: string; nonce: number } | null` + `revealInTree(path: string): void` (nonce = prev+1; subscribe on nonce change).

Tab actions:
- `openTab(path: string): void` — loading status, activation, MRU, removes path from closedTabs; at 12 tabs evicts the OLDEST NON-ACTIVE tab onto closedTabs (reopenable, never silently dropped).
- `closeTab(path: string): void` — pushes onto closedTabs only when a tab was really closed; prunes MRU; previous neighbor-activation preserved.
- `setActiveTab(path: string): void` — unchanged signature; MRU front for real tabs.
- `closeOtherTabs(path: string): void` — keeps path active (null if path not open); closed tabs pushed in CURRENT tab order.
- `closeAllTabs(): void` — all → stack in tab order; activeTabPath = null.
- `reopenClosedTab(): string | null` — pops stack head, reuses openTab logic; returns path or null.
- `setTabStatus(path, status, patch?)` — unchanged.
- `applyGitStatus(map: Record<string, TreeGitStatus>): void` — paths in map get that status; ALL other tabs get null; identity-preserving for unchanged tabs.
- `setTabGitStatus(path: string, status: TreeGitStatus | null): void`.

### Persistence policy (unchanged where it matters)
- Task 6 `migrate: (persisted) => (persisted ?? {}) as WorkspaceState` bridge preserved verbatim.
- merge(): conversations sanitized, tabs restored as `{ path, status: "loading" }` (contents never persisted), section preserved; sizes/collapsed/expandedWidths reset to canonical defaults unless `layoutVersion === WORKSPACE_LAYOUT_VERSION` (so v4→v5 resets layout, preserves conversations/tabs/section — spec §31).
- partialize adds ONLY `intelligenceOpen`; gitStatus/recentTabs/closedTabs/queuedChatFile/treeReveal are never written to localStorage.

## Verification
- `bunx tsc --noEmit`: 0 errors in both files; only 2 pre-existing errors in examples/websocket (missing socket.io deps — out of scope).
- `bun run lint`: exit 0 (clean).
- Dev server: GET / → 200; dev.log tail shows 5 clean Fast Refresh compiles after the edits, no new errors.
