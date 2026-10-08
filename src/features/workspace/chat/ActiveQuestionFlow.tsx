"use client";

/**
 * CodeMind X V2 — ActiveQuestionFlow (Agent Mode V2, spec §76/§77/§126).
 *
 * The contextual question component ABOVE the composer textarea:
 * - never a modal, never a normal chat bubble;
 * - associated with the current active run (the latest paused message);
 * - when resolved it collapses and the chain keeps "Question answered";
 * - "Custom answer" swaps in a small textarea + Confirm INSIDE this
 *   surface (no navigation, no dialog);
 * - the user's answer resumes the SAME run through /api/assistant/runs/
 *   answers + the resume stream.
 */

import { useState } from "react";

import { selectActiveConversation, useWorkspaceStore } from "@/stores/workspace-store";
import { useAssistantRun } from "./use-assistant-run";
import { QuestionFlow } from "./QuestionFlow";

export function ActiveQuestionFlow({ conversationId }: { conversationId: string }) {
  const activeConversation = useWorkspaceStore(selectActiveConversation);
  const { answerIntake } = useAssistantRun();
  const [submitting, setSubmitting] = useState(false);

  // The run waiting for input is the LATEST message in the active
  // conversation with a question batch and no answers yet (spec §76 — the
  // question stays tied to its run until it is resolved).
  const messages = activeConversation?.id === conversationId ? (activeConversation?.messages ?? []) : [];
  let target: { messageId: string; runId: string; batchIndex: number } | null = null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (
      message.state === "waiting" &&
      message.waitingKind === "question" &&
      message.questionBatch &&
      message.runId &&
      !message.intakeAnswers
    ) {
      target = { messageId: message.id, runId: message.runId, batchIndex: index };
      break;
    }
    // A newer terminal message means the older question is stale history.
    if (message.state === "complete" || message.state === "generating") break;
  }

  if (!target) return null;
  const message = messages[target.batchIndex];
  if (!message?.questionBatch) return null;

  const handleAnswer = async (answers: Parameters<typeof answerIntake>[3]) => {
    setSubmitting(true);
    try {
      await answerIntake(conversationId, target.messageId, target.runId, answers);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl shrink-0 px-3 pb-1" data-testid="active-question-flow">
      <QuestionFlow
        batch={message.questionBatch}
        answers={message.intakeAnswers ?? []}
        onAnswer={(answers) => void handleAnswer(answers)}
        submitting={submitting}
      />
    </div>
  );
}
