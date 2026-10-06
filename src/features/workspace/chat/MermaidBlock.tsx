"use client";

/**
 * CodeMind X V2 — Phase 8.5 §8 diagram rendering.
 *
 * Mermaid fences render through the bundled mermaid@11 renderer with
 * securityLevel "strict" (no click handlers, no external network inside
 * the diagram). ANY failure — module unavailable, parse error, render
 * timeout — falls back to the honest code-block presentation with a note.
 * Reduced-motion users get the static SVG either way (mermaid output is
 * static unless interaction is enabled; strict mode disables it).
 */

import { memo, useEffect, useId, useMemo, useState } from "react";
import { GitFork } from "lucide-react";

import { AICodeBlock } from "./AICodeBlock";

type MermaidModule = typeof import("mermaid");

/** Lazily import + configure mermaid exactly once (client only). */
let mermaidPromise: Promise<MermaidModule | null> | null = null;

async function loadMermaid(): Promise<MermaidModule | null> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid")
      .then((mod) => {
        mod.default.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "dark",
        });
        return mod;
      })
      .catch(() => null);
  }
  return mermaidPromise;
}

export const MermaidBlock = memo(function MermaidBlock({
  code,
}: {
  code: string;
}) {
  const diagramId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const requestId = useMemo(() => `cmx-diagram-${diagramId}`, [diagramId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mermaid = await loadMermaid();
        if (cancelled) return;
        if (!mermaid) {
          setFailed("The mermaid renderer could not be loaded in this environment.");
          return;
        }
        const { svg: rendered } = await mermaid.default.render(requestId, code);
        if (!cancelled) setSvg(rendered);
      } catch (error) {
        if (cancelled) return;
        setFailed(
          error instanceof Error
            ? `Diagram could not be parsed (${error.message.slice(0, 120)}).`
            : "Diagram could not be parsed.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, requestId]);

  if (failed) {
    return (
      <div data-testid="ai-diagram-fallback">
        <p className="mb-1 mt-2 text-[10.5px] text-muted-foreground">
          <GitFork aria-hidden="true" className="mr-1 inline size-3" />
          {failed} Shown as code instead — the source below is the real diagram definition.
        </p>
        <AICodeBlock code={code} language="mermaid" />
      </div>
    );
  }

  if (!svg) {
    return (
      <div
        className="my-2 flex h-24 items-center justify-center gap-2 rounded-lg border border-border-subtle bg-surface text-[11px] text-muted-foreground"
        data-testid="ai-diagram-loading"
      >
        <div className="size-3.5 animate-spin rounded-full border-2 border-primary/30 border-t-primary motion-reduce:animate-none" />
        Rendering diagram…
      </div>
    );
  }

  return (
    <figure
      className="my-2 overflow-x-auto rounded-lg border border-border-subtle bg-surface p-3"
      data-testid="ai-diagram"
    >
      <figcaption className="mb-2 flex items-center gap-1 text-[10px] text-muted-foreground">
        <GitFork aria-hidden="true" className="size-3" />
        Diagram (mermaid, strict sandbox — static SVG, no external network)
      </figcaption>
      {/* mermaid strict mode output: sanitized static SVG (no scripts/links). */}
      <div
        className="[&_.edgeLabel]:!bg-transparent [&_.labelBkg]:!bg-transparent [&_svg]:max-w-full [&_svg]:h-auto"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </figure>
  );
});
