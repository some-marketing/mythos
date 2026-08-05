---
name: gemini-bridge-cannot-read-gitignored-paths
description: "Gemini CLI read_file honors gitignore, so reviews of clients/ artifacts silently fabricate — stage copies under _dev/ first"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 60714b4c-3c74-40c3-9d87-1cce98e0b893
  modified: 2026-07-30T16:49:20.930Z
---

The Gemini CLI's `read_file` refuses any path matched by gitignore-derived ignore patterns — and
`clients/` is blanket-gitignored in Mythos. A bridge-dispatched Gemini review of `clients/` artifacts
exits 0 and produces a confident, detailed verdict anyway, reconstructed from the dispatch prompt text
(proven 2026-07-30: r1 "APPROVE-CONTRACTS" on the SDAS A0 contracts pack was a false PASS with a
fabricated detail; read failures were only visible in the run report's stderr).

**Why:** exit code and verdict text are not grounding evidence; the reviewer will not volunteer that
it couldn't read its subject.

**How to apply:** before any freeform bridge review of gitignored artifacts, byte-stage copies into a
non-ignored path (e.g. `_dev/reports/analysis/<scope>-review-pack/`) and point the prompt there; order
the reviewer to answer CANNOT-REVIEW on any read failure instead of reconstructing; and always check
the run report's Stderr section for `Error executing tool read_file` before accepting a verdict.
Related: [[never-checkout-a-file-you-didnt-verify-clean]].
