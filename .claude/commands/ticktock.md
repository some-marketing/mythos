---
description: Run the Mythos↔simulation co-evolution loop — nine phases, one resumable cycle
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Task]
---

<objective>
Run `/ticktock` — the tick-tock co-evolution cadence as one resumable state
machine. Nine identity-stable phases under an immutable run charter:

**ORIENT → TICK → OBSERVE → TEXT → RESEARCH → TOCK → IMPROVE → SHIP → SCHEDULE**

The full command body is the skill at `.claude/skills/ticktock/SKILL.md`. Read it
before acting — the phase definitions, the per-phase gate bindings, the honest
capability tiers, and the refusals are all there and none of them are optional.
</objective>

<arguments>
- `/ticktock` — one attended cycle.
- `/ticktock N` — N generations (**unattended** for N>1).
- `/ticktock deep` — one cycle at maximum rigor.
- `/ticktock quick` — reduced fan-out; skipped phases are recorded, not omitted. May not merge.
- `/ticktock tock` — TOCK only (`/meditate` in the loop's frame; no sim authority).
- `/ticktock --until <deterministic milestone>` — run to a milestone (**unattended**).
- `--dry-run` — modifier on any form: a declared local-only run. No phase may issue
  an effectful remote command; one that would have is recorded as skipped and the
  cycle may not merge.

A statistical `--until` is **unrepresentable**: `RunCharter/1.0`'s
`stopping_rules.until_kind` is an enum of `cycle_ceiling | deterministic_milestone
| none`. Report the schema's refusal; do not add a second guard on top of it.
</arguments>

<process>
1. Follow `.claude/skills/ticktock/SKILL.md` in full.
2. Run the phase-entry preconditions first, as an executable and not as a
   recollection:

   ```
   node tools/ticktock/preflight-ticktock.cjs <the invocation's arguments>
   ```

   Exit 0 proceeds, exit 1 refuses, exit 2 is an internal error and also refuses.
   It evaluates `pretooluse-live` and `G-TICKTOCK-REVIEW` fail-closed. Then the
   charter frame (`charter.cjs`) and journal integrity (`journal.cjs`). Any failure
   halts and names its reason; none of them warn-and-proceed. **The preflight is
   ADVISORY, not BLOCKING** — it is a real fail-closed script, but nothing in the
   harness compels the call, and the BLOCKING version would be a registered hook
   under `tools/kernel/hooks/`, inside the convene perimeter.
3. Every cycle, in order: benchmark first, rotation dispatch, generation
   manifest, journal transitions — calling `tools/ticktock/run-benchmark.js`,
   `charter.cjs`, `journal.cjs`, and `canonical.cjs` through their exported API.
   Never reimplement them. `journal.cjs` is under active repair — read-only.
4. Name each phase's applicable gates and their true tier (BLOCKING / ADVISORY /
   ABSENT / UNKNOWN) as you enter it.
</process>

<honest_status>
- **`/tt` does not resolve yet.** The alias entry belongs in
  `instructions/canonical/command-aliases.yaml`, which sits inside the convene
  authority perimeter. The registry patch is staged at
  `_dev/staged/ticktock-alias/REGISTRATION-PATCH.md` and needs `/convene` plus a
  `ConveneReceipt/1.0`. `.claude/commands/tt.md` is generated from that entry and
  must not be hand-written. Use `/ticktock` until the patch lands.
- **`G-REMOTE-MUTATION` is not enforced by the harness.** Its checker is
  fail-closed with 46/46 fixture tests, but it is not registered in
  `tools/kernel/hooks/dispatch-pretool.cjs`. Any claim that `/ticktock` is safe
  for unattended, remote-capable operation is false today — which is why the
  `pretooluse-live` precondition refuses those modes.
- **Attendance does not exempt anything.** The refusal predicate is remote
  reachability. `/ticktock`, `/ticktock deep`, `/ticktock quick`, `/ticktock N`
  and `/ticktock --until` all resolve `tt.tick` and are refused today. Only
  `/ticktock tock` and a declared `--dry-run` proceed.
- **`G-TICKTOCK-REVIEW` is ABSENT, not merely unmet.** Its decision artifact
  `_dev/state/ticktock/g-ticktock-review-decision.json` (schema
  `TickTockReviewDecision/1.0`, clearing field `decision.cleared`) does not exist
  yet — S4 must produce it. The preflight's read fails closed until it does.
</honest_status>

<success_criteria>
- The skill was read and followed; no phase ran with its gates unstated.
- The benchmark ran first and its result was recorded.
- Every remote-capable invocation — attended or not — was refused while
  `remote_mutation_gate_test.enforcement_path_observed_live` is anything but
  strictly `true`, naming `pretooluse-live` as the reason, with the refusal
  produced by the preflight's exit code rather than asserted.
- Every generation manifest was written through
  `tools/ticktock/generation-manifest.cjs`, never inline, and its read-back
  receipt was recorded.
- SCHEDULE prepared a trigger and activated nothing.
</success_criteria>
