"use client";

/**
 * CodeMind X V2 — file type icons (Phase 5, spec §2).
 *
 * Small extension → lucide icon + color mapping for the repository tree and
 * tab strip. Informational only. No blue/indigo per the design contract.
 */

import { memo } from "react";
import {
  Database,
  File,
  FileArchive,
  FileCog,
  FileCode,
  FileCode2,
  FileImage,
  FileJson,
  FileLock2,
  FileText,
  Folder,
  FolderOpen,
  Globe,
  Palette,
  SquareTerminal,
} from "lucide-react";

import { cn } from "@/lib/utils";

const EXTENSION_STYLES: Record<string, { Icon: typeof File; className: string }> = {
  ts: { Icon: FileCode2, className: "text-amber-600 dark:text-amber-400" },
  tsx: { Icon: FileCode2, className: "text-amber-600 dark:text-amber-400" },
  js: { Icon: FileCode, className: "text-yellow-600 dark:text-yellow-500" },
  jsx: { Icon: FileCode, className: "text-yellow-600 dark:text-yellow-500" },
  mjs: { Icon: FileCode, className: "text-yellow-600 dark:text-yellow-500" },
  cjs: { Icon: FileCode, className: "text-yellow-600 dark:text-yellow-500" },
  json: { Icon: FileJson, className: "text-amber-500" },
  md: { Icon: FileText, className: "text-foreground/80" },
  mdx: { Icon: FileText, className: "text-foreground/80" },
  txt: { Icon: FileText, className: "text-foreground/70" },
  css: { Icon: Palette, className: "text-rose-500" },
  scss: { Icon: Palette, className: "text-rose-500" },
  html: { Icon: Globe, className: "text-orange-600" },
  xml: { Icon: FileCode, className: "text-orange-500" },
  svg: { Icon: FileImage, className: "text-emerald-600" },
  png: { Icon: FileImage, className: "text-emerald-600" },
  jpg: { Icon: FileImage, className: "text-emerald-600" },
  jpeg: { Icon: FileImage, className: "text-emerald-600" },
  gif: { Icon: FileImage, className: "text-emerald-600" },
  webp: { Icon: FileImage, className: "text-emerald-600" },
  bmp: { Icon: FileImage, className: "text-emerald-600" },
  ico: { Icon: FileImage, className: "text-emerald-600" },
  yml: { Icon: FileCog, className: "text-stone-500" },
  yaml: { Icon: FileCog, className: "text-stone-500" },
  toml: { Icon: FileCog, className: "text-stone-500" },
  ini: { Icon: FileCog, className: "text-stone-500" },
  env: { Icon: FileCog, className: "text-stone-500" },
  lock: { Icon: FileLock2, className: "text-stone-500" },
  zip: { Icon: FileArchive, className: "text-stone-500" },
  gz: { Icon: FileArchive, className: "text-stone-500" },
  tar: { Icon: FileArchive, className: "text-stone-500" },
  sql: { Icon: Database, className: "text-teal-600" },
  prisma: { Icon: Database, className: "text-teal-600" },
  sh: { Icon: SquareTerminal, className: "text-green-700 dark:text-green-500" },
  bash: { Icon: SquareTerminal, className: "text-green-700 dark:text-green-500" },
  py: { Icon: FileCode2, className: "text-lime-600" },
  rb: { Icon: FileCode2, className: "text-rose-600" },
  go: { Icon: FileCode2, className: "text-cyan-600" },
  rs: { Icon: FileCode2, className: "text-orange-700" },
  pdf: { Icon: FileText, className: "text-red-600" },
};

const FILENAME_STYLES: Record<string, { Icon: typeof File; className: string }> = {
  "package.json": { Icon: FileJson, className: "text-amber-500" },
  "package-lock.json": { Icon: FileLock2, className: "text-stone-500" },
  "bun.lock": { Icon: FileLock2, className: "text-stone-500" },
  "tsconfig.json": { Icon: FileCog, className: "text-stone-500" },
  dockerfile: { Icon: FileCog, className: "text-stone-500" },
  ".gitignore": { Icon: FileCog, className: "text-stone-500" },
  ".env": { Icon: FileCog, className: "text-stone-500" },
  license: { Icon: FileText, className: "text-foreground/80" },
  readme: { Icon: FileText, className: "text-foreground/80" },
};

function lookup(name: string): { Icon: typeof File; className: string } {
  const lower = name.toLowerCase();
  const byName = FILENAME_STYLES[lower];
  if (byName) return byName;
  const idx = lower.lastIndexOf(".");
  const ext = idx === -1 ? "" : lower.slice(idx + 1);
  return EXTENSION_STYLES[ext] ?? { Icon: File, className: "text-muted-foreground" };
}

export interface FileIconProps {
  name: string;
  className?: string;
}

export const FileIcon = memo(function FileIcon({ name, className }: FileIconProps) {
  const { Icon, className: colorClass } = lookup(name);
  return <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", colorClass, className)} />;
});

export interface DirIconProps {
  open: boolean;
  className?: string;
}

export const DirIcon = memo(function DirIcon({ open, className }: DirIconProps) {
  return open ? (
    <FolderOpen aria-hidden="true" className={cn("size-3.5 shrink-0 text-primary/80", className)} />
  ) : (
    <Folder aria-hidden="true" className={cn("size-3.5 shrink-0 text-primary/80", className)} />
  );
});
