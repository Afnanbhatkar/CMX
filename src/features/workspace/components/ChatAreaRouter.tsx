"use client";

/**
 * CodeMind X V2 — routes the chat area by the active workspace section.
 *
 * - "overview"              → real capability overview
 * - assistant / repository  → the live conversation (AIChatPanel)
 * - "search"                → real filename filter over the workspace tree
 * - "settings"              → real workspace settings
 * - everything else         → honest planned-destination placeholder
 *
 * The same router serves the desktop chat panel and the compact main area,
 * so destinations behave identically on every screen size.
 */

import type { ReactNode } from "react";

import { useWorkspaceStore } from "@/stores/workspace-store";
import { AIChatPanel } from "@/features/workspace/chat";
import { CONVERSATION_SECTIONS } from "../registry";
import { DestinationPlaceholderPanel } from "./DestinationPlaceholderPanel";
import { OverviewPanel } from "./OverviewPanel";
import { SearchFilesPanel } from "./SearchFilesPanel";
import { SettingsPanel } from "./SettingsPanel";

export function ChatAreaRouter() {
  const section = useWorkspaceStore((s) => s.section);

  let content: ReactNode;
  if (section === "overview") {
    content = <OverviewPanel />;
  } else if (CONVERSATION_SECTIONS.has(section)) {
    content = <AIChatPanel />;
  } else if (section === "search") {
    content = <SearchFilesPanel />;
  } else if (section === "settings") {
    content = <SettingsPanel />;
  } else {
    content = <DestinationPlaceholderPanel sectionId={section} />;
  }

  return <div className="flex h-full min-h-0 flex-col">{content}</div>;
}
