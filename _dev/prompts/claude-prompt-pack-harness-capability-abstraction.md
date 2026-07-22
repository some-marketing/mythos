# Claude Prompt Pack: Harness Capability Abstraction

Prompt pack for extending Mythos from instruction-format harness adapters into provider-neutral capability adapters.

Primary source material:
- [`_dev/HARNESS_CAPABILITY_ABSTRACTION.md`](../HARNESS_CAPABILITY_ABSTRACTION.md)
- [`_dev/HARNESS_ADAPTER_IMPLEMENTATION_PLAN.md`](../HARNESS_ADAPTER_IMPLEMENTATION_PLAN.md)
- [`instructions/README.md`](../../instructions/README.md)

Primary target files:
- [`instructions/adapters/claude.yaml`](../../instructions/adapters/claude.yaml)
- [`instructions/adapters/codex.yaml`](../../instructions/adapters/codex.yaml)
- [`instructions/adapters/generic.yaml`](../../instructions/adapters/generic.yaml)
- other files under [`instructions/adapters/`](../../instructions/adapters/)
- [`tools/instructions/lib/engine.js`](../../tools/instructions/lib/engine.js)
- [`tools/instructions/generate.js`](../../tools/instructions/generate.js)
- [`tools/instructions/validate.js`](../../tools/instructions/validate.js)
- any supporting schemas or tests related to the adapter model

## Goal

Make harness-specific features portable by defining provider-neutral Mythos capabilities first and harness-specific mappings second.

Desired outcome:
- adapter files can describe capability support, fallback behavior, and emulation strategy
- Claude becomes the first full capability adapter
- Codex and generic adapters can map or emulate the same lifecycle logic without vendor lock-in
- framework semantics stay provider-neutral

## Why This Matters

This is the abstraction layer that lets Mythos replicate useful Claude Code behavior across other LLM harnesses.

It should let the system model:
- lifecycle events
- role registry
- policy surface
- memory surface
- checkpointing
- automation runner support

without encoding those concepts as Claude-only features.

## How To Use This Pack

Run this pack in four implementation tasks:

1. adapter model and schema extension
2. engine/generator/validator support
3. adapter file migration
4. validation and docs alignment

Then run:

5. validation
6. completion audit

Do not combine all implementation work into one task unless the repo state is already very stable.

---

## Prompt 1: Coordinator Kickoff

Use this as the initial Claude prompt.

```text
Implement provider-neutral harness capability abstraction in Mythos.

Read these files first:
- `_dev/HARNESS_CAPABILITY_ABSTRACTION.md`
- `_dev/HARNESS_ADAPTER_IMPLEMENTATION_PLAN.md`
- `instructions/README.md`
- `instructions/adapters/claude.yaml`
- `instructions/adapters/codex.yaml`
- `instructions/adapters/generic.yaml`
- `tools/instructions/lib/engine.js`
- `tools/instructions/generate.js`
- `tools/instructions/validate.js`

Goal:
- extend the adapter model so harnesses describe internal capabilities, not just target paths and static mappings
- keep the design provider-neutral
- support truthful fallback or emulation behavior where a harness lacks native features

Required execution pattern:
1. Read the files above.
2. Produce a short plan with acceptance criteria.
3. Launch exactly two read-only Task subagents in parallel:
   - one for adapter model/schema design
   - one for engine/generator/validator impact analysis
4. Synthesize findings in the main thread.
5. Implement the changes in bounded phases.
6. Add or update tests where practical.
7. Run validation.
8. Launch one read-only completion-auditor-style Task subagent.

Acceptance criteria:
1. The adapter model can express provider-neutral capabilities such as lifecycle events, role registry, memory surface, checkpointing, and automation runner.
2. Claude, Codex, and generic adapters remain truthful about native versus emulated support.
3. Generator and validator logic can load the new adapter structure without breaking current behavior.
4. Framework semantics remain provider-neutral.
5. Docs explain the abstraction clearly.

Constraints:
- keep the abstraction capability-first, not vendor-first
- do not invent fake provider support
- preserve existing adapter behavior unless the new model explicitly supersedes it
- avoid broad refactors unrelated to the adapter layer

Final response must include:
- changed files
- capability model decisions
- validations run
- remaining adapter gaps
```

