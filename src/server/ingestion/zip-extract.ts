import fs from "node:fs/promises";
import path from "node:path";

import { unzipSync, UnzipFileInfo } from "fflate";

import { INGESTION_CONFIG } from "./config";
import { IngestionError } from "./errors";

/**
 * CodeMind X V2 — hardened ZIP extraction (Phase 4, spec §6).
 *
 * Pure-JS fflate (no native unzip, no shell). Guards, ALL enforced:
 * - archive magic checked before any work;
 * - max 50,000 entries;
 * - max 512 MB TOTAL uncompressed;
 * - max 25 MB per entry — enforced in the fflate `filter`, i.e. BEFORE that
 *   entry is inflated (the filter sees central-directory sizes first);
 * - compression-ratio suspicion: > 200x on any entry → archive rejected
 *   (classic zip-bomb shape);
 * - entry-name validation: absolute paths, drive letters, ".." segments, NUL
 *   and control characters rejected — Windows backslashes are normalized and
 *   then re-checked (spec §6);
 * - symlinks CANNOT materialize: fflate never preserves unix modes, so a
 *   symlink entry degrades to a regular file — nothing is ever linked
 *   outside the workspace;
 * - every write is path-joined through a resolved-prefix containment check;
 * - per-workspace disk quota enforced on the running written-bytes total.
 */

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export interface ZipExtractResult {
  filesWritten: number;
  bytesWritten: number;
  /** Entries refused by the guards (size/ratio/name) — archive fails when > 0 for hard rejects. */
  rejectedEntries: number;
}

function isUnsafeEntryName(name: string): boolean {
  if (!name || name.length === 0) return true;
  if (/[\u0000-\u001f\u007f]/.test(name)) return true;
  if (name.includes("\0")) return true;
  const normalized = name.replace(/\\/g, "/").trim();
  if (normalized.startsWith("/")) return true; // absolute
  if (/^[a-zA-Z]:/.test(normalized)) return true; // drive letter
  const segments = normalized.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) return true;
  if (segments.some((s) => s === "." || s === "..")) return true; // traversal
  return false;
}

function safeJoin(destDir: string, entryName: string): string {
  const normalized = entryName.replace(/\\/g, "/");
  const target = path.resolve(destDir, normalized);
  const prefix = path.resolve(destDir) + path.sep;
  if (target !== path.resolve(destDir) && !target.startsWith(prefix)) {
    throw new IngestionError("INVALID_ARCHIVE", "archive entry escapes the workspace (traversal).");
  }
  return target;
}

export async function extractZipArchive(
  zipBytes: Buffer,
  destDir: string,
  opts: { quotaBytes: number },
): Promise<ZipExtractResult> {
  if (zipBytes.length < 4 || !zipBytes.subarray(0, 4).equals(ZIP_MAGIC)) {
    throw new IngestionError("INVALID_ARCHIVE", "uploaded file is not a ZIP archive.");
  }

  const cfg = INGESTION_CONFIG.zip;
  let seenEntries = 0;
  let totalUncompressed = 0;
  let rejectedEntries = 0;
  let hardReject: string | null = null;

  const accepted = unzipSync(new Uint8Array(zipBytes), {
    filter: (file: UnzipFileInfo): boolean => {
      seenEntries += 1;
      if (seenEntries > cfg.maxEntries) {
        hardReject = `archive exceeds the ${cfg.maxEntries}-entry limit.`;
        return false;
      }
      if (isUnsafeEntryName(file.name)) {
        rejectedEntries += 1;
        hardReject = "archive contains an entry with an unsafe path.";
        return false;
      }
      if (file.originalSize > cfg.maxEntryUncompressedBytes) {
        rejectedEntries += 1;
        hardReject = `archive entry exceeds the ${Math.round(cfg.maxEntryUncompressedBytes / (1024 * 1024))} MB per-entry limit.`;
        return false;
      }
      if (file.size > 0 && file.originalSize / file.size > cfg.maxCompressionRatio) {
        rejectedEntries += 1;
        hardReject = "archive entry shows a suspicious compression ratio (>200x).";
        return false;
      }
      totalUncompressed += file.originalSize;
      if (totalUncompressed > cfg.maxTotalUncompressedBytes) {
        hardReject = "archive exceeds the total uncompressed size limit.";
        return false;
      }
      return true;
    },
  });

  if (hardReject) {
    throw new IngestionError("INVALID_ARCHIVE", hardReject);
  }
  if (seenEntries === 0 || accepted === undefined) {
    throw new IngestionError("INVALID_ARCHIVE", "archive has no readable entries.");
  }
  const names = Object.keys(accepted);
  if (names.length === 0) {
    throw new IngestionError("INVALID_ARCHIVE", "archive has no readable entries.");
  }

  await fs.mkdir(destDir, { recursive: true });
  let filesWritten = 0;
  let bytesWritten = 0;

  for (const name of names) {
    if (isUnsafeEntryName(name)) continue; // belt-and-braces (filter already gated)
    const target = safeJoin(destDir, name);
    const data = accepted[name];

    if (bytesWritten + data.length > opts.quotaBytes) {
      throw new IngestionError(
        "DISK_QUOTA_EXCEEDED",
        `disk quota exceeded while extracting the archive (limit ${Math.round(opts.quotaBytes / (1024 * 1024))} MB).`,
      );
    }

    await fs.mkdir(path.dirname(target), { recursive: true });
    // Directory entries (zero-length, trailing slash) become dirs implicitly.
    if (!name.endsWith("/")) {
      await fs.writeFile(target, Buffer.from(data));
      filesWritten += 1;
      bytesWritten += data.length;
    }
  }

  return { filesWritten, bytesWritten, rejectedEntries };
}
