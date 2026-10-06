"use client";

/**
 * CodeMind X V2 — Orchestrator console (Phase 9 §6 trace UI).
 *
 * Shows the HIGH-LEVEL execution trace only: agent chips (Planner ✓,
 * Retrieval ✓, Security ✗ …), per-agent findings/evidence, the critic
 * verdict, pending approvals and final answers. NEVER model reasoning.
 *
 * The 11 acceptance scenarios from spec §9 are available as one-click
 * presets (failed agent / timeout / retry are honest engine drills using
 * the documented fault-injection switch).
 */

import { useCallback, useEffect, useState } from "react";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, CircleSlash, Clock, Loader2, Play, ShieldAlert, Square, XCircle } from "lucide-react";

import { AGENT_SPECS } from "@/server/orchestrator/registry";
import type { AgentName, OrchestrationRunState } from "@/server/orchestrator/contracts";
import { useOrchestratorRun } from "./use-orchestrator-run";

/* ------------------------------------------------------------------ */
/* Acceptance presets (spec §9)                                        */
/* ------------------------------------------------------------------ */

interface Preset {
  id: string;
  label: string;
  request: string;
  fault?: { agent: AgentName; mode: "error" | "error-once" | "timeout" };
}

const PRESETS: Preset[] = [
  { id: "simple", label: "Simple question", request: "What does the LLM gateway do and where is it implemented?" },
  { id: "search", label: "Search question", request: "Find where the hybrid search index is built and how BM25 scoring works." },
  { id: "arch", label: "Architecture question", request: "Explain the module structure and import relationships of the search server code." },
  { id: "security", label: "Security question", request: "Run a security review over the search server code and report risky patterns with locations." },
  { id: "coding", label: "Coding task (approval)", request: "Propose a small improvement: add a focused doc comment block to the top of src/lib/utils.ts explaining its helpers." },
  { id: "multi", label: "Multi-agent task", request: "Comprehensive audit of the server services: security issues AND dependency hygiene AND import structure." },
  { id: "failed", label: "Failed agent (drill)", request: "What does the LLM gateway do?", fault: { agent: "retrieval", mode: "error" } },
  { id: "timeout", label: "Timeout (drill)", request: "What does the LLM gateway do?", fault: { agent: "retrieval", mode: "timeout" } },
  { id: "retry", label: "Retry (drill)", request: "What does the LLM gateway do?", fault: { agent: "retrieval", mode: "error-once" } },
];

/* ------------------------------------------------------------------ */
/* Status presentation                                                 */
/* ------------------------------------------------------------------ */

const SPAN_STATUS_META: Record<string, { icon: React.ReactNode; tone: string; label: string }> = {
  completed: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, tone: "text-emerald-600 dark:text-emerald-400", label: "✓" },
  failed: { icon: <XCircle className="h-3.5 w-3.5" />, tone: "text-red-600 dark:text-red-400", label: "✗" },
  timeout: { icon: <Clock className="h-3.5 w-3.5" />, tone: "text-amber-600 dark:text-amber-400", label: "⏱" },
  skipped: { icon: <CircleSlash className="h-3.5 w-3.5" />, tone: "text-zinc-500", label: "skip" },
  cancelled: { icon: <XCircle className="h-3.5 w-3.5" />, tone: "text-zinc-500", label: "cancelled" },
  "awaiting-approval": { icon: <ShieldAlert className="h-3.5 w-3.5" />, tone: "text-amber-600 dark:text-amber-400", label: "⏸" },
  running: { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, tone: "text-blue-600 dark:text-blue-400", label: "…" },
};

function statusMeta(status: string) {
  return SPAN_STATUS_META[status] ?? SPAN_STATUS_META.running;
}

const ACTIVE = new Set(["queued", "running", "waiting-approval"]);

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

