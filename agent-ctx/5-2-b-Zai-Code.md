# Task 5-2-b — Phase 5 Task 2-b: repository explorer API surface

Agent: Z.ai Code (Phase 5 backend agent 2-b)
Status: COMPLETED (live-verified end-to-end)
Scope touched: src/app/api/repository/{tree,file}/route.ts (modified),
src/app/api/repository/{status,file-history}/route.ts (new),
src/lib/server/repository-fs.ts (additive only).
No git commit, no dev-server restart, no test files. No files outside scope touched.

## Exact API contract (what the UI agents can rely on)

### GET /api/repository/tree
- No `path` (or blank) → legacy behavior byte-compatible: 200 `{ ok: true, tree: RepoTreeNode[] }`.
- `?path=<dir>` (≤512 chars, zod) → 200 `{ ok: true, tree: <children of that dir> }` — use for lazy loading.
  - zod fail (>512) → 400 `{ok:false,error:"Invalid 'path' query parameter."}`
  - outside allowlist/traversal → 403 `"Repository path unavailable (forbidden)."`
  - allowlisted but not an existing directory (incl. regular files) → 404 `"Repository path unavailable (not-found)."`
- File nodes now carry `language: string` everywhere (whole tree + subtrees + root files).
- Dir nodes carry `truncated: true` when their children were cut by the entry/depth caps → fetch
  `/api/repository/tree?path=<that dir>` to lazy-load. Note: the current project is far below the
  2000-entry cap, so no live `truncated` instance exists yet (code-level verified).
- Subtree responses are cached 30s per path; the whole-tree rebuild clears the subtree map.

### GET /api/repository/status (NEW)
- 200 `{ ok: true, status: Record<repoRelPath, TreeGitStatus>, branch: string|null, headSha: string|null }`
- git failure → 503 `{ ok: false, error: <sanitized single-line reason> }` (never an empty map as success).
- Feed `status` directly into `applyGitStatus(map)` (5-2-c store action); keys are repo-relative POSIX paths.

### GET /api/repository/file?path=…&variant=full|meta|preview|download
- `variant=full` (default / omitted — all existing consumers unaffected): 200
  `{ ok: true, file: { path, content, language, size, truncated }, meta?: FileProvenanceMeta }`.
  `meta` is ADDITIVE (top-level sibling of `file`) and OMITTED when provenance fails — check before use.
  Error paths unchanged: 400 missing path · 403 forbidden · 404 not-found · 413 too-large · 415 binary,
  all `{ ok:false, error:"File unavailable (<code>)." }`.
- `variant=meta`: 200 `{ ok: true, meta: FileProvenanceMeta }` for ANY allowlisted file including binaries
  (no content read). Failures → 403/404 legacy envelope. Note: `FileProvenanceMeta.classification` is NOT in
  this payload (5-2-a service has no DB join; if the intelligence panel needs classification it must come from
  repository_files via a later endpoint — honest gap, not fabricated here).
- `variant=preview`: image exts only (png jpg jpeg gif webp bmp ico svg), ≤2MB →
  200 `{ ok: true, preview: { kind: "image", mimeType, dataUrl } }` (dataUrl = `data:<mime>;base64,…`).
  415 `"Use the standard file view for text files"` for known-text exts; 415
  `"Preview unavailable for this file type"` for other binaries; 413 legacy envelope when >2MB.
  Render ONLY via `<img src={dataUrl}>` (safe for SVG — no inline HTML injection).
- `variant=download`: any allowlisted file ≤10MB → 200 raw bytes, `Content-Type` = provenance mimeType
  (unknown → `application/octet-stream`), `Content-Disposition: attachment; filename="<basename>"`.
  Oversized → 413 legacy envelope. NOT a JSON response — fetch as blob.
- Unknown `variant` → 400 `"Invalid 'variant' query parameter."`.

### GET /api/repository/file-history?path=…&limit=1..20 (NEW)
- 200 `{ ok: true, commits: FileHistoryCommit[] }` (`sha/author/date/message`, real `git log --follow`).
- limit: zod coerced int 1..20, default 10 → 400 `"Invalid 'limit' query parameter (expected 1..20)."` on violation.
- Failures: 403 (forbidden) / 404 (resolve fail, traversal) / 503 (git unavailable, carries the sanitized
  service message) — legacy envelope style.

## Audit wiring (for cross-checking)
Fire-and-forget `repository.access` rows, success-only, metadata path/scope only (never content):
`{scope:"tree"}` · `{scope:"tree-subtree",path}` · `{scope:"status",entries:<count>}` (paths NEVER recorded) ·
`{path}` (full read, unchanged) · `{path,scope:"meta"}` · `{path,scope:"preview"}` · `{path,scope:"download"}` ·
`{path,scope:"file-history"}`. Verified live in audit_logs.

## Honest deviation (read before relying on it)
The task's probe expected 200 for `public/logo.svg` download/preview. `public/` is deliberately NOT in
repository-fs ALLOWED_ROOTS (Phase 2 trust boundary: source tree + key configs only), so those probes return
the 403 legacy envelope — correct security behavior. Expanding the allowlist was outside my additive-only
mandate. If the explorer must preview public assets, a later task should add `public` to ALLOWED_ROOTS
(consciously, with whole-tree consumers in mind). Download/preview were verified live with transient
allowlisted probe files (svg → 200 image/svg+xml + dataUrl/disposition verified; .bin → 415/octet-stream).

## Verification summary
- bun run lint exit 0; bunx tsc --noEmit: 0 errors under src/ (only pre-existing examples/websocket errors).
- Probe matrix: tree subtree / status (21 real entries, branch main, headSha d8dbbdfc…) / file+meta /
  variant=meta / page.tsx regression 200 / file-history 3 real commits / preview+download svg 200 /
  preview json 415 text-message / preview .bin 415 / download .bin 200 octet-stream / bogus variant 400 /
  path>512 400 / limit=25 400 / traversal 403 / missing 404 — all green (details in worklog.md).
- dev.log clean; legacy consumers (tab loader polls URL-encoded file reads) unaffected, 200s.
- Code-reviewed only (no live instance in sandbox): status 503 path, 413 oversized branches (2MB/10MB),
  10MB download cap, `truncated:true` (project ≪ entry cap).
