---
name: custody-grants-burn-on-classifier-denial
description: FIXED 2026-07-30 — grants are now reserved transactionally, not burned; denied commands release them; the grant → git flow is safe again
metadata: 
  node_type: memory
  type: project
  originSessionId: 21036d30-763d-41c3-9072-a07a093e0dd5
  modified: 2026-07-31T13:16:09.477Z
---

HISTORICAL: the git-custody gate consumed one-use grants at hook time while the auto-mode classifier ran
after — a denial burned all grants with nothing committed (observed 2026-07-30 12:28Z: 15 grants burned).

FIXED and live-verified 2026-07-30 15:56Z (session 2e7b1edd): the transactional-consumption plan
(`custody-grant-transactional-consumption` v2.1) shipped. `smos-custody-grant` output now states grants are
"RESERVED at the gate and consumed only once the command actually runs. A denied command releases its
grants instead of burning them; an abandoned reservation is quarantined for operator release." Verified in
practice: 3 grants issued, `git add -f … && git commit …` consumed them exactly once and committed cleanly.

CAVEAT observed 2026-07-31 (session 446d022c): grants DO still burn when the gate allows the command but
git itself fails afterward — a bad pathspec in `git add` settled all 5 grants as consumed via
PostToolUseFailure with nothing staged. Also: `git add` and `git commit` are separate commands, so a
grant-gated commit needs TWO grant sets (one per command). Practical flow: verify every pathspec exists
first, then grant → add, then grant → commit.

**Why:** the old workaround (operator `!` commands to skip the grant dance) is no longer necessary; keep
the never-allowlist-the-release-entry-point rule (convene finding).

**How to apply:** `node tools/custody/smos-custody-grant.js <paths> --to-session <id> --reason "..."`, then
run the git command normally in one Bash call. Still-open gate deficiencies that cause false foreign-blocks
(surfaced 2026-07-30): closed sessions never release write-ledger custody, and managed-runtime (Bash/node)
writes aren't ledgered to the acting session. Grants are the sanctioned resolution for both. Related:
[[git-permissions-not-allowlisted]], [[never-checkout-a-file-you-didnt-verify-clean]].
