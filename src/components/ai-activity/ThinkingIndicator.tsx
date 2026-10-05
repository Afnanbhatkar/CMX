"use client";

/**
 * CodeMind X V2 — Thinking indicator (Phase 8D, spec B.1/B.2).
 *
 * [3×3 lattice] Thinking — the EXACT supplied lattice reference:
 * 6px cells, 2px gap, .15 idle / 1 peak opacity, 648ms cycle, the
 * reference's per-cell staggered delays and cubic-bezier(.77,0,.175,1)
 * curve (styles live once in activity.css, cmx-act- prefixed).
 *
 * The active label uses the supplied shimmer; under prefers-reduced-motion
 * the text stays VISIBLE as solid var(--cmx-ink-2) (never transparent).
 * No trailing dots — the label is exactly "Thinking".
 */

export function ThinkingIndicator({ label = "Thinking" }: { label?: string }) {
  return (
    <span className="cmx-act-loader" role="status" aria-label={`${label}, in progress`}>
      <span aria-hidden="true" className="cmx-act-grid">
        <span className="cmx-act-cell" />
        <span className="cmx-act-cell" />
        <span className="cmx-act-cell" />
        <span className="cmx-act-cell" />
        <span className="cmx-act-cell" />
        <span className="cmx-act-cell" />
        <span className="cmx-act-cell" />
        <span className="cmx-act-cell" />
        <span className="cmx-act-cell" />
      </span>
      <span className="cmx-act-label">
        <span className="cmx-act-shimmer-text">{label}</span>
      </span>
    </span>
  );
}
