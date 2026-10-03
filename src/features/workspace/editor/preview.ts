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

const REACT_BOOTSTRAP = `
<script type="module">
  import React from "https://esm.sh/react@18.3.1";
  import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
  window.React = React;
  window.ReactDOM = { createRoot };
  window.__mount = function (elId) {
    var el = document.getElementById(elId);
    var rootEl = document.createElement("div");
    rootEl.id = "root";
    el.parentNode.insertBefore(rootEl, el.nextSibling);
    return createRoot(rootEl);
  };
  window.dispatchEvent(new Event("react-ready"));
</script>`;

export interface PreviewDocument {
  kind: PreviewKind;
  html: string;
  /** Honest note when the preview is transformed/partial. */
  note?: string;
}

/**
 * Build the sandboxed preview document. Never executes anything here — the
 * caller renders the returned HTML inside a sandboxed iframe only.
 */
export function buildPreviewDocument(code: string, language: string | null | undefined): PreviewDocument {
  const kind = previewKindForLanguage(language);

  if (kind === "html") {
    return { kind, html: baseDocument(code) };
  }

  if (kind === "css") {
    return {
      kind,
      html: baseDocument(
        `<h1>Heading</h1><p>Paragraph with <a href="#">a link</a> and <strong>bold</strong> text.</p>
<div class="demo box">.demo.box</div><button>Button</button><input placeholder="Input" />`,
        `<style>${code}</style>`,
      ),
      note: "CSS preview — sample DOM elements styled by the snippet.",
    };
  }

  if (kind === "javascript") {
    const wrapped = `<script>${code}<\/script>`;
    return { kind, html: baseDocument(`<div id="output"></div>${wrapped}`) };
  }

  if (kind === "jsx") {
    const transformed = transformJsx(code);
    const html = baseDocument(
      `<div id="mount-point"></div>
<script type="module">
  import React from "https://esm.sh/react@18.3.1";
  import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
  window.React = React;
  const userCode = ${JSON.stringify(transformed)};
  try {
    const factory = new Function("React", "useState", "useEffect", "useRef", "useMemo", "useCallback", userCode + "\\n;return typeof App !== 'undefined' ? App : (typeof main !== 'undefined' ? main : null);");
    const App = factory(React, React.useState, React.useEffect, React.useRef, React.useMemo, React.useCallback);
    if (App) {
      createRoot(document.getElementById("mount-point")).render(React.createElement(App));
    } else {
      document.getElementById("mount-point").textContent = "No App component or main() found in the snippet.";
    }
  } catch (err) {
    const bar = document.createElement("div");
    bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;font:11px/1.5 ui-monospace,monospace;color:#ffd7d2;background:#5c1d16;padding:6px 10px;white-space:pre-wrap;max-height:40%;overflow:auto;";
    bar.textContent = "Preview error: " + (err && err.message ? err.message : String(err));
    document.body.appendChild(bar);
  }
<\/script>`,
    );
    return {
      kind,
      html,
      note: "JSX is transformed client-side (Sucrase); React 18 loads from the esm.sh CDN inside the sandbox.",
    };
  }

  return { kind: "none", html: "" };
}
