---
name: operator-commands-must-be-fully-resolved
description: Never hand the operator a copy-paste command containing placeholders; resolve every value first or ask one targeted question
metadata: 
  node_type: memory
  type: feedback
  originSessionId: d72840fe-34e9-4f86-bb2c-8acc313d528a
  modified: 2026-07-31T15:51:45.774Z
---

2026-07-31: Operator called the G2 ConveneReceipt mint flow "cumbersome" — it took four round-trips. Root causes: (1) I gave a copy-paste command with `<your 1Password approval item>` still in it and the operator pasted it literally (no designated item existed; none was documented anywhere in the repo); (2) `op` cannot authenticate in the agent Bash context, so each retry cost a terminal trip.

**Why:** Placeholder tokens in operator-run commands guarantee at least one failed round-trip, and operator terminal trips are the most expensive step in any gated flow — each one must land on the first try.

**How to apply:** Before handing the operator any command: resolve every argument to a real value (search the repo/tooling for what qualifies — for convene-unlock, `--item` is proof-of-presence and any 1Password item works). If a value genuinely can't be known, ask for it explicitly BEFORE composing the command, or give setup + use as one block. The standing approval item is **"Mythos Convene Approval"** (Secure Note, created 2026-07-31) — use it for all future `tools/verify/convene-unlock.cjs` mints. Related: [[custody-grants-burn-on-classifier-denial]], [[memory-vault-rewire-state-and-operator-gates]].
