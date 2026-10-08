import path from "node:path";
import { spawn } from "node:child_process";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { PROJECT_ROOT_ABS } from "@/lib/server/project-root";
import { isTextFile, languageForPath, resolveAllowedPath } from "@/lib/server/repository-fs";
import { audit } from "@/server/security/audit";

/**
 * POST /api/repository/run  { path: "examples/timer.py" }
 *
 * Agent Mode workspace runner (V2.2): executes ONE allowlisted Python file
 * from the real workspace so the user can see the AI-created code actually
 * run — output lands in the editor's run panel.
 *
 * Trust boundaries:
 * - the path goes through resolveAllowedPath (the read allowlist: traversal,
 *   dotfiles, secrets, non-workspace roots are all refused BEFORE this route);
 * - only `.py` files run — no shell, no interpolated command line: the file
 *   is passed to python3 as a single argv entry (spawn, never `sh -c`);
 * - `python3 -I -X utf8` — isolated mode (no user site-packages, no
 *   PYTHONPATH inheritance) for reproducible runs;
 * - hard 15s wall clock: the child is killed and the result honestly reports
 *   `timedOut: true`;
 * - stdout/stderr are capped (64 KB each) so a runaway `while True: print()`
 *   cannot exhaust server memory;
 * - runs from the project root, bytecode writing disabled.
 *
 * The response is a structured run record — exit code, duration, streams —
 * NEVER fabricated. Audit (V2.1 §D): one "repository.run" row per request,
 * metadata { path, exitCode, timedOut, durationMs } — never stream content.
 */

const RUN_TIMEOUT_MS = 15_000;
const MAX_STREAM_BYTES = 64 * 1024;

const runSchema = z.object({
  path: z.string().min(1).max(512),
});

interface RunRecord {
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

function runPythonFile(absolutePath: string): Promise<RunRecord> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn("python3", ["-I", "-X", "utf8", absolutePath], {
      cwd: PROJECT_ROOT_ABS,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const collect = (chunk: Buffer, sink: "out" | "err") => {
      const text = chunk.toString("utf-8");
      if (sink === "out") {
        if (stdout.length >= MAX_STREAM_BYTES) {
          truncated = true;
          return;
        }
        stdout = stdout + text.slice(0, MAX_STREAM_BYTES - stdout.length);
        if (stdout.length >= MAX_STREAM_BYTES) truncated = true;
      } else {
        if (stderr.length >= MAX_STREAM_BYTES) {
          truncated = true;
          return;
        }
        stderr = stderr + text.slice(0, MAX_STREAM_BYTES - stderr.length);
        if (stderr.length >= MAX_STREAM_BYTES) truncated = true;
      }
    };

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        timedOut,
        durationMs: Date.now() - started,
        stdout,
        stderr,
        truncated,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, RUN_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => collect(chunk, "out"));
    child.stderr.on("data", (chunk: Buffer) => collect(chunk, "err"));
    child.on("error", (error) => {
      timedOut = false;
      stderr = stderr + `\n[runtime] python3 could not be started: ${error.message}`;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = runSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Expected { path: string }." },
      { status: 400 },
    );
  }

  const check = resolveAllowedPath(parsed.data.path);
  if (!check.ok) {
    return NextResponse.json(
      { ok: false, error: "This path is outside the connected workspace." },
      { status: 403 },
    );
  }

  const base = path.basename(check.relative);
  if (!isTextFile(base) || languageForPath(base) !== "python") {
    return NextResponse.json(
      { ok: false, error: "Only Python (.py) files can be run right now." },
      { status: 415 },
    );
  }

  try {
    const run = await runPythonFile(check.absolute);
    void audit.repositoryAccess({
      targetType: "repository",
      targetId: check.relative,
      metadata: {
        scope: "run",
        path: check.relative,
        exitCode: run.exitCode,
        timedOut: run.timedOut,
        durationMs: run.durationMs,
      },
    });
    return NextResponse.json({ ok: true, run: { ...run, path: check.relative } });
  } catch (error) {
    console.error("[api/repository/run] failed:", error);
    return NextResponse.json({ ok: false, error: "The run service failed." }, { status: 500 });
  }
}
