# Oversight — the approval-gate architecture (scaffold)

This directory is a **scaffold port**, not a working port. The source
directory implements a six-module oversight subsystem for a multi-agent
harness; this export ships a README describing the architecture plus one
small working stub demonstrating the core gate-check idea. The other five
source modules are described below (what they did) but are not ported as
code.

## The core idea: approval as a state machine over a plan

A bounded worker (an agent, or a human doing bounded work under the same
process) produces artifacts and wants to claim its work is done. Before
that claim can advance to "this may now execute" or "this is now closed",
it passes through an **approval gate**: a small state machine keyed to one
plan/task, with states `pending -> accepted | rejected_for_fix ->
escalated`.

- A gate is created for a plan and inherits that plan's declared
  **expected outcomes** and **required gates** (criteria strings pulled
  from the plan's canonical schema).
- A worker **submits** artifacts against the gate. The gate checks each
  expected outcome and required gate against the submitted evidence
  (substring/keyword matching in the reference implementation — deliberately
  simple and auditable, not an LLM judgment call).
- If everything checks out, the gate transitions to `accepted`. If
  something is missing, it transitions to `rejected_for_fix` and emits a
  structured list of what's missing (`missing_outcome` / `missing_gate`
  entries with a concrete corrective action string). A second failed
  submission escalates rather than looping forever.
- Separately, the gate can check **delegation authority**: whether the
  actor attempting to close the gate is allowed to (a bounded worker may be
  forbidden from self-closing an acceptance-grade outcome; the completing
  actor must be distinct from the worker for those events; the delegation
  contract backing the gate must still be `active`).

The risk-tiering half of this (whether a gate is required at all, and how
strict it is) is driven by a field the plan itself declares — see
`approval-gate-stub.js` below for the minimal version of that check, and
`tools/commands/handlers/review-task-plan.cjs` in this export target
(read-only reference, already shipped) for how a real task-plan resolver
surfaces `risk_tier` / `review_lane` from a plan's JSON.

## What's shipped: `approval-gate-stub.js`

A minimal, fully working, self-contained demonstration of just the
gate-check half of the pattern:

- `requiresApproval(plan)` — given an object with an optional `risk_tier`
  and/or `review_lane` field, applies a simple threshold: `high` /
  `critical` risk tiers require approval; `low` / `medium` do not; a
  missing or unrecognized risk tier fails closed (requires approval,
  because undeclared risk is not the same as low risk).
- `recordApproval(planId, approvedBy, note)` — appends an approval record
  (`{ plan_id, approved_by, note, approved_at }`) to a local
  `approvals.json` log, using an atomic write-then-rename so a crash
  mid-write can't corrupt the log.

No submission/evidence-matching, no transition log, no delegation-authority
check, and no plan-file resolution are included — those are the parts left
for you to build against your own plan schema and harness, following the
pattern described above.

## What's described but not ported

These five modules stay private to the source repo. Each is summarized so
the architecture is legible even without the code:

- **`playbook-runner.js`** — a corrective-playbook registry. Each entry
  declares a machine-readable trigger (e.g. "worker is exploring beyond
  the bounded plan scope", "worker claims completion but a required
  actor-bridge is still pending"), a `detect(context)` predicate, and one
  deterministic corrective response (halt-and-refocus, escalate, etc).
  The pattern — one trigger maps to exactly one response, no judgment call
  at dispatch time — is generically reusable; the specific triggers are
  tuned to this harness's own execution-context shape.
- **`execution-monitor.js`** — watches a running worker's pacing and
  reassessment count against a plan (via the private plan resolver) and
  flags drift (too many reassessments, falling behind an expected step
  cadence) before it becomes a wasted run.
- **`ownership-validator.js`** — checks overlap between two workers'
  claimed file/path ownership sets and archives ownership declarations
  under a private `_dev/oversight/ownership` directory, to catch two
  workers claiming write authority over the same paths.
- **`status-renderer.js`** — pure formatting: takes a status-report object
  and renders it as compact markdown for human consumption.
- **`status-report.js`** — builds the status-report object `status-renderer.js`
  formats, bounded to a max line count and an approximate token budget so a
  status update stays cheap to re-read.

None of these five depend on anything sensitive by nature (no credentials,
no client data) — they were left out because they're full working parts of
a specific harness's orchestration loop rather than a generically reusable
primitive, and porting them as inert stubs would misrepresent how much of
the real subsystem they are.