## Prompt 2: Explorer A - Adapter Model Inventory

Use this in a read-only Task subagent.

```text
You are a read-only Task subagent.

Purpose:
Design the smallest safe extension to the adapter model for capability abstraction.

Read:
- `_dev/HARNESS_CAPABILITY_ABSTRACTION.md`
- `_dev/HARNESS_ADAPTER_IMPLEMENTATION_PLAN.md`
- `instructions/adapters/claude.yaml`
- `instructions/adapters/codex.yaml`
- `instructions/adapters/generic.yaml`

Return exactly these sections:

Findings
- current adapter-model limitations with file references

Implementation notes
- recommended capability structure
- recommended native-vs-emulated representation
- safest migration path for existing adapters

Risks
- provider-truthfulness risks
- over-modeling risks
- backward-compatibility risks

Do not edit files.
```

## Prompt 3: Explorer B - Engine And Validation Inventory

Use this in a read-only Task subagent.

```text
You are a read-only Task subagent.

Purpose:
Audit how the instruction engine, generator, and validator must change to support capability-aware adapters.

Read:
- `tools/instructions/lib/engine.js`
- `tools/instructions/generate.js`
- `tools/instructions/validate.js`
- `instructions/README.md`

Return exactly these sections:

Findings
- current assumptions about adapter shape and behavior with file references

Implementation notes
- what loader/validator changes are required
- what can remain format-only for now
- where tests should be added

Risks
- accidental behavior drift
- validation gaps
- partial migration hazards

Do not edit files.
```

## Prompt 4: Worker - Adapter Model And Engine Support

Use this as the first write-owning implementation prompt.

```text
Implement the capability-aware adapter model and supporting engine changes.

Ownership:
- `instructions/adapters/*`
- `tools/instructions/lib/engine.js`
- `tools/instructions/generate.js`
- `tools/instructions/validate.js`
- supporting schemas or tests related to adapter loading/validation only

You are not alone in the codebase. Do not revert edits by others.

Task:
- extend the adapter model to represent provider-neutral capabilities
- update loader/engine behavior as needed
- keep current generation behavior working
- add or update validation for the new model

Constraints:
- keep the first implementation minimal and truthful
- do not force all future runtime logic into the instruction generator immediately
- preserve current managed-target generation behavior

Final response must include:
- changed files
- capability fields added
- engine/validator changes made
- remaining follow-up work
```

## Prompt 5: Worker - Docs And Adapter Migration Alignment

Use this after Prompt 4 is complete.

```text
Align adapter docs and existing adapter files with the new capability abstraction model.

Ownership:
- `instructions/README.md`
- `instructions/adapters/*.yaml`
- related docs only if needed

You are not alone in the codebase. Do not revert edits by others.

Task:
- update adapter docs so the abstraction is clearly explained
- ensure Claude, Codex, and generic adapters are truthful about capability support
- document native support versus emulation where relevant

Constraints:
- keep the docs high-signal
- do not overstate generic-provider parity

Final response must include:
- changed files
- adapter mappings clarified
- any intentional deferrals
```

## Prompt 6: Validation Prompt

Use this after implementation.

```text
Validate the harness capability abstraction work.

Acceptance criteria:
1. Adapter files can express provider-neutral capabilities.
2. Claude, Codex, and generic adapters remain truthful.
3. Instruction engine/generator/validator behavior still works.
4. Docs explain the abstraction clearly.
5. Framework semantics remain provider-neutral.

Run relevant validation and inspect the changed files.

Return:
- criterion-by-criterion pass/fail
- command evidence
- remaining adapter risks
```

## Prompt 7: Completion Audit Prompt

Use this as the final read-only audit.

```text
Act as a completion auditor for the harness capability abstraction work.

Acceptance criteria:
1. Mythos now models harness features as internal capabilities instead of vendor-specific assumptions.
2. Provider adapters can map or emulate those capabilities truthfully.
3. The adapter layer is stronger without becoming misleading.
4. Current instruction-generation behavior remains intact.

Inputs to inspect:
- changed files
- validation output
- updated adapter docs

Return:
- PASS or FAIL
- blocker, warning, and info findings
- recommendation: COMPLETE, REOPEN, or ESCALATE
```