export function OrchestratorPanel() {
  const [request, setRequest] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [recent, setRecent] = useState<Array<{ runPublicId: string; status: string; request: string; agentCount: number; completedAt: string | null }>>([]);

  const { state } = useOrchestratorRun(runId);
  const running = state ? ACTIVE.has(state.status) : false;

  const loadRecent = useCallback(async () => {
    try {
      const res = await fetch("/api/orchestrator/runs", { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as { data: { runs: typeof recent } };
        setRecent(json.data.runs);
      }
    } catch {
      // recent list is best-effort
    }
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent, state?.status]);

  const startRun = useCallback(
    async (preset: Preset | null) => {
      const text = (preset?.request ?? request).trim();
      if (text.length < 3) return;
      setStarting(true);
      setStartError(null);
      try {
        const res = await fetch("/api/orchestrator/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            request: text,
            preset: preset?.id ?? null,
            fault: preset?.fault ?? null,
          }),
        });
        if (!res.ok) throw new Error(`start failed (${res.status})`);
        const json = (await res.json()) as { data: { runPublicId: string } };
        setRunId(json.data.runPublicId);
      } catch (err) {
        setStartError(err instanceof Error ? err.message : "failed to start run");
      } finally {
        setStarting(false);
      }
    },
    [request],
  );

  const cancelRun = useCallback(async () => {
    if (!runId) return;
    await fetch(`/api/orchestrator/runs/${runId}/cancel`, { method: "POST" });
  }, [runId]);

  const decideApproval = useCallback(
    async (approvalId: string, decision: "approved" | "rejected") => {
      if (!runId) return;
      await fetch(`/api/orchestrator/runs/${runId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId, decision }),
      });
    },
    [runId],
  );

  const pendingApproval = state?.approvals.find((a) => a.status === "pending");

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="orchestrator-panel">
      <ScrollArea className="h-full">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 pb-10 sm:p-6">
          {/* Header */}
          <div>
            <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Multi-Agent Orchestrator</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Planner → selected agents (parallel where independent) → Critic → answer. High-level trace only — internal
              reasoning is never exposed (Phase 9 §6).
            </p>
          </div>

          {/* Presets */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Acceptance scenarios (spec §9)</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  variant="outline"
                  size="sm"
                  disabled={starting || running}
                  onClick={() => void startRun(preset)}
                  className="h-8"
                >
                  {preset.label}
                </Button>
              ))}
            </CardContent>
          </Card>

          {/* Composer */}
          <Card>
            <CardContent className="flex flex-col gap-3 p-4">
              <Textarea
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                placeholder="Ask anything about the repository, or describe a coding task…"
                className="min-h-[72px] resize-y"
                aria-label="Orchestrator request"
              />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={starting || running || request.trim().length < 3}
                  onClick={() => void startRun(null)}
                >
                  {starting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
                  Run
                </Button>
                {running && (
                  <Button size="sm" variant="destructive" onClick={() => void cancelRun()}>
                    <Square className="mr-1.5 h-3.5 w-3.5" />
                    Cancel
                  </Button>
                )}
                {state && (
                  <Badge variant={state.status === "completed" ? "secondary" : "outline"} className="ml-auto">
                    run: {state.status}
                    {state.durationMs ? ` · ${(state.durationMs / 1000).toFixed(1)}s` : ""}
                  </Badge>
                )}
              </div>
              {startError && (
                <Alert variant="destructive">
                  <AlertDescription>{startError}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* Pending approval (spec §4 / §9 approval) */}
          {pendingApproval && (
            <Alert>
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Approval required — {pendingApproval.kind}</AlertTitle>
              <AlertDescription>
                <div className="mt-1 space-y-1 text-sm">
                  <p>
                    <span className="font-medium">What changes:</span> {pendingApproval.whatWillChange}
                  </p>
                  <p>
                    <span className="font-medium">Why:</span> {pendingApproval.whyApprovalNeeded}
                  </p>
                  <p>
                    <span className="font-medium">Risk:</span> {pendingApproval.risk}
                  </p>
                  <div className="flex gap-2 pt-2">
                    <Button size="sm" onClick={() => void decideApproval(pendingApproval.id, "approved")}>
                      Approve (records decision)
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void decideApproval(pendingApproval.id, "rejected")}>
                      Reject
                    </Button>
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Trace */}
          {state && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">
                  Execution trace
                  {state.intent ? (
                    <span className="ml-2 font-normal text-muted-foreground">
                      intent: {state.intent.kind}
                      {state.retrievedAgain ? " · re-retrieved once" : ""}
                    </span>
                  ) : null}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Chips (spec §6: Planner ✓ Retrieval ✓ …) */}
                <div className="flex flex-wrap gap-2">
                  {state.spans.map((span, i) => {
                    const meta = statusMeta(span.status);
                    return (
                      <span
                        key={`${span.agent}-${i}`}
                        className={`inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs font-medium ${meta.tone}`}
                      >
                        {meta.icon}
                        {AGENT_SPECS[span.agent]?.label ?? span.agent}
                        <span className="font-normal text-muted-foreground">
                          {span.status === "completed" ? `${(span.durationMs / 1000).toFixed(1)}s` : span.status}
                          {span.attempts > 1 ? ` · ${span.attempts} tries` : ""}
                        </span>
                      </span>
                    );
                  })}
                  {state.spans.length === 0 && (
                    <span className="text-sm text-muted-foreground">Waiting for the planner…</span>
                  )}
                </div>

                {/* Per-agent findings + evidence */}
                {state.spans.some((s) => s.findings.length > 0) && (
                  <Accordion type="multiple" className="w-full">
                    {state.spans.map((span, i) => (
                      <AccordionItem key={`acc-${span.agent}-${i}`} value={`acc-${span.agent}-${i}`}>
                        <AccordionTrigger className="py-2 text-sm">
                          <span className="flex items-center gap-2">
                            <span className={statusMeta(span.status).tone}>{statusMeta(span.status).label}</span>
                            {AGENT_SPECS[span.agent]?.label ?? span.agent}
                            <span className="font-normal text-muted-foreground">
                              {span.toolCount} tool call{span.toolCount === 1 ? "" : "s"}
                            </span>
                          </span>
                        </AccordionTrigger>
                        <AccordionContent>
                          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                            {span.findings.length ? (
                              span.findings.map((f, j) => <li key={j}>{f}</li>)
                            ) : (
                              <li>{span.error ?? "no findings"}</li>
                            )}
                          </ul>
                          {span.evidence.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {span.evidence.map((ev, j) => (
                                <div key={j} className="rounded-md border px-2.5 py-1.5 font-mono text-xs">
                                  <span className="text-foreground">
                                    {ev.path}
                                    {ev.line ? `:${ev.line}` : ""}
                                  </span>
                                  {ev.snippet && <span className="text-muted-foreground"> — {ev.snippet}</span>}
                                  <div className="text-muted-foreground">{ev.why}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                )}
              </CardContent>
            </Card>
          )}

          {/* Critic verdict */}
          {state?.criticVerdict && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Critic verdict</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Badge
                  variant={
                    state.criticVerdict === "supported"
                      ? "secondary"
                      : state.criticVerdict === "unverified"
                        ? "destructive"
                        : "outline"
                  }
                >
                  {state.criticVerdict}
                </Badge>
                {state.criticIssues.length > 0 && (
                  <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {state.criticIssues.map((issue, i) => (
                      <li key={i}>
                        <span className="font-medium text-foreground">{issue.kind}</span>
                        {issue.path ? ` (${issue.path})` : ""}: {issue.detail}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          {/* Final answer */}
          {state?.answer && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Answer</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="whitespace-pre-wrap text-sm leading-relaxed">{state.answer}</div>
                {state.changeSets.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <Separator />
                    {state.changeSets.map((cs) => (
                      <div key={cs.publicId} className="rounded-md border p-3 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{cs.title}</span>
                          <Badge variant="outline">{cs.status}</Badge>
                        </div>
                        {cs.description && <p className="mt-1 text-muted-foreground">{cs.description}</p>}
                        <div className="mt-2 space-y-1">
                          {cs.changes.map((c, i) => (
                            <div key={i} className="font-mono text-xs text-muted-foreground">
                              {c.changeKind}: {c.path} ({c.status})
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Registry (honest implemented/planned) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Agent registry (contracts)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {(Object.keys(AGENT_SPECS) as AgentName[]).map((name) => {
                  const spec = AGENT_SPECS[name];
                  return (
                    <div key={name} className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                      <div className="min-w-0">
                        <span className="font-medium">{spec.label}</span>
                        <span className="ml-1.5 text-xs text-muted-foreground">v{spec.version}</span>
                      </div>
                      <Badge variant={spec.status === "implemented" ? "secondary" : "outline"} className="shrink-0">
                        {spec.status}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Recent runs (observability §8) */}
          {recent.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Recent runs</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {recent.slice(0, 8).map((run) => (
                    <button
                      key={run.runPublicId}
                      className="flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm hover:bg-accent"
                      onClick={() => setRunId(run.runPublicId)}
                    >
                      <Badge variant="outline" className="shrink-0">
                        {run.status}
                      </Badge>
                      <span className="truncate text-muted-foreground">{run.request || "(no request text)"}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{run.agentCount} agents</span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
