# Claude Prompt Pack: Local Model Verification Lane

Prompt pack for turning the local-model verifier concept and imported research into an execution-ready research and validation workflow that Claude can run with bounded parallel subagents, an explicit verification loop, and a continuous-fitness plan.

**Priority:** Highest-priority bounded / standalone Claude plan in the current prompt-system surface.

Primary source material:
- [`_dev/concepts/local-model-verification-lane.md`](../concepts/local-model-verification-lane.md)
- [`_dev/research/local-model-verification-lane/00_intake_summary.md`](../research/local-model-verification-lane/00_intake_summary.md)
- [`_dev/research/local-model-verification-lane/01_perplexity_prompt_and_report.md`](../research/local-model-verification-lane/01_perplexity_prompt_and_report.md)
- [`_dev/research/local-model-verification-lane/02_mythos_local_model_verification_lane_design_report.md`](../research/local-model-verification-lane/02_mythos_local_model_verification_lane_design_report.md)
- [`_dev/research/local-model-verification-lane/03_continuous_model_fitness_assessment_for_local_llms_on_apple_silicon.md`](../research/local-model-verification-lane/03_continuous_model_fitness_assessment_for_local_llms_on_apple_silicon.md)
- [`_dev/concepts/simpleminions-local-routing-and-distributed-execution-integration.md`](../concepts/simpleminions-local-routing-and-distributed-execution-integration.md)
- [`_dev/SIMPLEMINIONS_ROUTING_INTEGRATION_IMPLEMENTATION_PLAN.md`](../SIMPLEMINIONS_ROUTING_INTEGRATION_IMPLEMENTATION_PLAN.md)
- [`_dev/FRAMEWORK_LEARNING_LOOP_ARCHITECTURE.md`](../FRAMEWORK_LEARNING_LOOP_ARCHITECTURE.md)
- [`_dev/reports/analysis/lessons-reconciliation__2026-03-30.md`](../reports/analysis/lessons-reconciliation__2026-03-30.md)
- [`_dev/research/competitive/2026-03-29-openclaw-nemoclaw-mythos/06_aspirational_crossref.md`](../research/competitive/2026-03-29-openclaw-nemoclaw-mythos/06_aspirational_crossref.md)
- [`_dev/policies/prompt-pack-contract.md`](../policies/prompt-pack-contract.md)
- [`tools/verify/README.md`](../../tools/verify/README.md)

Primary target outputs:
- a bounded execution plan for the local-model verification lane
- a benchmark definition tied to real Mythos verification tasks
- a candidate-model shortlist
- a routing and escalation policy
- a continuous model-fitness operations plan
- a tool-surface readiness decision
- a local controller / broker contract
- a final recommendation with explicit validation results

## Goal

Determine whether this machine can run a local model that is good enough for first-pass verification/review work inside Mythos, so frontier-model review is reserved for escalation cases rather than every bounded verification step.

Desired outcome:
- a shortlist of locally runnable model candidates
- a benchmark built from real Mythos verification tasks
- a clear pass/fail scoring rubric
- a local-first vs cloud-escalation policy
- a continuous-fitness loop with golden sets, regression cadence, and promotion gates
- a clear answer on whether bounded tool use is required now, later, or not at all for the first lane
- a clear contract for the local control layer if tools are required
- a decision on whether the lane is worth adopting now
- an explicit path toward Claude-controlled local worker/subagent participation later, with a distinct-family reviewer still acting as the authority

## Why This Matters

The target is not to replace frontier models everywhere.
The target is to reduce token usage on repetitive bounded subagent-style work such as:
- findings-first review of narrow diffs
- acceptance-criteria checking
- contradiction / overclaim detection
- report-quality review
- framework-output verification

This pack should keep the lane aligned with Mythos doctrine:
- prompts reason
- signals judge
- code remembers
- Claude orchestrates
- local workers stay bounded and brokered
- a distinct-family reviewer verifies high-risk or ambiguous outcomes

## Claude Optimization Notes

