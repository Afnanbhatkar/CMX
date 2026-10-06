"use client";

/**
 * CodeMind X V2 — Memory console (Phase 9.5 Adaptive Memory Engine).
 *
 * Sections (all real against /api/memory/*):
 *  - Memories: the five layers (project rule / decision / concept /
 *    preference / correction) with scope badges, disable/enable/delete and
 *    an explicit "save a rule" form (user-authored only).
 *  - Inbox: inferred proposals — [Accept]/[Reject]; nothing activates
 *    without this explicit human confirmation (spec §6).
 *  - Drift: memory-vs-code heuristic check with Review / Update / Keep /
 *    Disable actions (spec §7).
 *  - Glossary: user-editable personal language → repository mapping (§8).
 *  - CODEMIND.md: recognition of the user-authored project rules file (§5).
 *  - Habits: habit-based workflow proposals — never silent autonomy (§10).
 *  - Preferences: adaptive depth + incognito defaults (§9 + §13).
 *
 * Honesty rules: counts are real, empty states say so, and everything the
 * user does is audited server-side (memory.change audit rows).
 */

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  BookMarked,
  Brain,
  Check,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";

import {
  MEMORY_LAYER_META,
  MEMORY_SCOPES,
  MEMORY_TYPES,
  type MemoryDepth,
} from "@/server/memory/types";

/* ------------------------------------------------------------------ */
/* Types mirroring the API payloads                                     */
/* ------------------------------------------------------------------ */

interface MemoryItemView {
  id: string;
  type: string;
  title: string;
  content: string;
  scope: string;
  scopeRef: string | null;
  source: string;
  status: string;
  origin: string;
  confidence: number;
  evidenceRefs: string[];
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface GlossaryView {
  id: string;
  term: string;
  definition: string;
  aliases: string[];
}

interface DriftFinding {
  item: MemoryItemView;
  verdict: "ok" | "possible-drift" | "contradiction";
  message: string;
  evidence: { term: string; files: number }[];
  filesScanned: number;
}

interface CodemindState {
  exists: boolean;
  hasRulesHeading: boolean;
  rulesWithState: { line: number; text: string; evidenceRef: string; saved?: boolean }[];
  savedCount: number;
}

interface PrefsState {
  depth: MemoryDepth;
  incognitoMemoryReads: boolean;
  incognitoMemoryWrites: boolean;
  retentionDays: number;
}

interface HabitView {
  id: string;
  label: string;
  occurrences: number;
  threshold: number;
  proposal: string | null;
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */

type ApiEnvelope<T> = { ok?: boolean; success?: boolean; data?: T; error?: { message?: string } };

async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const json = (await res.json()) as ApiEnvelope<T>;
  if (!res.ok || (!json.data && json.ok === false)) {
    throw new Error(json.error?.message ?? `request failed (${res.status})`);
  }
  return json.data as T;
}

async function apiSend<T>(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as ApiEnvelope<T>;
  if (!res.ok) {
    throw new Error(json.error?.message ?? `request failed (${res.status})`);
  }
  return json.data as T;
}

const TYPE_LABEL: Record<string, string> = {
  "project-rule": "Rule",
  decision: "Decision",
  concept: "Concept",
  preference: "Preference",
  correction: "Correction",
  fact: "Fact",
  summary: "Summary",
  other: "Other",
};

const STATUS_TONE: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  proposed: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  disabled: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
  superseded: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
};

