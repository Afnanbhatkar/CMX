"use client";

/**
 * CodeMind X V2 — routes the MAIN area by the active workspace section.
 *
 * - "overview"              → real capability overview
 * - "assistant"             → the live conversation (AIChatPanel); on desktop
 *                             the AI chat sidebar + VSCode-style repository
 *                             panel render alongside it (Assistant-scoped
 *                             chrome owned by AIWorkspace)
 * - "repository"            → focused repository page (real meta, real file
 *                             browser, read-only preview — NOT the IDE)
 * - "search"                → real filename filter over the workspace tree
 * - "settings"              → real workspace settings
 * - everything else         → honest planned-destination placeholder
 *
 * The same router serves the desktop main panel and the compact main area,
 * so destinations behave identically on every screen size.
 */

import type { ReactNode } from "react";

import { useWorkspaceStore } from "@/stores/workspace-store";
import { AIChatPanel } from "@/features/workspace/chat";
import { CONVERSATION_SECTIONS } from "../registry";
import { DestinationPlaceholderPanel } from "./DestinationPlaceholderPanel";
import { OverviewPanel } from "./OverviewPanel";
import { RepositoryOverviewPanel } from "./RepositoryOverviewPanel";
import { SearchFilesPanel } from "./SearchFilesPanel";
import { SettingsPanel } from "./SettingsPanel";

export function ChatAreaRouter() {
  const section = useWorkspaceStore((s) => s.section);

  let content: ReactNode;
  if (section === "overview") {
    content = <OverviewPanel />;
  } else if (CONVERSATION_SECTIONS.has(section)) {
    content = <AIChatPanel />;
  } else if (section === "repository") {
    content = <RepositoryOverviewPanel />;
  } else if (section === "search") {
    content = <SearchFilesPanel />;
  } else if (section === "settings") {
    content = <SettingsPanel />;
  } else {
    content = <DestinationPlaceholderPanel sectionId={section} />;
  }

  return <div className="flex h-full min-h-0 flex-col">{content}</div>;
}