- Keep the coordinator in the main thread for framing, synthesis, value ranking, and final recommendation.
- Use read-only subagents for research, hardware/runtime fit, and benchmark-design inventory.
- Prefer a narrow candidate set over a sprawling model catalog.
- Evaluate models against Mythos-shaped verifier tasks, not generic chatbot ability.
- Treat local models as first-pass verifiers only unless evidence proves more.
- Treat continuous fitness as part of the lane definition, not as later optional polish.
- Use critique/review as a mandatory quality gate for research artifacts that may later affect system behavior.
- Treat tool-surface viability as a separate gate from raw model quality.
- Treat local control as a separate gate from both model quality and raw tool-calling capability.
- Treat “local subagents under Claude control” as the long-term destination, but only after verifier output contracts, broker boundaries, and benchmark evidence are real.

Avoid:
- broad “best local model” research without task boundaries
- mixing model discovery and implementation of routing code in the same run
- allowing the same worker to both define and validate the benchmark result
- treating local success as permission to skip escalation policy

## Multi-Agent Functionality

- Main thread owns:
  - goal framing
  - candidate shortlist selection
  - benchmark scope selection
  - synthesis of subagent findings
  - final routing recommendation
- Read-only subagents may own:
  - hardware/runtime fit inventory
  - benchmark/leaderboard and model-shortlist research
  - Mythos task-shape and benchmark-example inventory
  - completion-auditor-style review of the resulting recommendation
- Write ownership stays in one worker thread.
- Validation remains independent from the main writer whenever possible.

## Recommended Execution Order

1. coordinator kickoff
2. parallel inventory subagents
3. synthesis of candidate set and benchmark scope
4. benchmark, routing, and fitness artifact authoring
5. tool-surface decision authoring
6. local controller contract authoring
7. validation loop
8. final recommendation and closeout

## Deliverables

Write these docs under `_dev/research/local-model-verification/`:

1. `01_model_shortlist.md`
   - narrow candidate set for this hardware and use case
2. `02_benchmark_definition.md`
   - real Mythos task classes, evaluation set, scoring rubric
3. `03_runtime_and_storage_plan.md`
   - Ollama / MLX / other runtime fit, storage path, operational constraints
4. `04_routing_and_escalation_policy.md`
   - what can run local-first, what must escalate
5. `05_recommendation.md`
   - final recommendation, risks, readiness, and next implementation slice
6. `06_fitness_ops_plan.md`
   - frozen golden set shape, regression cadence, promotion gates, and shadow/disagreement review plan
7. `07_tooling_readiness.md`
   - whether the first lane can stay artifact-in / verdict-out or needs bounded tools immediately
8. `08_local_controller_contract.md`
   - minimum local broker/controller shape for any tool-enabled offload path

The controller contract should explicitly support a later mode where Claude can delegate bounded slices to local worker surfaces, while a distinct-family reviewer still verifies the important outcomes.

## Required Verification Loop

This pack is not complete until Claude performs an explicit verification loop:

1. Draft the shortlist, benchmark, runtime plan, and routing policy.
2. Run a read-only validation pass that checks:
   - the benchmark uses real Mythos verification tasks
   - the candidate set is bounded
   - the storage/runtime plan is realistic for this machine
   - the escalation policy is explicit
   - the fitness loop is explicit and lightweight enough to sustain
   - the tooling boundary is explicit and defensible
   - the local controller contract is explicit if tools are required
   - no claim says local models can self-certify completion
3. Correct the docs if validation finds drift.
4. Run a completion-auditor-style closeout.

The same worker must not both write the final recommendation and independently validate that recommendation.

## Prompt 1: Coordinator Kickoff

