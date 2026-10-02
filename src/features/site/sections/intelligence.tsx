"use client";

/**
 * Intelligence arc — Repository Intelligence, Hybrid Search, Code
 * Understanding and the AI Assistant (spec §13-16, §55). Each section wraps
 * a real product visual component with honest, product-first copy.
 */
import { Search as SearchIcon } from "lucide-react";
import { SectionShell } from "../section-shell";
import { RepositoryPreview } from "@/components/product/RepositoryPreview";
import { SearchPreview } from "@/components/product/SearchPreview";
import { CodePreview } from "@/components/product/CodePreview";
import { ActivityPreview } from "@/components/ai/ActivityPreview";

/* ── Repository Intelligence ───────────────────────────────────────── */

export function RepositorySection() {
  return (
    <SectionShell
      id="repository"
      eyebrow="Repository Intelligence"
      title="Your repository, understood as a connected structure"
      description="CodeMind X is designed to index directories, files, symbols and dependencies — so relationships are one query away, not archaeology."
      note="Illustrative structure below — it demonstrates the concept, not a live indexed repository."
    >
      <RepositoryPreview className="mx-auto max-w-4xl" />
    </SectionShell>
  );
}

/* ── Hybrid Search ─────────────────────────────────────────────────── */

export function SearchSection() {
  return (
    <SectionShell
      id="search"
      eyebrow="Hybrid Search"
      title="Ask in plain language. Get grounded results."
      description="Keyword precision, semantic recall and symbol navigation are designed to fuse into one ranked view — every result cited back to a file."
      note="Concept demonstration of the future hybrid retrieval system; no repository is indexed in Phase 1."
    >
      <div className="mx-auto max-w-3xl">
        <SearchPreview />
        <p className="mt-4 flex items-center justify-center gap-2 text-[11.5px] text-muted-foreground/80">
          <SearchIcon className="size-3.5" aria-hidden="true" />
          One query, three retrievers, cited answers.
        </p>
      </div>
    </SectionShell>
  );
}

/* ── Code Understanding ────────────────────────────────────────────── */

const UNDERSTAND_CODE = `import { verifyRequest } from "../services/auth";

// Runs before every protected route handler.
export async function authMiddleware(req: Request, next: Handler) {
  const ok = verifyRequest(req);
  if (!ok) return new Response("Unauthorized", { status: 401 });

  return next(req);
}`;

export function CodeUnderstandingSection() {
  return (
    <SectionShell
      id="code"
      eyebrow="Code Understanding"
      title="Select a symbol. See everything connected to it."
      description="A function is never just its body. CodeMind X is built to identify callers, dependencies, related tests and API surface — and connect them visually."
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <CodePreview
          file="src/server/security/middleware.ts"
          code={UNDERSTAND_CODE}
          highlightLines={[2, 5]}
          className="min-w-0"
        />
        <aside
          aria-label="What CodeMind X identifies for the selected symbol"
          className="rounded-md border border-border bg-surface p-4"
        >
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            identified for verifyRequest()
          </p>
          <ul className="mt-3 space-y-2.5" role="list">
            {[
              ["Callers", "authMiddleware() — middleware.ts"],
              ["Dependencies", "node:crypto · config/secrets.ts"],
              ["Related tests", "tests/auth.test.ts (4 cases)"],
              ["API surface", "used by 2 route groups"],
              ["History", "last touched: fix: cross-tenant token"],
            ].map(([k, v]) => (
              <li key={k} className="flex flex-col gap-0.5 border-l border-border-subtle pl-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary/80">
                  {k}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">{v}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </SectionShell>
  );
}

/* ── AI Assistant ──────────────────────────────────────────────────── */

export function AssistantSection() {
  return (
    <SectionShell
      id="assistant"
      eyebrow="AI Assistant"
      title="Answers with an activity trail you can inspect"
      description="While the assistant works, you see safe execution categories — searching, reading, planning, coding, testing — never a black box. Private reasoning stays private."
      note="Demonstration of the activity engine with simulated steps."
    >
      <div className="grid grid-cols-1 items-center gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-md border border-border bg-surface p-4">
          <p className="max-w-[92%] rounded-sm rounded-br-none border border-border-subtle bg-surface-elevated px-3 py-2 text-[13px] leading-snug text-foreground sm:ml-auto">
            Find where authentication is handled and explain the request flow.
          </p>
          <p className="mt-3 text-[11px] text-muted-foreground">
            The answer arrives with the files it used, the request path it traced and the
            tests that cover it — every claim grounded in your repository.
          </p>
        </div>
        <ActivityPreview />
      </div>
    </SectionShell>
  );
}
