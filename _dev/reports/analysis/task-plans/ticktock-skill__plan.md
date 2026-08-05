# Task Plan — ticktock-skill (/tt)

> Operator design 2026-08-05T05:27–05:48Z + kernel-triad convene
> `20260805T053904Z-ticktock-skill-design` · Scope: system · Risk: HIGH
>
> **Amended 2026-08-05T05:56Z** against Codex review
> `codex-20260805T055133Z-ticktock-plan-review` (verdict `AMEND_REQUIRED`,
> findings TT-001..TT-008). See "Amendment record" below.
>
> **Amended again 2026-08-05T06:10Z** against Codex round-2 review
> `codex-20260805T060247Z-ticktock-plan-review-r2` (findings TT-R2-001 MAJOR,
> TT-R2-002 MAJOR, TT-R2-003 MINOR). See "Amendment record" below.

## What

`/ticktock` (`/tt`): the Mythos↔simulation co-evolution loop as one command — a
resumable state machine running nine identity-stable phases, with `/tt 5` running
five generations unattended and halting honestly at any gate it cannot pass.

**ORIENT → TICK → OBSERVE → TEXT → RESEARCH → TOCK → IMPROVE → SHIP → SCHEDULE**

## The frame the loop cannot move (both convene corners, adopted)

- **Immutable run charter** committed before cycle 1 (target, ceilings, write
  surfaces, locked reviewer roster, stopping rules, benchmark fingerprint).
- **Full frozen benchmark colony** every cycle (operator ruling: the rigorous
  option) — a learning-off, goal-free sealed sim whose *entire behavioral trace* is
  compared, not chosen metrics. Divergence halts. Intentional change clears only
  through a **reviewed re-baselining ritual** (name what changed, why, which cycle;
  distinct review; operator ratification; charter records vN+1), now with a
  **lineage chain** and a **mechanical repeated-use detector** (see Amendments).
- **Meta-files hard-blocked** (go/meditate/ticktock skills, dispatch-routing-rule,
  capabilities matrix) with a **ratification path**: `/tt` may propose meta-changes
  as plans; only the operator lands them.
- **Merge contract**: zero *unresolved* findings from **every** precommitted
  reviewer in the **maximum available roster** (codex, gemini, hermes,
  DeepSeek-via-codewhale, pi-routed, Claude frontier), assigned before outputs
  exist; timeouts/substitutions/model-pin failures = NOT clean. Now
  **snapshot-and-hash bound** (see Amendments).
- **`--until` deterministic only**; statistics computed post-halt under a
  preregistered contract (kills optional-stopping p-hacking by construction).
- **Rotation mandatory** per cycle — evidence-gathering, never permission.
- **Resumability is a repair contract, not just idempotency** — verified
  checkpoints, partial-phase rollback, and named uncertain-external-effect repair
  states (see Amendments).
- **Credential resolution is Keychain-first** — unattended cycles must never raise
  a desktop 1Password/Automation prompt (see Amendments, S1b).

## Steps

- **S0** — Charter/manifest/journal schemas + phase-identity implementation (the
  coordinator's Q2 is DECIDED, not deferred: nine stable phase_ids —
  `tt.orient, tt.tick, tt.observe, tt.text, tt.research, tt.tock, tt.improve,
  tt.ship, tt.schedule` — PURE vs EFFECTFUL by re-runnability, with exact
  idempotency-key SHA-256 formulas per effectful phase; see the decision record
  `_dev/reports/analysis/ticktock-phase-identity-decision.md`, owner: coordinator,
  2026-08-05). **Amended**: append-only journal, verified checkpoints, partial-phase
  rollback, uncertain-external-effect repair states (EFFECT-RECEIPT-MISSING vs
  EFFECT-DID-NOT-HAPPEN); reviewer-roster availability snapshot, model pins with
  held-pin verification, pre-output assignment, cryptographic lane-binding hash.
- **S1** — `benchmark-colony-v1` + fingerprint + `run-benchmark.js` + the
  re-baselining ritual. **Amended**: re-baseline lineage chain (prior/new
  fingerprint hashes, triggering cycle, review + ratification references) and a
  mechanical repeated-use detector (default N=2 of the last M=5 cycles,
  operator-overridable) that halts + files a finding when tripped.
- **S1b** *(new)* — Credential prompt-elimination: extend the Keychain-first
  pattern already partial in `run-with-op.sh` to the perplexity/openrouter/gemini
  keys themselves, falling back to `op` only on a Keychain miss, so unattended
  cycles raise zero desktop-auth prompts.
