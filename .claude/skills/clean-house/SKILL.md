---
name: clean-house
description: >
  Repo hygiene system: groups uncommitted changes by workstream, proposes scoped commits,
  removes stale artifacts, and enforces clean working tree state.
version: 1.0.0
execution_mode: PATCH_ALLOWED
trust_tier: report_write_scoped
---

<skill>
<objective>
Maintain a trustworthy repo state by preventing uncommitted drift from accumulating across sessions.
This skill operates in three modes: manual command, iMessage trigger, and automatic post-slice hook.
</objective>

<activation>
- Operator types /clean-house at the terminal
- Operator texts "clean house" via iMessage
- Automatically after a task plan slice completes (post-slice hook)
- Session start when git status shows significant drift
</activation>

<process>
<step name="inventory" type="AUTO">
Run git status. Parse all dirty files into a structured list with path, change type (M/A/D/?), and inferred workstream.
</step>

<step name="custody-scope" type="AUTO">
Before proposing any commit, resolve the invoking session's custody set — the union of:
(a) write-ledger at _dev/state/active-sessions/&lt;session_id&gt;/write_log.json
(b) owned_artifacts listed in the active plan's scope_identity

Partition dirty files into three buckets:
- OWN: path appears in the custody set → eligible for commit proposal
- FOREIGN: dirty but not in custody set, clearly owned by another workstream/session → surface as out_of_custody_dirty, NEVER propose for commit
- UNKNOWN: no custody record → surface to operator with a note that custody is unconfirmed

Per orchestrate-loop invariant: "global dirty worktree state is context, not ownership." The git-custody gate (tools/hooks/pretool-git-custody-gate.cjs) is the mechanical backstop at commit time; this step is the proposer-side guard.

If no session_id is resolvable: skip custody scoping, note the gap, and surface ALL dirty files to the operator as UNKNOWN — do not auto-propose any group.
</step>

<step name="group" type="AUTO">
Group OWN (and operator-confirmed UNKNOWN) files by workstream using path-prefix rules:
- clients/{CODE}/ → per-client group
- .claude/ → Mythos infrastructure group
- frameworks/{service}/{name}/ → per-framework group
- _dev/ → development artifacts group
- instructions/ → instruction group
- tools/ → tooling group
- Other → ungrouped (requires operator review)
</step>

<step name="summarize" type="AUTO">
For each group, read the diffs and produce:
- One-line summary of what changed
- Proposed commit message
- Risk flag if the group contains deletions or config changes
</step>

<step name="staleness-check" type="AUTO">
Scan for contradictions between artifacts:
- Matrix/plan files that reference states contradicted by live evidence
- Signals marked as consumed or superseded
- Reports referencing completed work that has since changed
Flag stale artifacts for operator review.
</step>

<step name="propose" type="USER">
Present the commit plan to the operator. Format depends on channel:
- Terminal: full table with groups, file counts, proposed messages, followed by a separate out_of_custody_dirty section listing FOREIGN files (context only — not in the commit plan)
- iMessage: concise numbered list, one line per group, reply "yes" to approve all or specify group numbers to defer; append "out-of-custody: N file(s) not proposed" if FOREIGN files exist

Wait for operator approval before proceeding.
</step>

<step name="execute" type="AUTO">
After approval:
1. Stage files per group using explicit file paths (never git add -A)
2. Commit each group with the approved message
3. Verify no credentials or sensitive files are staged
4. Run git status to confirm clean state
5. Report final state to operator

For session handoff, closeout, debrief, lifecycle, or other cross-session
provenance commits, include a commit-body trailer:
`Host: <hostname -s>`.
</step>
</process>

<execution_rules>
<rule id="custody-scope">[PROTOCOL] — Scope commit proposals to the invoking session's custody set (write-ledger ∪ owned_artifacts); expose files outside that set as out_of_custody_dirty, never propose them for commit</rule>
<rule id="no-bulk-add">[PROTOCOL] — Never use git add -A or git add . — always add specific files by name</rule>
<rule id="no-push">[PROTOCOL] — Never push to remote unless operator explicitly requests it</rule>
<rule id="no-content-change">[PROTOCOL] — Never modify file contents during hygiene — only stage, commit, delete</rule>
<rule id="credential-guard">[PROTOCOL] — Never stage .env, credentials, or files containing secrets</rule>
<rule id="scoped-commits">[PROTOCOL] — One commit per workstream group, never cross-workstream bundles</rule>
</execution_rules>

<inputs>
<required>
None — operates on current git state
</required>
<optional>
<input name="--auto">Skip operator approval for post-slice mode (only commits the current slice's files)</input>
<input name="--dry-run">Show proposed plan without executing</input>
</optional>
</inputs>

<outputs>
<output name="commit-plan">Proposed grouping and commit messages shown to operator</output>
<output name="clean-state">Git status output showing clean working tree</output>
</outputs>

<success_criteria>
- Working tree is clean after execution (or only operator-deferred files remain)
- Each commit is scoped to exactly one workstream
- No stale artifacts remain without explicit deferral
- No sensitive files committed
</success_criteria>

<boundaries>
- Does NOT review code quality
- Does NOT modify file contents
- Does NOT push to remote
- Does NOT operate outside current branch
- Does NOT make judgment calls about file content — only groups and commits
</boundaries>
</skill>
