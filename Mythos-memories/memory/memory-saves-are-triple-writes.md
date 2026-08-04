---
name: memory-saves-are-triple-writes
description: "Whenever a memory is saved to the harness directory, also run /remember (sm-os-remember) so it lands in the repo mirror and the Mythos Memories vault"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2a3e83da-becd-4845-b2de-1be1dca94142
  modified: 2026-08-04T19:56:24.200Z
---

Operator instruction 2026-08-04: saving a memory to the harness plaintext directory
alone is not a completed save. Every memory save must also go through `/remember`
(the sm-os-remember skill), which triple-writes: harness plaintext + git-tracked repo
mirror (`Mythos-memories/memory/`) + the 1Password vault "Mythos Memories" via the
on-device script `tools/memory/remember-via-vault.sh`.

**Why:** The harness directory is machine-local; the repo mirror makes memories ship
with a clone, and the vault is the durable AI-private copy. A harness-only write
silently strands the memory on one surface.

**How to apply:** After writing any memory file + MEMORY.md index line, immediately run
`bash tools/memory/sync-repo-mirror.sh <harness-file>` and
`bash tools/memory/remember-via-vault.sh <harness-file>`, and report all three
results. The vault script accepts the nested `metadata.type` frontmatter the harness
uses. See [[memory-system-active-persistence-ratified]].