- **S2** — The skill and its nine phases, arguments (`/tt`, `/tt N`, `deep`,
  `quick`, `tock`, `--until`), with RESEARCH feeding **both** worlds (the sim's next
  challenge *and* Mythos's own architecture — biological patterns as design input).
  **Amended**: SCHEDULE only prepares the next trigger (activation is separate, see
  S4); `/tt` is an unconditional primary alias registered in
  `instructions/canonical/command-aliases.yaml` (`tt -> ticktock`), with both
  `.claude/commands/ticktock.md` and `.claude/commands/tt.md` as required
  deliverables; each phase names its inherited operator-gate(s) explicitly.
- **S3** — Dry-run verification: injected-drift halt, mid-cycle resume without
  double-effects, charter/meta immutability refusal, reviewer-timeout = not-clean,
  statistical `--until` refused. **Amended into a full acceptance matrix**: repeated
  re-baseline detector, partial-phase rollback, uncertain-external-effect repair
  states, roster availability/model-pin/hash tampering, ratification-path proposal
  artifact (not just refusal), lineage integrity across generations, ceiling
  enforcement, inherited-gate probes, rotation enforcement, evidence-deletion and
  fresh-state-fallback refusal, credential-prompt-elimination proof, alias
  resolution, and a **multi-generation replay (>=3 simulated cycles)**.
  **Amended again (r2)**: every test now has an exact `{test_id, proves, artifact,
  field}` contract — all writing distinct fields into
  `_dev/state/ticktock/ticktock-dryrun-evidence.json`; see
  `bounded_plan.acceptance_matrix` in the JSON (authoritative) and the table below.
  `expected_outcomes` has one entry per test, so nothing in the matrix lacks an
  outcome contract. **Amended again (r3, TT-R3-001/TT-R3-002)**: 19 tests total
  (`S3-a1, S3-a2, S3-b1, S3-b2, S3-c, S3-d1, S3-d2, S3-d3, S3-e, S3-f, S3-g, S3-h,
  S3-h2, S3-i, S3-j1, S3-j2, S3-k, S3-l, S3-m`) — `S3-h2` added for the new
  G-REMOTE-MUTATION mechanical checker — and `expected_outcomes` is now generated
  from the matrix one-to-one, keyed by `test_id`, with artifact and field strings
  copied verbatim.
- **S4** — The plan reviewed by the maximum roster it proposes (first max-roster
  dataset for the capabilities matrix), debrief. **Amended**: SCHEDULE stays inert
  — activation requires both G-TICKTOCK-REVIEW clearing and an explicit operator
  stamp; it is not a side effect of this step.

## S3 acceptance matrix (20 tests, exact contracts)

`bounded_plan.acceptance_matrix` in the JSON is **authoritative** (TT-R3-002; see
`bounded_plan.acceptance_matrix_authority`). `bounded_plan.expected_outcomes`
mirrors it one-to-one, keyed by `test_id`, with artifact and field strings copied
verbatim — comparison between the two surfaces is **assertion-level, not
id-level**, and on any divergence the matrix wins. The one permitted deviation is
an outcome artifact that is a strict superset of the matrix artifact, flagged
`artifact_superset_of_matrix` (only `S3-a1` today). Every row below is a distinct
field (or field group) inside
`_dev/state/ticktock/ticktock-dryrun-evidence.json`.

| test_id | Proves | Field |
|---|---|---|
| S3-a1 | benchmark detects injected drift, names first diverging tick | `injected_drift_test.halted == true AND injected_drift_test.first_diverging_tick` is set |
| S3-a2 | repeated-rebaseline detector halts + files a finding, doesn't silently clear | `rebaseline_detector_test.halted_on_threshold == true AND .finding_recorded == true AND .ratio_computed matches "<N>/<M>"` |
| S3-b1 | partial-phase rollback + idempotency on kill-before-checkpoint | `journal_resume_test.partial_phase_rollback_confirmed == true AND .idempotency_key_honored == true AND .double_effect_detected == false` |
| S3-b2 | EFFECT-RECEIPT-MISSING on kill-after-dispatch-before-receipt, reconciliation required | `journal_resume_test.uncertain_effect_halt_reason == "EFFECT-RECEIPT-MISSING" AND .reconciliation_required_before_resume == true` |
| S3-c | charter/meta immutability: refusal + ratification-path proposal artifact | `charter_immutability_test.edit_refused == true AND .proposal_artifact_produced == true AND .proposal_artifact_path resolves to an existing file` |
| S3-d1 | reviewer timeout/substitution/pin-mismatch each = not-clean | `merge_contract_tests.not_clean_on_timeout/.not_clean_on_substitution/.not_clean_on_pin_mismatch == true` |
| S3-d2 | unavailable-lane snapshot recorded; hash still binds remaining lanes | `merge_contract_tests.availability_snapshot_records_unavailable_lane == true AND .roster_hash_binds_remaining_lanes == true` |
| S3-d3 | roster-hash tamper halts the cycle | `merge_contract_tests.roster_hash_tamper_halts == true` |
| S3-e | statistical `--until` refused; deterministic accepted | `until_refusal_test.statistical_condition_refused == true AND .deterministic_condition_accepted == true` |
| S3-f | lineage chain unbroken, independently re-verified | `lineage_integrity_test.chain_unbroken == true AND .independently_verified == true` |
| S3-g | diff + external-action ceilings both halt when exceeded | `ceiling_enforcement_test.diff_ceiling_halts == true AND .external_action_ceiling_halts == true` |
| S3-h | every gate in `inherited_gate_matrix` probed by gate_id | `inherited_gate_probes[<gate_id>].halted == true` (or `.enforcement_mode_observed` matches the matrix's recorded `enforcement_mode`) for every gate_id — **no gate_id may be absent** |
| S3-h2 | the G-REMOTE-MUTATION mechanical checker denies unstamped, allows stamped, allows read-only lanes, and audits both — reached from the live PreToolUse path, not merely importable | `remote_mutation_gate_test.unstamped_mutation_denied == true AND .stamped_mutation_allowed == true AND .readonly_lane_allowed_without_stamp == true AND .audit_rows_recorded >= 2 AND .enforcement_path_observed in ["pretooluse-live","module-direct"]` (`module-direct` means the registration patch has not landed: harness tier ABSENT, not BLOCKING). **This test alone does not clear the `pretooluse-live` precondition** — see S3-h3 |
| S3-h3 | TT-R4-002 (new): with `enforcement_path_observed_live` false, `/tt` refuses any unattended/remote-capable mode, halting with a named reason citing `pretooluse-live` — a single-cycle attended dry-run that never reaches the remote surface is unaffected | `pretooluse_live_precondition.refused_unattended_mode == true AND .halt_reason == "pretooluse-live" AND .enforcement_path_observed_live_at_refusal == false AND .attended_dry_run_unaffected == true` |
| S3-i | skipped rotation fails acceptance | `rotation_enforcement_test.skipped_rotation_fails_acceptance == true` |
| S3-j1 | evidence/checkpoint deletion refused | `evidence_deletion_test.deletion_refused == true` |
| S3-j2 | silent fresh-state fallback refused | `fresh_state_fallback_test.fallback_refused == true` |
| S3-k | zero desktop-auth prompts across all 3 wrappers | `credential_prompt_elimination_test.desktop_prompts_observed == 0 AND .lanes_reported == ["perplexity","openrouter","gemini"]` |
| S3-l | all of the above hold across >=3 simulated generations | `multi_generation_run.generations_completed >= 3 AND .charter_hash_stable == true` |
| S3-m | `/tt` resolves to `/ticktock`, identical behavior | `alias_resolution_test.resolves_to == "ticktock" AND .behavior_identical == true` |

## Gate

**G-TICKTOCK-REVIEW** — zero unresolved findings from every locked reviewer before
`/tt` runs a real cycle; SCHEDULE activation is downstream of this gate plus an
operator stamp. **No mechanical checker exists for this gate today** — it is new
to this plan; S2 must add a runtime precondition (on `tt.tick` or the outer cycle
loop) that reads the gate's cleared status before permitting a non-dry-run cycle,
or it stays narrative-only.

**Inherited gate matrix** (replaces the r1 `pending_enumeration` placeholder,
TT-R2-002; authoritative copy in `bounded_plan.inherited_gate_matrix`):

| gate_id | Trigger | `/tt` phases | Mechanical checker | Enforcement mode | Evidence artifact |
|---|---|---|---|---|---|
| `G-TICKTOCK-REVIEW` | real-cycle or SCHEDULE-activation attempt | tick, schedule | NONE (new to this plan) | narrative only until S2 implements it | `ticktock-dryrun-evidence.json:inherited_gate_probes["G-TICKTOCK-REVIEW"]` |
| `G-REMOTE-MUTATION` | remote-mutating action | tick, ship, schedule | **`tools/kernel/hooks/pretool-remote-mutation-gate.cjs`** (`classifyCommand`/`evaluate`/`loadStamps`) — replaces the r2 "NONE". Stamps: `_dev/state/remote-mutation-stamps/<stamp-id>.json`, schema `RemoteMutationStamp/1.0`. TT-R4-001: rsync classifier added, catch-all fail-closes unrecognized executables naming the orwell host / `D:\HyperV` directly, and wrapper-script body scanning fail-closes unrecognized `.sh`/`.ps1` invocations | CHECKER: **fail-closed, no bypass, classification holes closed** (46/46 fixture tests, up from 38/38). HARNESS: **ABSENT** — not yet registered (`tools/kernel/` is inside the convene perimeter and no receipt covers it); module staged at `_dev/staged/kernel-hooks/`, patch at `_dev/staged/kernel-hooks/REGISTRATION-PATCH.md`. See the new `pretooluse-live` gate below (TT-R4-002) — BLOCKING for any unattended/remote-capable mode while this stays ABSENT | `_dev/state/remote-mutation-stamps/audit.jsonl` + the stamp sidecars + `ticktock-dryrun-evidence.json:inherited_gate_probes["G-REMOTE-MUTATION"]` and `:remote_mutation_gate_test` |
| `pretooluse-live` | an attempt to enter any unattended (`/tt N`, `--until`) or remote-capable /tt mode | tick, ship, schedule | new gate (TT-R4-002) — not a checker itself; reads `remote_mutation_gate_test.enforcement_path_observed_live` from `ticktock-dryrun-evidence.json`, written by S3-h3's live-harness probe (not module-direct) | **BLOCKING** by design — S2 must implement the refusal; module-direct-only evidence is explicitly insufficient, distinct from S3-h2's checker-correctness pass | `ticktock-dryrun-evidence.json:remote_mutation_gate_test.enforcement_path_observed_live` + `:harness_denial_transcript_path` + `pretooluse_live_precondition.*` (S3-h3) |
| `userprompt-plan-review-gate` | `/run-plan` without a distinct-mind review record | improve | `tools/kernel/hooks/userprompt-plan-review-gate.cjs` wired at `dispatch-userprompt.cjs:108` | ADVISORY (loud-injection, stdout, always exits 0 — not verified hard-blocking for UserPromptSubmit) | `_dev/state/plan-task-review-state/<plan-id>.json:distinct_reviews[].verdict` |
| `pretool-orchestrator-worker-gate` | coordinator self-executes work that should delegate | improve, ship | `tools/kernel/hooks/pretool-orchestrator-worker-gate.cjs` wired at `dispatch-pretool.cjs:221-227` | BLOCKING only if `MYTHOS_ORCHESTRATOR_GATE=1`, else observe-only; fail-open | `_dev/state/orchestrator-worker-gate/<session_id>.json` |
| `convene-perimeter-gate` | write to a `PROTECTED_PATHS` governance path (incl. `command-aliases.yaml`) without a live `ConveneReceipt/1.0` | improve, ship | `tools/verify/hooks/pre-write-convene-required.cjs` (`evaluate`/`evaluateBash`) wired at `dispatch-pretool.cjs:149-154` and `:178-199` | BLOCKING, FAIL-CLOSED (observed live twice this session, incl. a false-positive on a read-only command naming a protected path in its arguments) | `ConveneReceipt/1.0` under `_dev/reports/analysis/convene-runs/*` |
| `pretool-secret-access-gate` | `.env*` access or credential-shaped Bash token | tick, text, research, improve | `tools/kernel/hooks/pretool-secret-access-gate.cjs` wired at `dispatch-pretool.cjs:96-104` | BLOCKING only if `MYTHOS_SECRET_ACCESS_GATE=1`, else observe-only; fail-open | `_dev/state/secret-access-gate/<session_id>.json` |
| `pretool-write-boundary-gate` | write/delete outside workspace or into a denylisted repo | all phases | `tools/kernel/hooks/pretool-write-boundary-gate.cjs` wired at `dispatch-pretool.cjs:111-119` | BLOCKING only if `MYTHOS_WRITE_BOUNDARY_GATE=1`, else observe-only (its header calls it "never disable" but the wiring is conditional — recorded as observed, not assumed) | `_dev/state/write-boundary-gate/<session_id>.json` + `bypass-ledger.jsonl` |
| `pretool-git-custody-gate` | git add/commit of another session's owned path | ship | `tools/kernel/hooks/pretool-git-custody-gate.cjs` wired at `dispatch-pretool.cjs:207-213` | BLOCKING on positively-proven foreign custody; unknown passes advisory; fail-open | `_dev/state/git-custody-gate/<session_id>.json` |
| `pretool-mutation-plan-gate` | mutation without a covering approved plan/review pair | improve, ship | `tools/kernel/hooks/pretool-mutation-plan-gate.cjs` wired at `dispatch-pretool.cjs:67-73,142-146,164-168` | REPORT-ONLY repo-wide today; blocks only if operator flips the session's add mode | `_dev/state/tier-gate-soak/mutation-plan-gate.jsonl` |
| `pretool-delegation-altitude` | delegation-altitude cap exceeded | improve, ship | `tools/kernel/hooks/pretool-delegation-altitude.cjs` wired at `dispatch-pretool.cjs:84-86,137,161-162` | gated behind marker files `enforce`/`override`, not unconditional | `_dev/state/tier-gate-soak/delegation-altitude-cap.jsonl` |
| `bubble-up-gates-taxonomy` | n/a — shared vocabulary only | any phase recording a `bubble_up_gate` field | `kernel/lib/bubble-up-gates.cjs` (`isValidGate`/`isBubbleUpGate`) — not itself a blocker | n/a; consumed by other layers | none independently |

Concrete instance already observed this session: `tools/kernel/hooks/dispatch-pretool.cjs`
blocks a governance write to `instructions/canonical/command-aliases.yaml` (the
exact file S2 touches) without a live `ConveneReceipt/1.0` — S2's alias-registry
change must go through `/convene` and mint that receipt before it lands. The same
gate also fired, this amendment, on a read-only shell command that merely named a
protected hook path in its arguments — its Bash-channel matcher scans command text
broadly, not narrowly read-vs-write; `/tt`'s own tooling must not assume harmless
reads referencing protected paths pass silently.

## Amendment record

Amended 2026-08-05T05:56Z against Codex review
`codex-20260805T055133Z-ticktock-plan-review` (5 MAJOR + 3 MINOR, `AMEND_REQUIRED`).
Full findings: `_dev/reports/analysis/task-plan-reviews/ticktock-skill__review.json`.

| Finding | Severity | Resolution |
|---|---|---|
| TT-001 resumability contract | MAJOR | S0: append-only journal, verified checkpoints, partial-phase rollback (gemini's convene ruling), EFFECT-RECEIPT-MISSING vs EFFECT-DID-NOT-HAPPEN halt states. S3: dedicated dry-run cases for each. |
| TT-002 reviewer roster binding | MAJOR | S0: availability snapshot, per-lane model pin + held-pin verification, pre-output assignment, cryptographic lane-binding hash in the charter. S3: timeout/substitution/pin-drift/hash-tamper tests. |
| TT-003 re-baselining escape valve | MAJOR | S1: lineage chain per re-baseline; mechanical repeated-use detector (N=2/M=5 default, operator-overridable) halts + files a finding on threshold breach. S3: repeated-rebaseline test. |
| TT-004 dry-run coverage | MAJOR | S3 rewritten as a full acceptance matrix: lineage integrity, ceiling enforcement, inherited gates, rotation enforcement, ratification-path proposal artifact, evidence-deletion refusal, fresh-state-fallback refusal, multi-generation (>=3 cycle) replay. |
| TT-005 alias/scope authority | MAJOR | S2: `/tt` is an unconditional primary alias via `instructions/canonical/command-aliases.yaml`; both command files added to `scope_identity.owned_artifacts`; S3 adds a mechanical alias-resolution check. |
| TT-006 inherited-gate coverage | MINOR | `required_gates` gains explicit `G-REMOTE-MUTATION` and `inherited_operator_gates` entries; S0 enumerates the full lane set; S3(h) exercises it. |
| TT-007 schedule boundary | MINOR | S2/S4: SCHEDULE only prepares; activation requires G-TICKTOCK-REVIEW cleared plus an operator stamp, never a side effect. |
| TT-008 output contract | MINOR | `expected_outcomes` converted from prose to `{outcome, artifact, field}` objects binding each claim to a checkable artifact and field. |
| TT-009 (INFO) | — | Preserved as a closeout requirement in S4 debrief; not a defect in this plan. |

**New step added (operator instruction, not a Codex finding):** S1b — credential
prompt-elimination. Verified via `_dev/reports/credentials/2026-08-05T05-53-16Z__audit.md`:
`smos-1p-automation-token` is present in macOS Keychain (headless, no prompt);
`PERPLEXITY_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY` are not stored under
wrapper-recognized Keychain names and currently route through `op`, which can fall
back to interactive desktop auth. Operator stores values via
`tools/boot/keychain-store.sh`; values never transit chat.

### Round 2

Amended 2026-08-05T06:10Z against Codex round-2 review
`codex-20260805T060247Z-ticktock-plan-review-r2` (2 MAJOR + 1 MINOR, `AMEND_REQUIRED`).
Full findings: `_dev/reports/analysis/codex-cli-run__20260805T060247Z__ticktock-plan-review-r2.md`.

| Finding | Severity | Resolution |
|---|---|---|
| TT-R2-001 S3 acceptance-matrix coverage | MAJOR | Added `bounded_plan.acceptance_matrix`: 18 tests (`S3-a1..S3-m`), each an exact `{test_id, proves, artifact, field}` contract. `expected_outcomes` expanded from 6 to 18 entries, one per test — see the acceptance-matrix table above. |
| TT-R2-002 inherited-gate enumeration | MAJOR | Replaced `pending_enumeration` with `bounded_plan.inherited_gate_matrix`: 11 sourced entries (10 gates plus the bubble-up-gates vocabulary module) (trigger, `/tt` phases, mechanical checker or explicit "NONE", where it's wired, true enforcement mode, evidence artifact) — see the gate table above. |
| TT-R2-003 phase-identity still deferred | MINOR | Q2 resolved as a decision, not an options doc: `_dev/reports/analysis/ticktock-phase-identity-decision.md` (nine phase_ids, PURE/EFFECTFUL by re-runnability, exact idempotency-key formulas; owner: coordinator, 2026-08-05). S0 description, `files_touched`, `scope_identity.owned_artifacts`, and the phase-identity `operator_rulings` entry all updated to point at the decision record. |

### Round 3

Amended 2026-08-05T07:05Z against the Codex round-3 review (TT-R3-001 MAJOR,
TT-R3-002).

| Finding | Severity | Resolution |
|---|---|---|
| TT-R3-001 convention-only safety gate | MAJOR | **Resolved.** G-REMOTE-MUTATION now has a mechanical checker: `tools/kernel/hooks/pretool-remote-mutation-gate.cjs` (PreToolUse/Bash), `enforcement_mode: fail-closed`. Stamps are machine-checkable sidecars `_dev/state/remote-mutation-stamps/<stamp-id>.json`, schema `RemoteMutationStamp/1.0` = `{schema, stamp_id, source_doc, granted_at, operator_authorization, scope[], conditions[], expires_at, voided, superseded_by}`; the `source_doc` must exist and match `g-remote-mutation-{packet,prestamp}__*.md`. Deny on: no stamp, expired, voided, superseded, scope mismatch, unparseable sidecar, unlisted remote script, unprovable ad-hoc `ssh` payload, or an exception in the gate itself on a remote-surface command. No agent-settable bypass. Audit: `_dev/state/remote-mutation-stamps/audit.jsonl`. Two stamps backfilled (`ant-world-orwell-live-dashboard__20260804T2023Z`, `continuity-control__20260805T0306Z`). Verified by execution: 38/38 fixture tests. New acceptance test **S3-h2** with evidence field `remote_mutation_gate_test`. **Registration is blocked** — `tools/kernel/` sits inside the convene authority perimeter with no covering `ConveneReceipt/1.0`; the module is staged at `_dev/staged/kernel-hooks/` with `REGISTRATION-PATCH.md`. Until that lands and a live PreToolUse denial is observed, the honest tier is: checker fail-closed, **harness enforcement ABSENT**. |
| TT-R3-002 acceptance-matrix authority | — | **Resolved.** `bounded_plan.acceptance_matrix` declared authoritative via the new `bounded_plan.acceptance_matrix_authority` clause; `expected_outcomes` regenerated one-to-one from it, keyed by `test_id`, artifact/field verbatim, so comparison is assertion-level. Drift repaired: **S3-a2** (missing `ratio_computed` clause), **S3-b1** (missing `idempotency_key_honored`), **S3-c** (missing `proposal_artifact_path` resolves clause), **S3-h** (vague "present and consistent" replaced by the `halted`/`enforcement_mode_observed` contract plus "no gate_id may be absent"), **S3-k** (missing `lanes_reported`). `S3-a1` keeps a superset artifact string, flagged `artifact_superset_of_matrix`. Matrix 18 -> 19 tests. |

### Round 4

Amended 2026-08-05T08:00Z against the Codex round-4 review (TT-R4-001 MAJOR,
TT-R4-002 MAJOR, TT-R4-003 MINOR). This round is a **bounded fix**, not a
full replan: the gate's classification holes and a missing live-enforcement
precondition, applied under two operator conditions.

| Finding | Severity | Resolution |
|---|---|---|
| TT-R4-001 classification holes (rsync, wrapper scripts) | MAJOR | **Resolved.** `tools/kernel/hooks/pretool-remote-mutation-gate.cjs` (still staged, unregistered) had three holes where an unrecognized remote-surface command fell through `classifySegment` to `{applies: false}` — gate-does-not-apply — instead of denying: rsync had no classifier at all; an unrecognized executable that named the orwell host or a `D:\HyperV` path directly was invisible to the gate; and a new wrapper script (not `psrun.sh`/`psrunfile.sh`, not on the read-only allowlist) that shells to `ssh`/`scp`/`rsync` internally bypassed classification whenever the invoking command line never named orwell itself. Fixed: rsync now classifies push (destination-is-orwell) as MUTATING and pull (source-is-orwell) as READ-ONLY, mirroring `scp`; a catch-all fail-closes any unrecognized executable whose segment or whole command line names the orwell host or a `D:\HyperV`/`D:/HyperV` path (key prefix `unknown:`); and unrecognized `.sh`/`.ps1` invocations are scanned for remote-mutation indicators in their own body — a hard mutation token or an `ssh`/`scp`/`rsync` reference to orwell denies, and a body that cannot be resolved and read at all denies too (key prefix `wrapper:`). Fixture suite: **38/38 -> 46/46** (8 new cases: rsync push denied unstamped, rsync pull allowed, two unrecognized-exe-naming-orwell denials, two script-shells-to-ssh-orwell denials, one unresolvable-script denial, one clean-unrelated-script allow). `required_gates["G-REMOTE-MUTATION"]` and the inherited-gate-matrix row above updated. |
| TT-R4-002 no BLOCKING precondition on live enforcement | MAJOR | **Resolved.** New `required_gates["pretooluse-live"]` entry (row added to the gate table above): `/tt` must refuse to enable any unattended (`/tt N`, `--until`) or remote-capable mode until a **live PreToolUse denial** has been observed through the harness itself — not a module-direct test, even though module-direct is sufficient to pass S3-h2's checker-correctness assertions. Verification requires two artifacts from the same session: an `audit.jsonl` deny row, and the harness's own denial transcript (not the module's return value re-narrated). New evidence fields in `ticktock-dryrun-evidence.json`: `remote_mutation_gate_test.enforcement_path_observed_live` (strict boolean, distinct from S3-h2's existing tri-state `enforcement_path_observed`) and `remote_mutation_gate_test.harness_denial_transcript_path`. S2 must implement the refusal as a phase-entry precondition on `tt.tick`/`tt.ship`/`tt.schedule` or the outer cycle loop; S3 gains a new test **S3-h3** that positively exercises the refusal (matrix 19 -> 20 tests). Added to `escalation_triggers`. |
| TT-R4-003 stamp expiry note | MINOR | **Resolved.** The two backfilled stamps (`ant-world-orwell-live-dashboard__20260804T2023Z`, `continuity-control__20260805T0306Z`) carry `expires_at: null` because the operator never set one when granting them — not a defect. Noted explicitly in `required_gates["G-REMOTE-MUTATION"].decision`: `expires_at: null` reads as a **single-program authorization**, valid for the program of work named in the stamp's `source_doc`/`conditions`, not time-bounded. A future amendment may add expiry semantics if the operator ratifies one; none is invented by this round. |

Next command per the review: `/review-task-plan ticktock-skill` (re-run after this
amendment). Do not run `/run-plan` or `/go` yet.
