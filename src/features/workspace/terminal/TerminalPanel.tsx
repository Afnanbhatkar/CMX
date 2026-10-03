"use client";

/**
 * CodeMind X V2 — terminal panel (V2.1 ADDITIONS §F).
 *
 * xterm.js mounted in the editor dock, speaking ONLY through the
 * TerminalAdapter contract. The reserved SandboxTerminalAdapter states the
 * honest truth today (no exec backend yet — nothing simulated).
 *
 * The stack-trace resolver under the terminal works TODAY against real
 * workspace files: parsed locations open through the EditorNavigationService
 * (sourceContext "terminal"), preserving the one-navigation-pipeline rule.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, ListChecks, TerminalSquare } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { editorNavigation } from "../editor-navigation";
import { parseStackTraceLocations, type StackTraceLocation } from "./stack-trace";
import { SandboxTerminalAdapter, type TerminalAdapter } from "./terminal-adapter";

import "@xterm/xterm/css/xterm.css";

const TERMINAL_THEME = {
  background: "#161413",
  foreground: "#e8e4dd",
  cursor: "#d6a96a",
  cursorAccent: "#161413",
  selectionBackground: "#3a332a",
  black: "#161413",
  red: "#c96f5f",
  green: "#9db58a",
  yellow: "#d6a96a",
  blue: "#8fb5a3",
  magenta: "#b58f7a",
  cyan: "#9db5a3",
  white: "#e8e4dd",
  brightBlack: "#6b6459",
};

export function TerminalPanel() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const adapterRef = useRef<TerminalAdapter | null>(null);
  const xtermRef = useRef<{ fit?: () => void } | null>(null);
  const [status, setStatus] = useState<"init" | "ready">("init");

  /* Stack-trace resolver state (real navigation, honest extraction). */
  const [traceText, setTraceText] = useState("");
  const [locations, setLocations] = useState<StackTraceLocation[] | null>(null);

  const adapter = useMemo<TerminalAdapter>(() => new SandboxTerminalAdapter(), []);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      await Promise.resolve();
      if (disposed || !hostRef.current) return;

      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed) return;

      const terminal = new Terminal({
        theme: TERMINAL_THEME,
        fontFamily: "var(--font-mono, ui-monospace), SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 11.5,
        lineHeight: 1.4,
        cursorBlink: false,
        convertEol: true,
        scrollback: 2_000,
        disableStdin: false,
        allowProposedApi: true,
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(hostRef.current);
      try {
        fit.fit();
      } catch {
        // zero-size host during layout — the ResizeObserver below re-fits
      }

      adapterRef.current = adapter;
      adapter.start({
        write: (data) => terminal.write(data),
        onStatus: (adapterStatus) => {
          void adapterStatus;
        },
      });
      terminal.onData((data) => adapter.send(data));
      terminal.onResize(({ cols, rows }) => adapter.resize(cols, rows));

      const observer = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {
          // ignore transient layout errors
        }
      });
      observer.observe(hostRef.current);

      xtermRef.current = { fit: () => fit.fit() };
      setStatus("ready");

      cleanup = () => {
        observer.disconnect();
        adapter.dispose();
        terminal.dispose();
        adapterRef.current = null;
        xtermRef.current = null;
      };
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [adapter]);

  const resolveTrace = () => {
    const found = parseStackTraceLocations(traceText);
    setLocations(found);
  };

  const openLocation = (location: StackTraceLocation) => {
    void editorNavigation.openRange(location.path, location.line, location.line, "terminal");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="terminal-panel">
      {/* Terminal header — honest adapter status */}
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-1.5 text-[10.5px] text-muted-foreground">
        <TerminalSquare aria-hidden="true" className="size-3.5" />
        <span className="font-medium text-foreground/80">{adapter.label}</span>
        <Badge
          variant="outline"
          className="border-amber-500/40 bg-amber-500/10 px-1.5 py-0 text-[10px] font-normal text-amber-600 dark:text-amber-400"
        >
          adapter reserved
        </Badge>
        <span className="truncate" title={adapter.note}>
          {adapter.note}
        </span>
      </div>

      {/* xterm host */}
      <div className="min-h-[120px] flex-1 overflow-hidden px-1 pt-1">
        <div
          ref={hostRef}
          data-testid="terminal-xterm-host"
          aria-label="Terminal"
          className="h-full w-full overflow-hidden rounded-md border border-border-subtle"
        />
      </div>

      {/* Stack-trace resolver (works today via EditorNavigationService) */}
      <div className="shrink-0 border-t border-border-subtle p-2">
        <div className="flex items-center gap-2">
          <ListChecks aria-hidden="true" className="size-3.5 text-muted-foreground" />
          <span className="text-[11px] font-medium text-foreground/80">
            Stack trace resolver
          </span>
          <span className="truncate text-[10px] text-muted-foreground">
            paste a trace — file:line refs resolve to real files
          </span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-6 px-2 text-[10.5px]"
            onClick={resolveTrace}
            disabled={traceText.trim().length === 0}
          >
            Resolve
          </Button>
        </div>
        <Textarea
          value={traceText}
          onChange={(event) => setTraceText(event.target.value)}
          placeholder={"Error: something failed\n    at handler (src/features/workspace/editor-navigation.ts:227:26)\n    at fn (src/lib/server/repository-fs.ts:314:9)"}
          aria-label="Stack trace text"
          className="mt-1.5 h-16 resize-none border-border-subtle bg-surface-elevated/40 font-mono text-[10.5px]"
        />
        {locations !== null ? (
          locations.length === 0 ? (
            <p className="mt-1.5 text-[10.5px] text-muted-foreground">
              No workspace file references found in this text.
            </p>
          ) : (
            <ul className="mt-1.5 max-h-28 space-y-0.5 overflow-y-auto pr-1">
              {locations.map((location, index) => (
                <li key={`${location.path}:${location.line}:${index}`}>
                  <button
                    type="button"
                    onClick={() => openLocation(location)}
                    className={cn(
                      "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left font-mono text-[10.5px]",
                      "hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    )}
                  >
                    <ExternalLink aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-foreground/90">
                      {location.path}
                      <span className="text-muted-foreground">
                        :{location.line}
                        {location.column ? `:${location.column}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </div>
  );
}
