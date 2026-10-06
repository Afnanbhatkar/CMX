"use client";

/**
 * CodeMind X V2 — Monaco inline completion provider (Phase 8.75 §1/§2/§6).
 *
 * Ghost-text code completion through the LLM Gateway (POST
 * /api/ai/inline-complete) using Monaco's native inline-suggestions UI:
 * - Tab accept + word-by-word partial accept are native Monaco commands
 *   (re-bound here so usage is counted honestly);
 * - EVERY request is cancellable: provider token, AbortController and a
 *   strict stale-guard (model version must be unchanged when the response
 *   arrives) — an obsolete completion can never be inserted after the user
 *   changed the buffer (§2);
 * - typing again aborts the superseded in-flight request for the model;
 * - LRU cache keyed by (model, version) makes re-invocations free;
 * - failed gateways open a short negative window instead of hammering;
 * - latency is MEASURED (request → ghost text visible) and reported through
 *   window.__cmxInlineAI.stats() — the 300ms target is NOT claimed unless
 *   measurement supports it (§6).
 */

import type { Monaco } from "@monaco-editor/react";
import type * as MonacoNS from "monaco-editor";

import { editorModelManager } from "../model-manager";
import {
  collectCompletionContext,
  countCompletion,
  ensureInlineAIHarness,
  recordCompletionError,
  recordCompletionShown,
} from "./inline-ai-context";

const DEBOUNCE_MS = 220;
const CACHE_MAX = 40;
const NEGATIVE_TTL_MS = 1_500;
const MIN_PREFIX_CHARS = 3;

interface ItemMeta {
  startedAt: number;
  gatewayMs: number;
}

/** Provider-scoped state (the provider registers once per Monaco instance). */
interface ProviderState {
  cache: Map<string, MonacoNS.languages.InlineCompletion[]>;
  inFlight: Map<string, AbortController>;
  negativeAt: number;
}

const state: ProviderState = {
  cache: new Map(),
  inFlight: new Map(),
  negativeAt: 0,
};

const itemMeta = new WeakMap<object, ItemMeta>();

let registeredOnce = false;

function cacheKey(model: MonacoNS.editor.ITextModel): string {
  return `${model.id}:${model.getVersionId()}`;
}

function cacheSet(key: string, items: MonacoNS.languages.InlineCompletion[]): void {
  state.cache.delete(key); // refresh LRU order
  state.cache.set(key, items);
  while (state.cache.size > CACHE_MAX) {
    const oldest = state.cache.keys().next().value;
    if (oldest === undefined) break;
    state.cache.delete(oldest);
  }
}