const VERDICT_TONE: Record<DriftFinding["verdict"], string> = {
  contradiction: "border-red-500/40 bg-red-500/5",
  "possible-drift": "border-amber-500/40 bg-amber-500/5",
  ok: "border-emerald-500/30 bg-emerald-500/5",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/* ------------------------------------------------------------------ */
/* Panel                                                                */
/* ------------------------------------------------------------------ */

export function MemoryPanel() {
  const [items, setItems] = useState<MemoryItemView[] | null>(null);
  const [inbox, setInbox] = useState<MemoryItemView[] | null>(null);
  const [glossary, setGlossary] = useState<GlossaryView[] | null>(null);
  const [codemind, setCodemind] = useState<CodemindState | null>(null);
  const [prefs, setPrefs] = useState<PrefsState | null>(null);
  const [habits, setHabits] = useState<HabitView[] | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const flash = useCallback((message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 3500);
  }, []);

  const reloadAll = useCallback(async () => {
    try {
      const [itemsD, inboxD, glossaryD, codemindD, prefsD, habitsD] = await Promise.all([
        apiGet<{ items: MemoryItemView[] }>("/api/memory/items"),
        apiGet<{ items: MemoryItemView[] }>("/api/memory/inbox"),
        apiGet<{ entries: GlossaryView[] }>("/api/memory/glossary"),
        apiGet<CodemindState>("/api/memory/codemind"),
        apiGet<{ preferences: PrefsState }>("/api/memory/preferences"),
        apiGet<{ habits: HabitView[] }>("/api/memory/habits"),
      ]);
      setItems(itemsD.items);
      setInbox(inboxD.items);
      setGlossary(glossaryD.entries);
      setCodemind(codemindD);
      setPrefs(prefsD.preferences);
      setHabits(habitsD.habits);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load memory data");
    }
  }, []);

  useEffect(() => {
    void reloadAll();
  }, [reloadAll]);

  const act = useCallback(
    async (fn: () => Promise<void>, successNote?: string) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        await reloadAll();
        if (successNote) flash(successNote);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed");
      } finally {
        setBusy(false);
      }
    },
    [reloadAll, flash],
  );

  const activeCount = items?.filter((i) => i.status === "active").length ?? 0;
  const proposedCount = inbox?.length ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Header */}
      <div className="shrink-0 border-b border-border-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          <Brain aria-hidden="true" className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Adaptive Memory Engine</h2>
          <Badge variant="outline" className="text-[10px]">Phase 9.5</Badge>
          <div className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>{activeCount} active</span>
            <span>·</span>
            <span>{proposedCount} in inbox</span>
          </div>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          Memory informs answers but never overrides repository evidence. Inferred memory activates only
          after you accept it in the Inbox. Secrets and repository-instruction text are refused by the engine.
        </p>
      </div>

      {error && (
        <div role="alert" className="shrink-0 border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-[11px] text-red-700 dark:text-red-400">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="shrink-0 border-b border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-[11px] text-emerald-700 dark:text-emerald-400">
          {notice}
        </div>
      )}

      <Tabs defaultValue="memories" className="flex min-h-0 flex-1 flex-col gap-0">
        <TabsList className="h-8 w-full shrink-0 justify-start gap-0.5 overflow-x-auto rounded-none border-b border-border-subtle bg-transparent p-0 px-2">
          {[
            ["memories", "Memories"],
            ["inbox", "Inbox"],
            ["drift", "Drift"],
            ["glossary", "Glossary"],
            ["codemind", "CODEMIND.md"],
            ["habits", "Habits"],
          ].map(([value, label]) => (
            <TabsTrigger
              key={value}
              value={value}
              id={`memory-tab-${value}`}
              className="h-8 rounded-none border-b-2 border-transparent px-2.5 text-[11px] data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              {label}
              {value === "inbox" && proposedCount > 0 ? (
                <span className="ml-1 rounded-full bg-amber-500/20 px-1.5 text-[10px] text-amber-700 dark:text-amber-400">
                  {proposedCount}
                </span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ------------------------------ Memories ------------------------------ */}
        <TabsContent value="memories" className="min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
          <ScrollArea className="h-full">
            <div className="space-y-3 p-4">
              <AddMemoryForm
                busy={busy}
                onSave={(payload) =>
                  act(async () => {
                    await apiSend("/api/memory/items", "POST", payload);
                  }, "Memory saved (explicit, active).")
                }
              />
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium text-muted-foreground">
                  {items === null ? "Loading…" : `${items.length} item(s)`}
                </p>
                <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => void reloadAll()}>
                  <RefreshCw aria-hidden="true" className="mr-1 size-3" /> Refresh
                </Button>
              </div>
              {items?.length === 0 && (
                <p className="rounded-md border border-dashed border-border-subtle p-4 text-center text-[11px] text-muted-foreground">
                  No memories yet. Save an explicit rule below, or chat and check the Inbox for inferred
                  candidates.
                </p>
              )}
              <div className="space-y-2">
                {items?.map((item) => (
                  <MemoryCard
                    key={item.id}
                    item={item}
                    busy={busy}
                    onToggleStatus={() =>
                      act(
                        () =>
                          apiSend(`/api/memory/items/${item.id}`, "PATCH", {
                            status: item.status === "active" ? "disabled" : "active",
                          }),
                        item.status === "active" ? "Memory disabled." : "Memory re-enabled.",
                      )
                    }
                    onDelete={() =>
                      act(() => apiSend(`/api/memory/items/${item.id}`, "DELETE"), "Memory deleted.")
                    }
                  />
                ))}
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ------------------------------ Inbox ------------------------------ */}
        <TabsContent value="inbox" className="min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
          <ScrollArea className="h-full">
            <div className="space-y-2 p-4">
              <p className="text-[11px] text-muted-foreground">
                Inferred from YOUR messages only. Nothing here is active until you accept it (spec §6).
              </p>
              {inbox === null && <p className="text-[11px] text-muted-foreground">Loading…</p>}
              {inbox?.length === 0 && (
                <p className="rounded-md border border-dashed border-border-subtle p-4 text-center text-[11px] text-muted-foreground">
                  The Inbox is empty. Chat with the assistant — convention/decision/preference statements in
                  your messages may land here as proposals.
                </p>
              )}
              {inbox?.map((item) => (
                <div key={item.id} className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5">
                  <div className="flex items-center gap-1.5">
                    <Badge className="bg-amber-500/15 text-[10px] text-amber-700 dark:text-amber-400">
                      {TYPE_LABEL[item.type] ?? item.type}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      confidence {(item.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-medium">{item.title}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{item.content}</p>
                  <div className="mt-2 flex gap-1.5">
                    <Button
                      size="sm"
                      className="h-6 text-[11px]"
                      disabled={busy}
                      onClick={() =>
                        act(
                          () => apiSend("/api/memory/inbox", "POST", { id: item.id, decision: "accept" }),
                          "Accepted — memory is now active.",
                        )
                      }
                    >
                      <Check aria-hidden="true" className="mr-1 size-3" /> Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[11px]"
                      disabled={busy}
                      onClick={() =>
                        act(
                          () => apiSend("/api/memory/inbox", "POST", { id: item.id, decision: "reject" }),
                          "Rejected — the proposal was never activated.",
                        )
                      }
                    >
                      <X aria-hidden="true" className="mr-1 size-3" /> Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ------------------------------ Drift ------------------------------ */}
        <DriftTab busy={busy} act={act} />

        {/* ------------------------------ Glossary ------------------------------ */}
        <TabsContent value="glossary" className="min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
          <GlossaryTab
            glossary={glossary}
            busy={busy}
            onSave={(payload) =>
              act(async () => {
                await apiSend("/api/memory/glossary", "POST", payload);
              }, "Glossary entry saved.")
            }
            onDelete={(id) =>
              act(() => apiSend(`/api/memory/glossary?id=${encodeURIComponent(id)}`, "DELETE"), "Glossary entry deleted.")
            }
          />
        </TabsContent>

        {/* ------------------------------ CODEMIND.md ------------------------------ */}
        <TabsContent value="codemind" className="min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
          <ScrollArea className="h-full">
            <div className="space-y-3 p-4">
              <div className="rounded-md border border-border-subtle p-2.5">
                <div className="flex items-center gap-2">
                  <FileText aria-hidden="true" className="size-3.5 text-primary" />
                  <p className="text-xs font-medium">CODEMIND.md — your project rules file</p>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {codemind === null
                    ? "Checking…"
                    : codemind.exists
                      ? `${codemind.rulesWithState.length} rule line(s) found (${codemind.savedCount} already saved). User-authored rules only — README content is never read by the memory engine.`
                      : "No CODEMIND.md exists at the repository root yet. Create one with a “# CodeMind Project Rules” section and bullet lines."}
                </p>
                {codemind && codemind.exists && (
                  <>
                    <ul className="mt-2 space-y-1">
                      {codemind.rulesWithState.map((rule) => (
                        <li key={rule.evidenceRef} className="flex items-start gap-1.5 text-[11px]">
                          <span className="font-mono text-[10px] text-muted-foreground">L{rule.line}</span>
                          <span className="flex-1">{rule.text}</span>
                          {rule.saved ? (
                            <Badge className="bg-emerald-500/15 text-[9px] text-emerald-700 dark:text-emerald-400">saved</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[9px]">not saved</Badge>
                          )}
                        </li>
                      ))}
                      {codemind.rulesWithState.length === 0 && (
                        <li className="text-[11px] text-muted-foreground">No bullet rule lines found under the heading.</li>
                      )}
                    </ul>
                    <Button
                      size="sm"
                      className="mt-2 h-6 text-[11px]"
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          const result = await apiSend<{ created: number; skipped: number }>(
                            "/api/memory/codemind",
                            "POST",
                          );
                          flash(`CODEMIND.md sync: ${result.created} saved, ${result.skipped} already present.`);
                        })
                      }
                    >
                      <BookMarked aria-hidden="true" className="mr-1 size-3" /> Sync rules into memory
                    </Button>
                  </>
                )}
              </div>
              <p className="text-[10.5px] leading-snug text-muted-foreground">
                Security rule: memories are never created from README instructions, source comments, tool
                output, logs or commit messages — CODEMIND.md is the one explicit, user-authored exception.
              </p>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ------------------------------ Habits ------------------------------ */}
        <TabsContent value="habits" className="min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
          <ScrollArea className="h-full">
            <div className="space-y-2 p-4">
              <p className="text-[11px] text-muted-foreground">
                Computed from your real chat history. A habit only PROPOSES a workflow — it never silently
                changes autonomy (spec §10).
              </p>
              {habits === null && <p className="text-[11px] text-muted-foreground">Loading…</p>}
              {habits?.map((habit) => (
                <div key={habit.id} className="rounded-md border border-border-subtle p-2.5">
                  <p className="text-xs font-medium">{habit.label}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {habit.occurrences} occurrence(s) observed (proposal threshold: {habit.threshold}).
                  </p>
                  {habit.proposal && (
                    <p className="mt-1.5 rounded-md bg-primary/5 p-2 text-[11px]">{habit.proposal}</p>
                  )}
                </div>
              ))}
              {habits?.length === 0 && (
                <p className="rounded-md border border-dashed border-border-subtle p-4 text-center text-[11px] text-muted-foreground">
                  No chat history yet.
                </p>
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* Preferences footer */}
      {prefs && (
        <div className="shrink-0 border-t border-border-subtle p-3">
          <p className="mb-2 text-[11px] font-medium">Run defaults</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[10px] text-muted-foreground">Answer depth</Label>
              <Select
                value={prefs.depth}
                onValueChange={(value) =>
                  act(
                    () => apiSend("/api/memory/preferences", "PATCH", { depth: value }),
                    `Depth set to ${value}. One-click per-run override stays available in the composer.`,
                  )
                }
              >
                <SelectTrigger className="mt-1 h-7 text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="beginner" className="text-[11px]">Beginner</SelectItem>
                  <SelectItem value="standard" className="text-[11px]">Standard</SelectItem>
                  <SelectItem value="expert" className="text-[11px]">Expert</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] text-muted-foreground">Incognito: skip memory reads</Label>
                <Switch
                  checked={prefs.incognitoMemoryReads}
                  onCheckedChange={(checked) =>
                    act(
                      () => apiSend("/api/memory/preferences", "PATCH", { incognitoMemoryReads: checked }),
                      checked ? "Memory reads off for new runs." : "Memory reads restored.",
                    )
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-[10px] text-muted-foreground">Incognito: no memory writes</Label>
                <Switch
                  checked={prefs.incognitoMemoryWrites}
                  onCheckedChange={(checked) =>
                    act(
                      () => apiSend("/api/memory/preferences", "PATCH", { incognitoMemoryWrites: checked }),
                      checked ? "New memory never saved from runs." : "Memory writes restored.",
                    )
                  }
                />
              </div>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Depth never suppresses security, correctness, data-loss or approval warnings.
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Add-memory form (explicit save)                                      */
/* ------------------------------------------------------------------ */

function AddMemoryForm({
  busy,
  onSave,
}: {
  busy: boolean;
  onSave: (payload: { type: string; title: string; content: string; scope: string; scopeRef: string | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("project-rule");
  const [scope, setScope] = useState("repository");
  const [scopeRef, setScopeRef] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  if (!open) {
    return (
      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" className="mr-1 size-3" /> Save an explicit memory
      </Button>
    );
  }

  return (
    <form
      className="space-y-2 rounded-md border border-border-subtle p-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim() || !content.trim()) return;
        onSave({
          type,
          title: title.trim(),
          content: content.trim(),
          scope,
          scopeRef: scopeRef.trim() || null,
        });
        setTitle("");
        setContent("");
        setScopeRef("");
        setOpen(false);
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] text-muted-foreground">Layer</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="mt-1 h-7 text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MEMORY_TYPES.map((t) => (
                <SelectItem key={t} value={t} className="text-[11px]">
                  {MEMORY_LAYER_META[t as keyof typeof MEMORY_LAYER_META]?.label ?? TYPE_LABEL[t] ?? t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Scope</Label>
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger className="mt-1 h-7 text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MEMORY_SCOPES.map((s) => (
                <SelectItem key={s} value={s} className="text-[11px]">
                  {s}
                  {s === "team" ? " (needs owner/maintainer)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {["path", "language", "team"].includes(scope) && (
        <div>
          <Label className="text-[10px] text-muted-foreground">
            Scope ref ({scope === "path" ? "path prefix" : scope === "language" ? "language id" : "repository id"})
          </Label>
          <Input
            value={scopeRef}
            onChange={(event) => setScopeRef(event.target.value)}
            placeholder={scope === "path" ? "src/server/…" : scope === "language" ? "typescript" : "repo uuid"}
            className="mt-1 h-7 text-[11px]"
          />
        </div>
      )}
      <div>
        <Label className="text-[10px] text-muted-foreground">Title</Label>
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="e.g. This repository uses fetch, not axios"
          className="mt-1 h-7 text-[11px]"
        />
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground">Content</Label>
        <Textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="The full rule / decision / concept text…"
          rows={2}
          className="mt-1 min-h-0 text-[11px]"
        />
      </div>
      <div className="flex gap-1.5">
        <Button type="submit" size="sm" className="h-6 text-[11px]" disabled={busy || !title.trim() || !content.trim()}>
          Save memory
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Memory card                                                          */
/* ------------------------------------------------------------------ */

function MemoryCard({
  item,
  busy,
  onToggleStatus,
  onDelete,
}: {
  item: MemoryItemView;
  busy: boolean;
  onToggleStatus: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-md border border-border-subtle p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="text-[10px]">{TYPE_LABEL[item.type] ?? item.type}</Badge>
        <Badge className={`text-[10px] ${STATUS_TONE[item.status] ?? ""}`}>{item.status}</Badge>
        <Badge variant="secondary" className="text-[10px]">
          {item.scope}{item.scopeRef ? `: ${item.scopeRef.slice(0, 24)}` : ""}
        </Badge>
        <Badge variant="secondary" className="text-[10px]">
          {item.source === "inferred" ? "inferred" : "explicit"}
        </Badge>
        {item.origin === "codemind-md" && (
          <Badge variant="secondary" className="text-[10px]">CODEMIND.md</Badge>
        )}
      </div>
      <p className={`mt-1 text-xs font-medium ${item.status === "disabled" ? "text-muted-foreground line-through" : ""}`}>
        {item.title}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{item.content}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
        {item.evidenceRefs.length > 0 && <span className="font-mono">evidence: {item.evidenceRefs.join(", ")}</span>}
        <span>used {item.useCount}× · last {timeAgo(item.lastUsedAt)}</span>
      </div>
      <div className="mt-2 flex gap-1.5">
        <Button size="sm" variant="outline" className="h-6 text-[11px]" disabled={busy} onClick={onToggleStatus}>
          {item.status === "active" ? "Disable" : "Enable"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[11px] text-red-600 hover:text-red-700 dark:text-red-400"
          disabled={busy}
          onClick={onDelete}
        >
          <Trash2 aria-hidden="true" className="mr-1 size-3" /> Delete
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Drift tab (self-contained: runs the check on demand)                 */
/* ------------------------------------------------------------------ */

function DriftTab({
  busy,
  act,
}: {
  busy: boolean;
  act: (fn: () => Promise<void>, note?: string) => Promise<void>;
}) {
  const [result, setResult] = useState<{ findings: DriftFinding[]; filesScanned: number } | null>(null);
  const [checking, setChecking] = useState(false);

  const runCheck = useCallback(async () => {
    setChecking(true);
    try {
      const data = await apiGet<{ findings: DriftFinding[]; filesScanned: number }>("/api/memory/drift");
      setResult(data);
    } catch {
      setResult({ findings: [], filesScanned: 0 });
    } finally {
      setChecking(false);
    }
  }, []);

  const findings = result?.findings ?? [];
  const driftCount = findings.filter((f) => f.verdict !== "ok").length;

  return (
    <TabsContent value="drift" className="min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
      <ScrollArea className="h-full">
        <div className="space-y-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              Heuristic memory-vs-code check (term presence in the real workspace — honest limits).
            </p>
            <Button size="sm" variant="outline" className="h-6 shrink-0 text-[11px]" onClick={() => void runCheck()} disabled={checking}>
              {checking ? <Loader2 aria-hidden="true" className="mr-1 size-3 animate-spin" /> : <RefreshCw aria-hidden="true" className="mr-1 size-3" />}
              Run check
            </Button>
          </div>
          {result && (
            <p className="text-[11px] text-muted-foreground">
              {result.filesScanned} files scanned · {driftCount} drift signal(s) across {findings.length} active memory item(s).
            </p>
          )}
          {result && findings.length === 0 && (
            <p className="rounded-md border border-dashed border-border-subtle p-4 text-center text-[11px] text-muted-foreground">
              No active memories to check yet.
            </p>
          )}
          {findings.map((finding) => (
            <div key={finding.item.id} className={`rounded-md border p-2.5 ${VERDICT_TONE[finding.verdict]}`}>
              <div className="flex items-center gap-1.5">
                {finding.verdict !== "ok" && (
                  <ShieldAlert aria-hidden="true" className="size-3.5 text-amber-600 dark:text-amber-400" />
                )}
                <Badge variant="outline" className="text-[10px]">{TYPE_LABEL[finding.item.type] ?? finding.item.type}</Badge>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{finding.verdict}</span>
              </div>
              <p className="mt-1 text-xs font-medium">{finding.item.title}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{finding.message}</p>
              <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-muted-foreground">
                {finding.evidence.map((e) => (
                  <span key={e.term} className="font-mono">
                    “{e.term}”: {e.files} file(s)
                  </span>
                ))}
              </div>
              {finding.verdict !== "ok" && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[11px]"
                    disabled={busy}
                    onClick={() =>
                      act(
                        () => apiSend("/api/memory/drift", "POST", { id: finding.item.id, decision: "reviewed" }),
                        "Marked as reviewed (audit recorded).",
                      )
                    }
                  >
                    Review
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[11px]"
                    disabled={busy}
                    onClick={() =>
                      act(
                        () => apiSend("/api/memory/drift", "POST", { id: finding.item.id, decision: "kept" }),
                        "Kept as-is (audit recorded).",
                      )
                    }
                  >
                    Keep
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[11px]"
                    disabled={busy}
                    onClick={() =>
                      act(
                        () => apiSend(`/api/memory/items/${finding.item.id}`, "PATCH", { status: "disabled" }),
                        "Memory disabled.",
                      )
                    }
                  >
                    Disable
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </TabsContent>
  );
}

/* ------------------------------------------------------------------ */
/* Glossary tab                                                         */
/* ------------------------------------------------------------------ */

function GlossaryTab({
  glossary,
  busy,
  onSave,
  onDelete,
}: {
  glossary: GlossaryView[] | null;
  busy: boolean;
  onSave: (payload: { term: string; definition: string; aliases: string[] }) => void;
  onDelete: (id: string) => void;
}) {
  const [term, setTerm] = useState("");
  const [definition, setDefinition] = useState("");
  const [aliases, setAliases] = useState("");

  return (
    <ScrollArea className="h-full">
      <div className="space-y-3 p-4">
        <form
          className="space-y-2 rounded-md border border-border-subtle p-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!term.trim() || !definition.trim()) return;
            onSave({
              term: term.trim(),
              definition: definition.trim(),
              aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean),
            });
            setTerm("");
            setDefinition("");
            setAliases("");
          }}
        >
          <p className="text-[11px] font-medium">Map your language to the repository (spec §8)</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px] text-muted-foreground">Your term</Label>
              <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="mera auth module" className="mt-1 h-7 text-[11px]" />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Aliases (comma-separated)</Label>
              <Input value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="my auth, auth wala" className="mt-1 h-7 text-[11px]" />
            </div>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Maps to (path / concept)</Label>
            <Input value={definition} onChange={(e) => setDefinition(e.target.value)} placeholder="src/features/auth/* — JWT login + refresh flow" className="mt-1 h-7 text-[11px]" />
          </div>
          <Button type="submit" size="sm" className="h-6 text-[11px]" disabled={busy || !term.trim() || !definition.trim()}>
            Save entry
          </Button>
        </form>
        {glossary === null && <p className="text-[11px] text-muted-foreground">Loading…</p>}
        {glossary?.length === 0 && (
          <p className="rounded-md border border-dashed border-border-subtle p-4 text-center text-[11px] text-muted-foreground">
            No glossary entries yet.
          </p>
        )}
        {glossary?.map((entry) => (
          <div key={entry.id} className="rounded-md border border-border-subtle p-2.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium">“{entry.term}”</p>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[11px] text-red-600 hover:text-red-700 dark:text-red-400"
                disabled={busy}
                onClick={() => onDelete(entry.id)}
              >
                <Trash2 aria-hidden="true" className="size-3" />
              </Button>
            </div>
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">→ {entry.definition}</p>
            {entry.aliases.length > 0 && (
              <p className="mt-1 text-[10px] text-muted-foreground">aliases: {entry.aliases.join(", ")}</p>
            )}
          </div>
        ))}
        <p className="text-[10.5px] text-muted-foreground">
          Glossary hits are handed to runs as DATA (“user says X means Y”), never as instructions.
        </p>
      </div>
    </ScrollArea>
  );
}
