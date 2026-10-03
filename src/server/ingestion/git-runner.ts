import { spawn } from "node:child_process";

import { INGESTION_CONFIG } from "./config";
import { ImportCancelledError, IngestionError } from "./errors";
import { redactSecret, sanitizeGitOutput } from "./sanitize";

/**
 * CodeMind X V2 — hardened git process runner (Phase 4, spec §6).
 *
 * Ingestion is STATIC: the ONLY external binary ever executed is `git`, and
 * only through this module. Hardening:
 * - execFile-style argv arrays via spawn(..., { shell: false }) — never a
 *   shell string, so repository-controlled names can never be interpreted;
 * - sanitized env: GIT_TERMINAL_PROMPT=0 (no interactive prompts),
 *   GIT_CONFIG_NOSYSTEM=1 + GIT_CONFIG_GLOBAL=/dev/null (no config trust),
 *   stdin ignored. NOTE: GIT_ALLOW_PROTOCOL is deliberately NOT set — when
 *   it carries a multi-protocol list (e.g. "https,file") git denies the file
 *   transport even with `-c protocol.file.allow=user`. The default policy
 *   ("user") already permits https, and local imports pass the explicit
 *   per-protocol override on argv instead;
 * - argv-side hardening on every invocation: -c core.hooksPath=/dev/null (no
 *   repo hooks can ever run — ingestion must stay static) and, for local
 *   clones only, -c protocol.file.allow=user (git ≥2.38.1 requirement);
 * - cancel: poll() every ~500 ms — on cancel the child is SIGKILLed and an
 *   ImportCancelledError is thrown (spec: git child killed on cancel);
 * - output: capped capture; stderr is REDACTED (redactSecret) before it can
 *   enter any error message — clone URLs carry the ephemeral token.
 *
 * Settlement invariant (bug fixed in Phase 4 verification): EVERY path
 * through close/error/timeout calls exactly one of resolve/reject exactly
 * once. `settled` is only ever set immediately before settle.
 */

export interface GitRunOptions {
  /** Full argv AFTER the git binary, e.g. ["clone", "--depth", "1", url]. */
  args: string[];
  cwd?: string;
  /** Cancel poll callback (job control). When true → SIGKILL + throw. */
  checkCancel?: () => Promise<boolean>;
  /** "file" protocol only allowed for local-directory imports. */
  allowFileProtocol?: boolean;
  /** Raw token in play — redacted from any output before it escapes. */
  secret?: string;
  timeoutMs?: number;
}

export interface GitRunResult {
  stdout: string;
  stderr: string;
}

/** Minimal, prompt-free, config-free environment for the git child. */
function sanitizedEnv(allowFileProtocol: boolean): Record<string, string> {
  void allowFileProtocol; // protocol control lives on argv (see module doc)
  return {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: process.env.HOME ?? "/tmp",
    NODE_ENV: process.env.NODE_ENV ?? "development",
    LANG: "C",
    LC_ALL: "C",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    // No credential helpers, no editors, no pagers — batch-only git.
    GIT_ASKPASS: "true",
    GIT_PAGER: "cat",
    PAGER: "cat",
  };
}

export async function runGit(options: GitRunOptions): Promise<GitRunResult> {
  const {
    args,
    cwd,
    checkCancel,
    allowFileProtocol = false,
    secret,
    timeoutMs = INGESTION_CONFIG.git.commandTimeoutMs,
  } = options;

  const argv = [
    "-c", "core.hooksPath=/dev/null",
    ...(allowFileProtocol ? ["-c", "protocol.file.allow=user"] : []),
    ...args,
  ];

  return new Promise<GitRunResult>((resolve, reject) => {
    const child = spawn("git", argv, {
      cwd,
      env: sanitizedEnv(allowFileProtocol) as unknown as NodeJS.ProcessEnv,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    /** Settle the promise exactly once (single settlement invariant). */
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const fail = (error: unknown): void => settle(() => reject(error));

    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
      fail(new IngestionError("CLONE_FAILED", `git ${args[0]} timed out after ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < INGESTION_CONFIG.git.maxOutputBytes) stdout += chunk.toString("utf-8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < INGESTION_CONFIG.git.maxOutputBytes) stderr += chunk.toString("utf-8");
    });

    child.on("error", (error) => {
      fail(new IngestionError(
        "CLONE_FAILED",
        redactSecret(`git ${args[0]} failed to start: ${error.message}`, secret ? [secret] : undefined),
      ));
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      const redactedStderr = sanitizeGitOutput(stderr, secret);
      if (code === 0) {
        settle(() => resolve({ stdout, stderr: redactedStderr }));
        return;
      }
      const reason = redactedStderr || `exit code ${code ?? "unknown"}${signal ? ` (signal ${signal})` : ""}`;
      fail(new IngestionError("CLONE_FAILED", `git ${args[0]} failed: ${reason}`));
    });

    // Cooperative cancel: poll every ~500 ms (spec §3/§6) and SIGKILL on cancel.
    if (checkCancel) {
      const poll = async (): Promise<void> => {
        while (!settled) {
          await new Promise((r) => setTimeout(r, INGESTION_CONFIG.git.cancelPollMs));
          if (settled) return;
          let stop = false;
          try {
            stop = await checkCancel();
          } catch {
            stop = false; // a control-read failure must not kill the clone
          }
          if (stop && !settled) {
            try { child.kill("SIGKILL"); } catch { /* already dead */ }
            fail(new ImportCancelledError());
            return;
          }
        }
      };
      void poll();
    }
  });
}
