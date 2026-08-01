# Worker packet contract

A worker packet is a bounded delegation artifact. It is written BEFORE a delegated Claude worker terminal is opened. The worker reads its packet first on startup. The orchestrator reads the packet again on reintegration.

**Worker packets are not the default.** Write one only when:
- the chosen execution shape is #1 or #3 (see `execution-shape-rubric.md`)
- no native command (e.g., `/execute-plan`) can cover the delegated scope
- the delegation is durable enough to need a disk artifact

## Location

```
_dev/reports/analysis/worker-packets/{plan-id}__{worker-id}.md
```

- `{plan-id}` — the parent task-plan id (e.g., `voice-mcp-online`)
- `{worker-id}` — the bounded worker's role (e.g., `worker-a-producer`, `worker-b-consumer`)

## Required fields

```markdown
# Worker packet — {plan-id} — {worker-id}

**Orchestrator:** orchestrator Claude (session id)
**Worker identity:** worker Claude (terminal {N}), model {model-id}
**Parent plan:** `_dev/reports/analysis/task-plans/{plan-id}__plan.json`
**Execution shape:** {shape name from rubric}

## Owned surfaces
<explicit list of paths, files, or services this worker owns. No overlap with other workers.>

## Required reads (do these first)
<files the worker MUST read before editing anything. Include relevant skill references and memory pointers.>

## Expected outputs
<what artifacts must exist on disk when the worker reports back. Be specific: file paths, not vague descriptions.>

## Validation required
<which `tools/verify/*.cjs` scripts must pass, which tests must run, what output is considered passing.>

## Stop conditions (must halt and signal back)
<conditions where the worker must stop and escalate to orchestrator rather than widening scope.>

## Escalation conditions (must ask operator, not decide alone)
<conditions where only the human operator can decide.>

## Reintegration path
<how the orchestrator will consume this worker's output. Usually: read files at path X, run verify script Y, then close via native command Z.>

## Non-negotiables
- Do NOT spawn your own subagents (guardrails.md §6)
- Do NOT edit files outside owned surfaces
- Do NOT bypass native hooks or verify scripts
- Do NOT declare complete without producing the expected outputs
- Do NOT collapse actor identity — you are worker Claude, not the human operator

## Closing signal expectations
When the work is complete OR you are blocked, write a status note at:
`_dev/reports/analysis/worker-packets/{plan-id}__{worker-id}.status.md`

Do NOT write a HandoffSignal/1.0 yourself. Orchestrator reintegrates and writes the closing signal.
```

## Example packet (abbreviated)

```markdown
# Worker packet — voice-mcp-online — worker-a-producer

**Orchestrator:** orchestrator Claude (session 2026-04-13-a)
**Worker identity:** worker Claude (terminal 2), opus-4-6
**Parent plan:** `_dev/reports/analysis/task-plans/voice-mcp-online__plan.json`
**Execution shape:** orchestrator + 2 Claude workers + Codex bridge

## Owned surfaces
- `tools/voice/producer/` (all files)
- `tools/voice/schemas/producer.*.schema.json`

## Required reads
- `tools/voice/README.md`
- `_dev/concepts/StarAI.md` (context on the voice channel architecture)
- Memory: `project_voice_interface.md`, `feedback_voice_barge_in_policy.md`

## Expected outputs
- `tools/voice/producer/producer.js` implementing the producer contract
- `tools/voice/schemas/producer.input.schema.json` validated
- `tools/voice/schemas/producer.output.schema.json` validated
- Unit tests at `tools/voice/producer/__tests__/`

## Validation required
- `node tools/verify/verify-skill.cjs` passes (no regression)
- `npm test -- tools/voice/producer` green
- Producer schemas validate against sample input/output fixtures

## Stop conditions
- Consumer contract is unclear and cannot be inferred from StarAI.md
- Producer must read from a surface that is owned by another worker
- Any file outside owned surfaces would need to change

## Escalation conditions
- Voice hardware availability required for testing
- Operator decision needed on VAD threshold default

## Reintegration path
Orchestrator reads `tools/voice/producer/` files directly, runs producer tests, runs verify-skill, then opens the codex-bridge for architectural review of the integrated producer+consumer. Closes via a HandoffSignal/1.0 with signal_type `cycle-complete`.

## Closing signal expectations
Write status to `_dev/reports/analysis/worker-packets/voice-mcp-online__worker-a-producer.status.md` when done or blocked.
```

## Orchestrator checklist (before launching worker)

- [ ] Packet written to disk at the canonical location
- [ ] Owned surfaces do not overlap with any other worker packet in this plan
- [ ] Required reads include all relevant skills and memory files
- [ ] Expected outputs are named file paths, not vague descriptions
- [ ] Validation cites specific `tools/verify/*.cjs` scripts or test commands
- [ ] Stop and escalation conditions are explicit
- [ ] Reintegration path is named
- [ ] Actor identity is stated at the top of the packet

## Orchestrator checklist (on reintegration)

- [ ] Read the expected output files directly, not the worker's summary
- [ ] Run the declared validation scripts
- [ ] Compare worker's status note against the expected outputs (gaps → repair-needed)
- [ ] If any expected output is missing, write a repair packet, not a `complete` signal