```text
Execute the local-model verification lane research for Mythos.

Read first:
- `_dev/concepts/local-model-verification-lane.md`
- `_dev/research/local-model-verification-lane/00_intake_summary.md`
- `_dev/research/local-model-verification-lane/01_perplexity_prompt_and_report.md`
- `_dev/research/local-model-verification-lane/02_mythos_local_model_verification_lane_design_report.md`
- `_dev/research/local-model-verification-lane/03_continuous_model_fitness_assessment_for_local_llms_on_apple_silicon.md`
- `_dev/concepts/simpleminions-local-routing-and-distributed-execution-integration.md`
- `_dev/SIMPLEMINIONS_ROUTING_INTEGRATION_IMPLEMENTATION_PLAN.md`
- `_dev/FRAMEWORK_LEARNING_LOOP_ARCHITECTURE.md`
- `_dev/reports/analysis/lessons-reconciliation__2026-03-30.md`
- `_dev/research/competitive/2026-03-29-openclaw-nemoclaw-mythos/06_aspirational_crossref.md`
- `_dev/policies/prompt-pack-contract.md`
- `tools/verify/README.md`

Goal:
- determine whether this machine can support a local-model verifier lane for bounded Mythos review tasks
- define the benchmark, routing policy, and fitness loop for that lane
- decide whether bounded tool use is a requirement for the first practical version
- define the minimum local control layer if bounded tool use is required
- end with a concrete recommendation instead of open-ended research notes

Required execution pattern:
1. Read the files above.
2. Produce a short planning frame:
   - objective
   - machine baseline
   - target verification tasks
   - likely candidate-model bands
   - likely validation surfaces
3. Launch exactly 3 read-only subagents in parallel:
   - hardware/runtime/storage fit
   - model shortlist / benchmark-source research
   - Mythos task-shape and benchmark-example inventory
4. Synthesize findings in the main thread.
5. Keep the candidate set bounded.
6. Write the five deliverable docs.
7. Make the fitness loop explicit rather than implied.
7. Launch one read-only validation subagent to review the docs against the required verification loop.
8. Correct the docs if needed.
9. Launch one read-only completion-auditor-style subagent.

Acceptance criteria:
1. The candidate set is bounded and realistic for an Apple M3 Pro with 36 GB RAM.
2. The benchmark is based on real Mythos verification/review tasks.
3. The routing policy is explicit about local-first vs escalation.
4. The fitness loop is explicit about golden sets, regression cadence, and promotion gates.
5. The tooling decision is explicit about whether the first lane can remain artifact-only.
6. The local controller contract is explicit if tools are required.
7. The recommendation does not position local models as full replacements for frontier review.
8. The final result includes a clear next implementation slice if the lane is worth pursuing.

Final response must include:
- changed files
- shortlist summary
- benchmark summary
- routing decision summary
- fitness-loop summary
- tooling-readiness summary
- local-controller summary
- validations run
- final recommendation
```

## Prompt 2: Explorer A - Hardware, Runtime, and Storage Fit

```text
You are a read-only subagent.

Purpose:
Determine the practical local-runtime constraints and opportunities for running verifier-oriented local models on this machine.

Read:
- `_dev/concepts/local-model-verification-lane.md`
- `_dev/research/local-model-verification-lane/02_mythos_local_model_verification_lane_design_report.md`
- `_dev/research/local-model-verification-lane/03_continuous_model_fitness_assessment_for_local_llms_on_apple_silicon.md`
- `_dev/SIMPLEMINIONS_ROUTING_INTEGRATION_IMPLEMENTATION_PLAN.md`
- any local machine/runtime observations available in the repo or task context

Return exactly these sections:

Findings
- what hardware/runtime assumptions are already established
- what runtime surfaces are plausible (Ollama, MLX/MLX-LM, other)
- what storage assumption should be used for the locally bound `MYTHOS_STORAGE_ROOT`

Planning implications
- realistic model size bands
- likely runtime constraints
- any runtime or storage caveats that must be explicit in the plan

Risks
- overestimating usable model size
- assuming storage-path support without verification
- confusing “can load” with “is usable at verifier latency”

Do not edit files.
```

## Prompt 3: Explorer B - Model Shortlist and Benchmark Source Inventory

```text
You are a read-only subagent.

Purpose:
Build a bounded research inventory for candidate local models and the benchmark/leaderboard sources that should inform selection.

Read:
- `_dev/concepts/local-model-verification-lane.md`
- `_dev/research/local-model-verification-lane/01_perplexity_prompt_and_report.md`
- `_dev/research/local-model-verification-lane/02_mythos_local_model_verification_lane_design_report.md`
- `_dev/research/local-model-verification-lane/03_continuous_model_fitness_assessment_for_local_llms_on_apple_silicon.md`
- the task context for evaluation criteria
- any linked research summaries already captured in the repo

Return exactly these sections:

Findings
- likely candidate model bands for this use case
- likely benchmark sources that matter
- which sources are useful for reasoning, coding, instruction-following, tool use, and deployability
- what ongoing fitness-evaluation tooling or workflow patterns are worth adopting as design inputs

Planning implications
- the smallest credible candidate set to test first
- what should be excluded from the first round
- what benchmark signals are useful vs misleading
- what parts of the continuous-fitness loop should be in the first implementation slice versus follow-on

Risks
- chasing too many models
- over-weighting leaderboard popularity
- selecting models that fit hardware but not the verification task

Do not edit files.
```

