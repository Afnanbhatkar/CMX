/**
 * CodeMind X V2 — Agent Mode V2 post-apply validation (spec §39/§65/§135).
 *
 * Validation after a mutation must be REAL: a check that did not run is
 * reported as skipped — never as passed. The validators here are bounded
 * and side-effect-free:
 *
 * - Python  → the AST is parsed in-process via a `python3 -c` child (no
 *             imports, no bytecode, no __pycache__ writes); when python3 is
 *             unavailable the check reports "validator unavailable";
 * - JSON    → parsed in-process;
 * - TS/TSX/JS/JSX/CSS/MD → NO safe syntax gate exists that is both fast and
 *             honest at the whole-file level, so the check is reported as
 *             skipped ("no safe validator configured") — never "passed".
 */

import { spawn } from "node:child_process";

export interface ValidationCheck {
  /** Short check name for the chain + result card. */
  name: string;
  path: string;
  status: "passed" | "failed" | "skipped";
  detail: string | null;
}

const PY_TIMEOUT_MS = 10_000;

/** Parse a Python file's AST (no execution, no writes). */
function pythonAstCheck(absolutePath: string): Promise<ValidationCheck> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (check: ValidationCheck): void => {
      if (!settled) {
        settled = true;
        resolve(check);
      }
    };
    try {
      const child = spawn(
        "python3",
        ["-c", "import ast,sys; ast.parse(open(sys.argv[1],encoding='utf-8').read())", absolutePath],
        { timeout: PY_TIMEOUT_MS },
      );
      let stderr = "";
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", () => {
        done({
          name: "Python syntax check",
          path: absolutePath,
          status: "skipped",
          detail: "validator unavailable (python3 not found)",
        });
      });
      child.on("close", (code) => {
        if (code === 0) {
          done({ name: "Python syntax check", path: absolutePath, status: "passed", detail: null });
        } else {
          const firstError = stderr
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .pop();
          done({
            name: "Python syntax check",
            path: absolutePath,
            status: "failed",
            detail: (firstError ?? `python exited with code ${code ?? "signal"}`).slice(0, 240),
          });
        }
      });
    } catch {
      done({
        name: "Python syntax check",
        path: absolutePath,
        status: "skipped",
        detail: "validator unavailable",
      });
    }
  });
}

/** Pick the honest validator for one path (null → skipped). */
export async function validateFile(
  relativePath: string,
  absolutePath: string,
): Promise<ValidationCheck> {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith(".py")) {
    return pythonAstCheck(absolutePath);
  }
  if (lower.endsWith(".json")) {
    try {
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(absolutePath, "utf8");
      JSON.parse(raw);
      return { name: "JSON parse check", path: relativePath, status: "passed", detail: null };
    } catch (error) {
      return {
        name: "JSON parse check",
        path: relativePath,
        status: "failed",
        detail: error instanceof Error ? error.message.slice(0, 240) : "invalid JSON",
      };
    }
  }
  return {
    name: "Syntax check",
    path: relativePath,
    status: "skipped",
    detail: "no safe validator configured for this file type",
  };
}