/** Register once per Monaco instance. Idempotent. */
export function registerInlineAICompletion(monaco: Monaco): void {
  ensureInlineAIHarness();
  if (registeredOnce) return;
  registeredOnce = true;

  const provider: MonacoNS.languages.InlineCompletionsProvider<MonacoNS.languages.InlineCompletions> =
    {
      async provideInlineCompletions(model, position, context, token) {
        const path = model.uri.path.replace(/^\//, "");

        // Honest perf guard (RULES §11): no ghost-text requests for large files.
        if (editorModelManager.isLargeFile(model)) return { items: [] };

        const versionId = model.getVersionId();
        const key = cacheKey(model);

        const cached = state.cache.get(key);
        if (cached) {
          cacheSet(key, cached); // LRU refresh
          countCompletion("cacheHits");
          return { items: cached };
        }

        const now = Date.now();
        if (now - state.negativeAt < NEGATIVE_TTL_MS) return { items: [] };

        // Typing again invalidates the previous request for this model (§2).
        state.inFlight.get(model.id)?.abort();
        const controller = new AbortController();
        state.inFlight.set(model.id, controller);
        countCompletion("requests");
        const startedAt = performance.now();

        const release = () => {
          if (state.inFlight.get(model.id) === controller) state.inFlight.delete(model.id);
        };
        token.onCancellationRequested(() => {
          controller.abort();
          countCompletion("cancellations");
          release();
        });

        // Debounce automatic (typing) triggers; explicit triggers run now.
        if (context.triggerKind === monaco.languages.InlineCompletionTriggerKind.Automatic) {
          const cancelled = await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(false), DEBOUNCE_MS);
            token.onCancellationRequested(() => {
              clearTimeout(timer);
              resolve(true);
            });
          });
          if (cancelled) {
            release();
            return { items: [] };
          }
        }

        // The buffer changed while waiting → this request is obsolete.
        if (model.isDisposed() || model.getVersionId() !== versionId) {
          countCompletion("superseded");
          release();
          return { items: [] };
        }

        const payload = collectCompletionContext(model, position, model.getLanguageId());
        if (payload.prefix.trim().length < MIN_PREFIX_CHARS) {
          release();
          return { items: [] };
        }

        try {
          const response = await fetch("/api/ai/inline-complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = (await response.json()) as {
            ok: boolean;
            completion?: string;
            gatewayLatencyMs?: number;
            error?: string;
          };
          if (!data.ok || typeof data.completion !== "string") {
            throw new Error(data.error ?? "The gateway returned no completion.");
          }

          // STALE GUARD — never insert an old completion after the user
          // changed the buffer (any edit bumps the version id).
          if (model.isDisposed() || model.getVersionId() !== versionId) {
            countCompletion("superseded");
            return { items: [] };
          }

          const text = data.completion;
          if (!text.trim()) return { items: [] };

          const item: MonacoNS.languages.InlineCompletion = {
            insertText: text,
            range: new monaco.Range(
              position.lineNumber,
              position.column,
              position.lineNumber,
              position.column,
            ),
          };
          itemMeta.set(item, {
            startedAt,
            gatewayMs: typeof data.gatewayLatencyMs === "number" ? data.gatewayLatencyMs : 0,
          });
          const items = [item];
          cacheSet(key, items);
          return { items };
        } catch (error) {
          if (controller.signal.aborted) return { items: [] }; // cancelled, not an error
          recordCompletionError(
            error instanceof Error ? error.message : String(error),
          );
          state.negativeAt = Date.now();
          return { items: [] };
        } finally {
          release();
        }
      },

      handleItemDidShow(completions, item) {
        const meta = itemMeta.get(item as object);
        if (!meta) return;
        // §6: measured user-perceived latency (request → ghost text visible).
        recordCompletionShown(performance.now() - meta.startedAt);
      },

      handlePartialAccept(completions, item, acceptedCharacters) {
        if (acceptedCharacters > 0) countCompletion("partialAccepts");
      },

      disposeInlineCompletions() {
        // Items live in the LRU cache — nothing per-call to release.
      },
    };

  monaco.languages.registerInlineCompletionsProvider("*", provider);
}

/**
 * Per-editor keybindings that make the native accept behavior deterministic
 * AND counted: Tab = whole accept, Ctrl/Cmd+Right = word-by-word accept
 * (both only while an inline suggestion is visible).
 */
export function attachInlineAIEditor(
  editor: MonacoNS.editor.IStandaloneCodeEditor,
  monaco: Monaco,
): void {
  editor.addCommand(
    monaco.KeyCode.Tab,
    () => {
      countCompletion("accepts");
      editor.trigger("cmx-inline-ai", "editor.action.inlineSuggest.commit", null);
    },
    "inlineSuggestionVisible",
  );
  editor.addCommand(
    monaco.KeyMod.CtrlCmd | monaco.KeyCode.RightArrow,
    () => {
      editor.trigger("cmx-inline-ai", "editor.action.inlineSuggest.acceptNextWord", null);
    },
    "inlineSuggestionVisible",
  );
}

/** Retry: drop the negative window + this model's cached misses, re-trigger. */
export function retryInlineAICompletion(editor: MonacoNS.editor.IStandaloneCodeEditor): void {
  state.negativeAt = 0;
  const model = editor.getModel();
  if (model) {
    const prefix = `${model.id}:`;
    for (const key of [...state.cache.keys()]) {
      if (key.startsWith(prefix)) state.cache.delete(key);
    }
  }
  void editor.getAction("editor.action.inlineSuggest.trigger")?.run();
}
