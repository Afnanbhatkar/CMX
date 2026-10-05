"use client";

/**
 * CodeMind X V2 — terminal adapter contract (V2.1 ADDITIONS §F).
 *
 * The terminal UI (xterm.js) speaks ONLY to a TerminalAdapter — the seam
 * where a real sandbox/exec backend will plug in later:
 *
 *   SandboxTerminalAdapter — the RESERVED sandbox adapter. Execution is not
 *   implemented yet; it states that honestly and never fakes a shell.
 *   (A real backend adapter implements the same three methods later.)
 *
 * Stack traces: any text that flows through the terminal can be resolved to
 * REAL workspace locations via stack-trace.ts + the EditorNavigationService
 * — that part works today against real files.
 */

export type TerminalAdapterStatus = "available" | "unavailable";

export interface TerminalAdapter {
  readonly id: string;
  readonly label: string;
  readonly status: TerminalAdapterStatus;
  /** Honest one-liner describing what this adapter can do today. */
  readonly note: string;
  /** Begin the session; write output through `write`. */
  start(handlers: {
    write: (data: string) => void;
    onStatus?: (status: TerminalAdapterStatus) => void;
  }): void;
  /** User input (a line, or a raw key sequence when `raw` is true). */
  send(data: string, raw?: boolean): void;
  resize(cols: number, rows: number): void;
  dispose(): void;
}

const SANDBOX_BANNER = [
  "\x1b[1mCodeMind X — terminal foundation\x1b[0m",
  "",
  "The sandbox adapter contract is wired (V2.1 ADDITIONS §F), but the",
  "sandbox shell/exec backend arrives in a later phase — no simulated",
  "shell is shown here.",
  "",
  "What works TODAY: paste a stack trace below the terminal and resolve",
  "its file references to real workspace locations via the",
  "EditorNavigationService.",
  "",
].join("\r\n");

/**
 * The reserved sandbox adapter: starts, prints the honest banner, and
 * echoes nothing else. It never pretends to execute commands.
 */
export class SandboxTerminalAdapter implements TerminalAdapter {
  readonly id = "sandbox";
  readonly label = "sandbox";
  readonly status: TerminalAdapterStatus = "unavailable";
  readonly note =
    "Sandbox shell/exec backend arrives in a later phase — the adapter contract is reserved and nothing is simulated.";

  private handlers: { write: (data: string) => void } | null = null;
  private history: string[] = [];

  start(handlers: { write: (data: string) => void }): void {
    this.handlers = handlers;
    this.handlers.write(SANDBOX_BANNER);
  }

  send(data: string, raw?: boolean): void {
    void raw;
    // Real command execution does not exist yet — keep an honest in-memory
    // history so the future backend adapter can replay context, and print a
    // truthful response instead of a fake prompt.
    const line = data.trim();
    if (line) this.history.push(line);
    this.handlers?.write(
      `\r\n\x1b[2msandbox: command execution arrives in a later phase (adapter contract reserved).\x1b[0m\r\n\r\n`,
    );
  }

  /** Session-local command history (honest, memory only). */
  getHistory(): string[] {
    return [...this.history];
  }

  resize(cols: number, rows: number): void {
    void cols;
    void rows;
  }

  dispose(): void {
    this.handlers = null;
  }
}
