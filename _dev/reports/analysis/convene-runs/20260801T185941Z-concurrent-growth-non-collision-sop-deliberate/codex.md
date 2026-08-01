# NOW / codex response

- slot_id: now
- actor: codex
- pinned_model: none
- status: success
- duration_ms: 70393
- exit_code: 0
- error: none

---

## NOW verdict

The audit-and-name framing is necessary but insufficient. At least one new mechanism is required: **pre-write artifact custody/reservation**. Current machinery mostly detects ownership after mutation or protects commit-time staging.

Observed repo truth:

- Active-session liveness is TTL-derived, not authoritative presence. `listActive()` accepts markers whose heartbeat remains within policy and silently excludes malformed entries ([active-session-registry.js](/Users/admin/mythos/sessions/lib/active-session-registry.js:599)).
- Write custody is recorded post-write ([posttool-write-ledger.cjs](/Users/admin/mythos/tools/kernel/hooks/posttool-write-ledger.cjs:4)). Two sessions can therefore write the same file before either ledger prevents anything.
- The custody gate intercepts `git add` and `git commit`, not ordinary artifact writes ([pretool-git-custody-gate.cjs](/Users/admin/mythos/tools/kernel/hooks/pretool-git-custody-gate.cjs:3)). It hard-blocks positively foreign paths but passes unknown custody by default ([pretool-git-custody-gate.cjs](/Users/admin/mythos/tools/kernel/hooks/pretool-git-custody-gate.cjs:8)).
- Boundary markers solve different-scope clobbering, but `writeMarker()` unconditionally renames onto the same normalized scope path. Concurrent writers for one scope still overwrite each other ([boundary-markers.cjs](/Users/admin/mythos/sessions/lib/boundary-markers.cjs:62)).
- Plan hashing binds review authority to exact bytes; its declared authority is only `run_authorization_only` ([plan-run-gate.js](/Users/admin/mythos/tools/planning/lib/plan-run-gate.js:92)). It is a useful design precedent, not an existing general collision mechanism.
- “Producer never validates its own trial” is epistemic separation, not concurrent-write control ([doctrine.md](/Users/admin/mythos/instructions/canonical/kernel/doctrine.md:32)). Calling it write-collision machinery collapses two distinct invariants.

Sharpen the questions:

1. **Which operations require filesystem isolation?** Dirty-file count is the wrong trigger. Require a worktree for branch/index mutation, broad generators, unresolved custody, or overlapping intended write sets. A shared directory is safe only for read-only work or writes to unique/atomically claimed paths. A branch alone does not isolate a shared working directory.

2. **What is authoritative for liveness versus custody?** `_dev/state/active-sessions/` can remain the liveness registry, with explicit “unknown/stale” semantics. It cannot also be the ownership authority. Introduce an expiring, exclusive claim keyed by session/run and exact artifact paths or prefixes.

3. **What happens before every write?** Declare target set; detect overlapping live claims; acquire an exclusive reservation; write atomically; record resulting hash; release or transfer custody. The post-write ledger remains evidence. Slug suffixing is naming policy, not collision safety. `concept-init` currently promises no overwrite without confirmation but specifies no atomic claim ([concept-init.yaml](/Users/admin/mythos/instructions/canonical/commands/concept-init.yaml:17)).

4. **What is the response matrix?** Proven prospective overlap: hard block absent an explicit custody grant. Unknown custody: warn for read-only/unique creation, fail closed for mutation of an existing artifact. Detected actual collision: stop, preserve both byte versions and hashes, mark `needs_context`, and require operator-selected reconciliation. Never silently merge.

5. **Where does authority live?** Put the invariant in doctrine; put the followable decision table in canonical instructions; put enforcement in a shared pre-write helper/hook used by every growth-producing command. Documentation or memory alone is non-authoritative. Add `safety.yaml` only if the team intends this to be immutable.

The SOP-drafting process has its own collision risk: parallel synthesis can target this concept, generated command surfaces, and canonical instructions simultaneously. Reserve those exact paths and draft on a feature-branch worktree. Also preserve independent review: the SOP producer must not certify the SOP’s adequacy. The current concept’s “no code touched” scope must be revised if the audit confirms the missing pre-write reservation layer.

