---
name: mythos-remember
description: Capture explicitly approved memory in portable, local-only private state without allowing personal context into repository, build, or export surfaces.
---

# Mythos Remember

Use this skill only when the operator explicitly asks to retain a memory.

1. Put the proposed memory in a temporary input file outside the repository.
2. Run `node tools/memory/portable-remember.cjs <file> --dry-run`.
3. Show the destination metadata, never the memory content.
4. Ask for explicit approval to create local private state.
5. Only after approval, rerun with `--ack-local-private-state`.

The writer refuses destinations inside the Mythos root, defaults to dry-run, uses
private file permissions, and has no password-manager, account, client, or remote
storage integration. A missing local binding is `not_applicable`; it is never a
reason to fall back to a repository write.
