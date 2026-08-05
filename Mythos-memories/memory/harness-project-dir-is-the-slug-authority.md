---
name: harness-project-dir-is-the-slug-authority
description: Never hardcode ~/.claude/projects slugs — tools/lib/harness-project-dir.cjs is the resolver; hardcoded slugs killed memory ingestion for weeks
metadata: 
  node_type: memory
  type: reference
  originSessionId: b07a6739-e94e-44d9-89e4-a715c3deecea
  modified: 2026-07-30T21:43:37.890Z
---

`tools/lib/harness-project-dir.cjs` (module + `--memory` CLI) is the single authority for resolving this repo's Claude harness project directory (`~/.claude/projects/-Users-admin-mythos`). The real Claude Code slug rule, read from the shipped binary: `path.replace(/[^a-zA-Z0-9]/g,'-')`, truncated + hash-suffixed past 200 chars (the resolver throws there rather than guess).

**Why:** the SM_OS→Mythos port string-substituted slugs instead of resolving them, producing `-Users-admin-dev-mythos-recovered` (never existed) in three live consumers — the dream DB ingested 1 memory instead of 10, the vault memory-sync never once succeeded, and the session-start behavioral contract read an empty dir, all silently. Fixed 2026-07-30 (plan [[mythos-memory-vault-rewire]], 8 consumers rewired, 51/51 tests).

**How to apply:** any new tool needing the harness dir imports/invokes the resolver; env overrides (SMOS_MEMORY_DIR, MYTHOS_MEMORY_DIR, SMOS_MEMORY_OVERRIDE_DIR) still win. Subprocess regression tests live in `tools/lib/__tests__/consumer-override-precedence.test.js`.