## Prompt 4: Explorer C - Mythos Task-Shape and Benchmark Example Inventory

```text
You are a read-only subagent.

Purpose:
Define what real Mythos verification tasks should populate the benchmark.

Read:
- `_dev/concepts/local-model-verification-lane.md`
- `tools/verify/README.md`
- relevant verification and analysis docs already present in the repo

Return exactly these sections:

Findings
- which recurring Mythos tasks are good local-verifier candidates
- which tasks are too risky or ambiguous for local-first review
- what artifact shapes the benchmark should include

Planning implications
- recommended benchmark task classes
- recommended pass/fail and escalation labels
- what should count as strong evidence that a local model is “good enough”

Risks
- building a benchmark from unrealistic toy examples
- allowing the benchmark to reward verbosity instead of correctness
- failing to include escalation-worthy cases

Do not edit files.
```

## Prompt 5: Worker - Draft the Research Pack

```text
Implement the local-model verification lane research pack.

Ownership:
- `_dev/research/local-model-verification/01_model_shortlist.md`
- `_dev/research/local-model-verification/02_benchmark_definition.md`
- `_dev/research/local-model-verification/03_runtime_and_storage_plan.md`
- `_dev/research/local-model-verification/04_routing_and_escalation_policy.md`
- `_dev/research/local-model-verification/05_recommendation.md`
- `_dev/research/local-model-verification/06_fitness_ops_plan.md`
- `_dev/research/local-model-verification/07_tooling_readiness.md`
- `_dev/research/local-model-verification/08_local_controller_contract.md`

You are not alone in the codebase. Do not revert edits by others.

Task:
- synthesize the subagent findings
- keep the candidate set bounded
- define the benchmark, scoring rubric, and escalation policy
- make the storage/runtime plan explicit
- define the continuous-fitness loop
- define the tooling-readiness position
- define the local controller contract if tools are needed
- end with a clear recommendation

Constraints:
- do not implement provider code in this run
- do not broaden this into a generic local-agent platform design
- do not claim local models can replace frontier review globally
- keep the deliverables specific to verification/review work
- do not treat secondary-source ops tooling suggestions as hard requirements without labeling them as design inputs

Final response must include:
- changed files
- final candidate shortlist
- benchmark definition summary
- routing/escalation summary
- fitness-ops summary
- tooling-readiness summary
- local-controller summary
- key open questions
```

## Prompt 6: Validator - Verification Loop

```text
You are a read-only validation subagent.

Purpose:
Validate the local-model verification research pack before final acceptance.

Read:
- `_dev/research/local-model-verification/01_model_shortlist.md`
- `_dev/research/local-model-verification/02_benchmark_definition.md`
- `_dev/research/local-model-verification/03_runtime_and_storage_plan.md`
- `_dev/research/local-model-verification/04_routing_and_escalation_policy.md`
- `_dev/research/local-model-verification/05_recommendation.md`
- `_dev/research/local-model-verification/06_fitness_ops_plan.md`
- `_dev/research/local-model-verification/07_tooling_readiness.md`
- `_dev/research/local-model-verification/08_local_controller_contract.md`
- `_dev/concepts/local-model-verification-lane.md`

Return exactly these sections:

Findings
- whether the candidate set is bounded and realistic
- whether the benchmark uses real Mythos task shapes
- whether the routing policy is explicit enough
- whether the storage/runtime assumptions are honest
- whether the fitness loop is realistic and proportionate
- whether the tooling decision matches the actual task requirements
- whether the local controller contract is narrow and enforceable enough

Required corrections
- exact issues that must be fixed before acceptance

Verification verdict
- pass
- pass with notes
- fail

Do not edit files.
```

## Prompt 7: Completion Auditor

```text
You are a read-only completion-auditor-style subagent.

Purpose:
Audit whether the local-model verification lane research pack is execution-ready.

Read:
- the six deliverable docs
- the eight deliverable docs
- the validator output
- `_dev/policies/prompt-pack-contract.md`

Return exactly these sections:

Acceptance criteria status
- criterion by criterion

Findings
- blockers
- warnings
- info

Closeout
- whether the pack is ready for execution follow-on
- the exact recommended next command or next task

Do not edit files.
```
