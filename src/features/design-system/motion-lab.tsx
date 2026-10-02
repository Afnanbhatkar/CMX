"use client";

import { useRef, useState } from "react";
import {
  ActivityTransition,
  FadeIn,
  GradientText,
  PanelTransition,
  ScaleIn,
  Shimmer,
  SlideIn,
  TextReveal,
  TypingText,
} from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import type { ActivityEvent } from "@/types/contracts";
import {
  Brain,
  Check,
  Code,
  FileText,
  FlaskConical,
  GitBranch,
  ListChecks,
  Network,
  Search,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const KIND_ICON: Record<ActivityEvent["kind"], LucideIcon> = {
  understanding: Brain,
  search: Search,
  read: FileText,
  plan: ListChecks,
  code: Code,
  test: FlaskConical,
  security: ShieldCheck,
  git: GitBranch,
  architecture: Network,
  finalize: Check,
};

const KIND_MESSAGE: Record<ActivityEvent["kind"], string> = {
  understanding: "Understanding request",
  search: "Searching repository",
  read: "Reading files",
  plan: "Planning changes",
  code: "Generating patch",
  test: "Running tests",
  security: "Performing security analysis",
  git: "Inspecting Git history",
  architecture: "Analyzing architecture",
  finalize: "Preparing diff",
};

const DEMO_KINDS: ActivityEvent["kind"][] = [
  "understanding",
  "search",
  "read",
  "plan",
  "test",
  "security",
  "git",
  "finalize",
];

function DemoCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-subtle bg-surface">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-mono text-sm font-medium text-foreground">{title}</h3>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        <div className="mt-4 flex min-h-24 items-center justify-center rounded-md border border-subtle bg-background/60 p-4">
          {children}
        </div>
      </CardContent>
    </Card>
  );
}

export function MotionLab() {
  const [simulateReduced, setSimulateReduced] = useState(false);
  const [panelA, setPanelA] = useState(true);
  const [events, setEvents] = useState<ActivityEvent[]>([
    {
      id: "seed-1",
      kind: "understanding",
      message: KIND_MESSAGE.understanding,
      createdAt: new Date().toISOString(),
    },
  ]);
  const counter = useRef(1);

  const appendEvent = () => {
    const kind = DEMO_KINDS[counter.current % DEMO_KINDS.length];
    counter.current += 1;
    setEvents((prev) => [
      ...prev.slice(-7),
      {
        id: `evt-${counter.current}-${Date.now()}`,
        kind,
        message: KIND_MESSAGE[kind],
        createdAt: new Date().toISOString(),
      },
    ]);
  };

  return (
    <section id="motion" aria-labelledby="motion-heading" className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Motion engine
          </p>
          <h2 id="motion-heading" className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            <TextReveal>Reusable, reduced-motion aware primitives</TextReveal>
          </h2>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={simulateReduced} onCheckedChange={setSimulateReduced} aria-label="Simulate reduced motion" />
          Simulate reduced motion
        </label>
      </div>

      <Separator className="my-8 bg-border-subtle" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <DemoCard title="FadeIn" hint="Fades in on first viewport entry">
          <FadeIn forceReducedMotion={simulateReduced}>
            <Badge variant="secondary">fade · once</Badge>
          </FadeIn>
        </DemoCard>

        <DemoCard title="SlideIn" hint="Directional travel, soft deceleration">
          <SlideIn direction="up" forceReducedMotion={simulateReduced}>
            <Badge variant="secondary">slide · up 24px</Badge>
          </SlideIn>
        </DemoCard>

        <DemoCard title="ScaleIn" hint="Subtle scale, no bounce">
          <ScaleIn forceReducedMotion={simulateReduced}>
            <Badge variant="secondary">scale · 0.96 → 1</Badge>
          </ScaleIn>
        </DemoCard>

        <DemoCard title="Shimmer" hint="Loading sweep — static when disabled">
          <div className="w-full max-w-48 space-y-2">
            <Shimmer className="h-3 w-full rounded" forceReducedMotion={simulateReduced} />
            <Shimmer className="h-3 w-4/5 rounded" active={false} />
          </div>
        </DemoCard>

        <DemoCard title="TypingText" hint="Terminal-style typing with caret">
          <div className="w-full text-left font-mono text-sm">
            <span className="text-muted-foreground">$ </span>
            <TypingText text="codemind analyze ./repo" loop loopPause={2} forceReducedMotion={simulateReduced} />
          </div>
        </DemoCard>

        <DemoCard title="GradientText" hint="Static gradient — the completed state">
          <span className="font-mono text-lg font-semibold">
            <GradientText forceReducedMotion={simulateReduced}>ready · 42 tests</GradientText>
          </span>
        </DemoCard>

        <DemoCard title="PanelTransition" hint="Mount/unmount with exit animation">
          <div className="w-full space-y-3 text-center">
            <PanelTransition show={panelA} forceReducedMotion={simulateReduced}>
              <div className="rounded-md border border-subtle bg-surface-hover px-4 py-2 font-mono text-sm">
                panel A
              </div>
            </PanelTransition>
            <PanelTransition show={!panelA} forceReducedMotion={simulateReduced}>
              <div className="rounded-md border border-primary/40 bg-primary/10 px-4 py-2 font-mono text-sm">
                panel B
              </div>
            </PanelTransition>
            <Button size="sm" variant="outline" onClick={() => setPanelA((v) => !v)}>
              Swap panels
            </Button>
          </div>
        </DemoCard>

        <DemoCard title="ActivityTransition" hint="Live activity stream (privacy-safe kinds)">
          <div className="w-full space-y-3 text-left">
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={appendEvent}>
                Append activity
              </Button>
            </div>
            <ScrollArea className="max-h-44">
              <ActivityTransition
                items={events}
                getKey={(e) => e.id}
                forceReducedMotion={simulateReduced}
                render={(e) => {
                  const Icon = KIND_ICON[e.kind];
                  return (
                    <div className="mb-2 flex items-center gap-2 rounded-md border border-subtle bg-surface px-3 py-2">
                      <Icon className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                      <span className="truncate font-mono text-xs text-foreground/90">{e.message}</span>
                    </div>
                  );
                }}
              />
            </ScrollArea>
          </div>
        </DemoCard>

        <DemoCard title="TextReveal" hint="Clipped word-by-word rise">
          <p className="text-center text-lg font-medium">
            <TextReveal forceReducedMotion={simulateReduced}>
              Precision over spectacle
            </TextReveal>
          </p>
        </DemoCard>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Activity labels follow the privacy contract: system actions only — never
        private model reasoning.
      </p>
    </section>
  );
}
