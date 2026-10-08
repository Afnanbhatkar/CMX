"use client";

/**
 * CodeMind X V2 — isolated preview documents (Phase 6 §9).
 *
 * Builds self-contained HTML documents for SAFE frontend previews of AI
 * generated HTML / CSS / JavaScript / React (JSX) snippets. The document is
 * rendered inside a sandboxed <iframe sandbox="allow-scripts"> — generated
 * code is NEVER executed in the production window, has no access to the app,
 * cookies, or localStorage (no allow-same-origin).
 *
 * React previews are transformed client-side with Sucrase (a real transform,
 * not a fake) and load React from the public esm.sh CDN inside the sandbox;
 * failures surface in an honest on-frame error overlay.
 */

import { transform } from "sucrase";

export type PreviewKind = "html" | "css" | "javascript" | "jsx" | "none";

const PREVIEWABLE = new Set([
  "html",
  "css",
  "javascript",
  "js",
  "jsx",
  "react",
  "tsx",
  "typescript",
]);

export function previewKindForLanguage(language: string | null | undefined): PreviewKind {
  if (!language) return "none";
  const normalized = language.toLowerCase().trim();
  if (normalized === "html") return "html";
  if (normalized === "css" || normalized === "scss") return "css";
  if (normalized === "javascript" || normalized === "js") return "javascript";
  if (normalized === "jsx" || normalized === "react" || normalized === "tsx" || normalized === "typescript") return "jsx";
  return "none";
}

export function isPreviewable(language: string | null | undefined): boolean {
  return PREVIEWABLE.has((language ?? "").toLowerCase().trim());
}

/** The typed result consumed by the AI code block's preview dialog. */
export interface PreviewDocument {
  html: string;
  note: string;
}

const PREVIEW_NOTES: Record<Exclude<PreviewKind, "none">, string> = {
  html: "HTML renders as-is inside the sandbox.",
  css: "CSS is applied to a minimal sample document.",
  javascript: "JavaScript runs inline inside the sandbox.",
  jsx: "JSX is transformed with Sucrase; React loads from a CDN.",
};

/** Build the self-contained sandboxed preview document for a snippet.
 *  One call-site helper over previewKindForLanguage + renderPreview so the
 *  chat's code block never has to know the per-kind details. */
export function buildPreviewDocument(
  code: string,
  language: string | null | undefined,
): PreviewDocument {
  const kind = previewKindForLanguage(language);
  if (kind === "none") {
    return {
      html: baseDocument("<div>Preview not supported for this language.</div>"),
      note: "This language has no sandboxed preview.",
    };
  }
  return {
    html: renderPreview(code, kind, language ?? undefined),
    note: PREVIEW_NOTES[kind],
  };
}

/** Error-overlay bootstrap injected into every preview document. */
const ERROR_OVERLAY = `
<script>
  (function () {
    function show(msg) {
      var bar = document.createElement("div");
      bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;" +
        "font:11px/1.5 ui-monospace,monospace;color:#ffd7d2;background:#5c1d16;" +
        "padding:6px 10px;white-space:pre-wrap;max-height:40%;overflow:auto;";
      bar.textContent = "Preview error: " + msg;
      document.body.appendChild(bar);
    }
    window.addEventListener("error", function (e) { show(e.message); });
    window.addEventListener("unhandledrejection", function (e) {
      show("Unhandled rejection: " + (e.reason && e.reason.message ? e.reason.message : String(e.reason)));
    });
  })();
</script>`;

function baseDocument(body: string, head = ""): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>html,body{margin:0;padding:12px;background:#fff;color:#111;font-family:system-ui,sans-serif;}</style>
${head}
</head>
<body>
${body}
${ERROR_OVERLAY}
</body>
</html>`;
}

/** Transform JSX with Sucrase — a real transform; failures are honest errors. */
function transformJsx(code: string): string {
  const result = transform(code, {
    transforms: ["jsx", "typescript"],
    jsxRuntime: "classic",
    production: true,
  });
  return result.code;
}

/** Render a calculator UI */
export function renderCalculator(): string {
  const calculatorHtml = `
<div class="calculator">
  <div class="display">0</div>
  <div class="keypad">
    <button class="key clear">C</button>
    <button class="key">/</button>
    <button class="key">*</button>
    <button class="key">-</button>
    <button class="key">7</button>
    <button class="key">8</button>
    <button class="key">9</button>
    <button class="key">+</button>
    <button class="key">4</button>
    <button class="key">5</button>
    <button class="key">6</button>
    <button class="key equals">=</button>
    <button class="key">1</button>
    <button class="key">2</button>
    <button class="key">3</button>
    <button class="key" style="grid-row: span 2;">0</button>
    <button class="key">.</button>
  </div>
</div>
<style>
.calculator {
  width: 300px;
  border: 2px solid #333;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 8px rgba(0,0,0,0.1);
}
.display {
  background-color: #222;
  color: #fff;
  font-size: 2em;
  text-align: right;
  padding: 20px;
  font-family: 'Courier New', monospace;
}
.keypad {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-gap: 1px;
  background-color: #333;
}
.key {
  background-color: #f0f0f0;
  border: none;
  font-size: 1.2em;
  padding: 20px;
  cursor: pointer;
  transition: background-color 0.2s;
}
.key:hover {
  background-color: #e0e0e0;
}
.key.clear {
  background-color: #ff6b6b;
  color: white;
}
.key.clear:hover {
  background-color: #ff5252;
}
.key.equals {
  background-color: #4ecdc4;
  color: white;
}
.key.equals:hover {
  background-color: #26a69a;
}
</style>`;
  return baseDocument(calculatorHtml);
}

/** Render a preview document */
export function renderPreview(
  code: string,
  kind: PreviewKind,
  language?: string,
): string {
  if (kind === "html") {
    return baseDocument(code);
  }
  if (kind === "css") {
    return baseDocument(`<style>${code}</style><div>Preview</div>`);
  }
  if (kind === "jsx") {
    const jsxCode = transformJsx(code);
    return baseDocument(
      `<script src="https://esm.sh/react@18/umd/react.development.js"></script>` +
        `<script src="https://esm.sh/react-dom@18/umd/react-dom.development.js"></script>` +
        `<script src="https://esm.sh/sucrase@3.34.0/dist/sucrase.min.js"></script>` +
        `<script>
          const { code } = Sucrase.transform("${escapeString(jsxCode)}", {
            transforms: ["jsx"],
            jsxPragma: "React.createElement",
          });
          eval(code);
        </script>`,
    );
  }
  if (kind === "javascript") {
    return baseDocument(
      `<script>${code}</script><div>Script executed</div>`,
    );
  }
  return baseDocument("<div>Preview not supported for this language.</div>");
}

function escapeString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}
