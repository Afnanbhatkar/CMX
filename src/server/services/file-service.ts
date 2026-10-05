import { readWorkspaceFile } from "@/lib/server/repository-fs";
import type { ApiErrorCode } from "@/server/api/envelope";

/**
 * CodeMind X V2 — file access service for the versioned API (Phase 3, §4).
 *
 * Thin adapter over src/lib/server/repository-fs.ts, which already enforces
 * the real trust boundaries (allowlisted roots, traversal/dotfile rejection,
 * binary + 512 KB size caps). This module only maps its result codes to the
 * API envelope vocabulary — the same mapping /api/repository/file performs,
 * extracted so both surfaces share ONE implementation.
 *
 * The legacy /api/repository/* routes keep their current behavior untouched.
 */

export type ApiFile = {
  path: string;
  content: string;
  language: string;
  size: number;
  truncated: boolean;
};

export type ApiFileResult =
  | { ok: true; file: ApiFile }
  | {
      ok: false;
      code: ApiErrorCode;
      status: number;
      message: string;
    };

export async function readFileForApi(input: string): Promise<ApiFileResult> {
  const result = await readWorkspaceFile(input);
  if (result.ok) {
    return { ok: true, file: result.file };
  }
  switch (result.code) {
    case "not-found":
      return {
        ok: false,
        code: "NOT_FOUND",
        status: 404,
        message: "File not found.",
      };
    case "too-large":
      return {
        ok: false,
        code: "PAYLOAD_TOO_LARGE",
        status: 413,
        message: "File exceeds the 512 KB read limit.",
      };
    case "binary":
      return {
        ok: false,
        code: "BAD_REQUEST",
        status: 415,
        message: "Binary files cannot be displayed.",
      };
    case "forbidden":
    default:
      return {
        ok: false,
        code: "FORBIDDEN",
        status: 403,
        message: "Path is outside the allowed workspace roots.",
      };
  }
}

/* ------------------------------------------------------------------ */
/* Filename search over the real tree                                  */
/* ------------------------------------------------------------------ */

export interface FileNameMatch {
  path: string;
  name: string;
  type: "file";
}

type TreeFileNode = { path: string; name: string; type: "file" | "dir"; children?: unknown };

function isTreeFileNode(node: unknown): node is TreeFileNode {
  return (
    typeof node === "object" &&
    node !== null &&
    typeof (node as TreeFileNode).path === "string" &&
    typeof (node as TreeFileNode).name === "string" &&
    ((node as TreeFileNode).type === "file" || (node as TreeFileNode).type === "dir")
  );
}

/**
 * Honest filename search over the REAL workspace tree — the same semantics the
 * workspace search panel uses today: case-insensitive substring match on the
 * path, traversal order, capped results. No ranking, no content search —
 * hybrid semantic search is [PLANNED].
 */
export function searchFileNames(
  nodes: readonly unknown[],
  query: string,
  limit: number,
): FileNameMatch[] {
  const needle = query.toLowerCase();
  const matches: FileNameMatch[] = [];

  const walk = (level: readonly unknown[]): void => {
    for (const node of level) {
      if (matches.length >= limit) return;
      if (!isTreeFileNode(node)) continue;
      if (node.type === "file") {
        if (node.path.toLowerCase().includes(needle)) {
          matches.push({ path: node.path, name: node.name, type: "file" });
        }
      }
      if (Array.isArray(node.children) && node.children.length > 0) {
        walk(node.children);
      }
    }
  };

  walk(nodes);
  return matches;
}
