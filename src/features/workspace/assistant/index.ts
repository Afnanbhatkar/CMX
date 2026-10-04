/**
 * CodeMind X V2 — assistant integration module (Phase 8, V2.1 partition).
 *
 * Public surface of the shared contract + plumbing that sub-phases consume:
 * - contracts.ts — events, activity model, composer/approval/question shapes
 * - activity-engine.ts — the ActivityEngine state machine + snapshot store
 * - run-adapter.ts — honest mapping of the current single-shot run onto events
 * - use-assistant-engine.ts — React binding
 */

export * from "./contracts";
export {
  AssistantActivityEngine,
  assistantActivityEngine,
  emitAssistantEvent,
  type ActivityEngineSnapshot,
} from "./activity-engine";
export {
  createRunId,
  runStarted,
  runActivityStarted,
  runActivityCompleted,
  runCompleted,
  runFailed,
  runCancelled,
  applyWireEvent,
  recordFirstEventLatency,
  noteTransportSeq,
  getLastRunMetrics,
  type AssistantRunMetrics,
} from "./run-adapter";
export {
  selectRelevantCategories,
  activitiesToSteps,
  activityToStep,
  buildRunSteps,
  thoughtForLabel,
  CATEGORY_META,
  type RunStepSource,
} from "./category-engine";
export { useAssistantEngineSnapshot } from "./use-assistant-engine";
export { exposeAssistantTooling } from "./expose";
