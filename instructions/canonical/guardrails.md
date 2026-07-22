# Canonical Guardrails

This file is the harness-neutral policy source. Harness outputs should preserve these semantics.

## Non-negotiable Rules

1. Never expose credentials, tokens, API keys, PII, or `.env` data.
2. Never place client-specific values in reusable framework definitions.
3. Enforce execution modes exactly as declared.
4. Use observational reporting (observations + hypotheses), never prescriptive diagnoses.
5. Confirm before destructive operations.

## Execution Modes

Each mode defines hard boundaries on what an agent may do. These are not suggestions.

- `FINDINGS_ONLY`: No file writes. No shell execution. No side effects. Read, analyze, report.
- `RUN_ONLY`: Execute collection scripts and test runs. Write reports and logs only. Never modify source files, configs, or framework definitions.
- `REVIEW_ONLY`: Read and analyze existing outputs. Write analysis artifacts (summaries, diffs, comparisons) only. No execution of external commands.
- `PATCH_ALLOWED`: Make minimal, scoped changes with explicit justification per change. Every write must cite the finding it addresses. No refactors, no drive-by fixes.
- `COORDINATOR`: Orchestrate sub-workflows by delegating to subagents. The coordinator itself does not write files or execute commands directly — it delegates and validates.
- `REPO_HYGIENE`: Update documentation, navigation files, and indexes only. No source code, config, or framework definition changes.

Violation of a declared mode is a critical failure. If you are uncertain whether an action is permitted, stop and ask.

## Observational Reporting

All findings must use observational language:

- **State observations, not diagnoses.** Say "the login form submits but the page returns a 422 response" not "the login form is broken."
- **Separate observation from hypothesis.** Present what was observed first, then offer possible explanations as hypotheses.
- **Never prescribe root cause as fact.** Use "this may indicate," "one possible explanation is," or "consistent with" — never "this is caused by."
- **Cite evidence for every claim.** Every observation must reference a file path, URL, log line, screenshot, or test output.

### Forbidden Labels

These terms must never appear as section headers, labels, or framing devices in reports or findings:

| Forbidden Term | Replace With |
|---|---|
| `Root Cause:` | `**Observation:**` + `**HYPOTHESIS:**` |
| `Diagnosis:` | `**Observation:**` + `**HYPOTHESIS:**` |
| `Recommendation:` | `**Open Questions for Review:**` |
| `Action Required:` | `**Open Questions for Review:**` |
| `Fix:` | `**Observation:**` (describe what was observed, not what to do) |
| `Confidence Level:` | Remove entirely — let evidence speak |
| Priority labels (`P0`, `P1`, `P2`) | Use severity classification (CRITICAL, MAJOR, MINOR, INFO) |
| Time estimates | Remove entirely — do not estimate resolution time |

### Required Labels

Reports and findings must use these structured labels:

- **`Observation:`** — Factual description of what was seen, with evidence citation
- **`HYPOTHESIS:`** — Labeled interpretation, explicitly marked as non-definitive, with supporting evidence
- **`Cross-Source Pattern:`** — Factual comparison across multiple data sources (runs, environments, artifacts)
- **`Open Questions for Review:`** — Questions that require domain expertise or additional context to answer
- **`Evidence Locations:`** — File paths and line numbers supporting the observation

## Evidence Standards

All reports and findings must meet these evidence requirements:

- **File references** use `path/to/file:line_number` format.
- **Test results** cite the run ID, test name, and exact pass/fail output.
- **Screenshots** are referenced by their output path and linked to the step that produced them.
- **Log entries** include timestamp and source context.
- **Comparisons** (before/after, expected/actual) present both sides with source citations.
- **No unsupported claims.** If evidence is unavailable, state "unable to verify — [reason]" rather than guessing.

## File Modification Rules

When a mode permits writes, these constraints still apply:

- **Scope:** Only modify files directly related to the current task. No drive-by improvements.
- **Justification:** Every file write must cite the finding, requirement, or prompt step that necessitates it.
- **Client isolation:** Never write client-specific data (names, URLs, credentials, business logic) into framework files under `frameworks/`.
- **Framework integrity:** Framework files are templates. Client-specific values belong in project directories under `clients/` or in external workspace repos.
- **Atomicity:** Complete a logical unit of work before moving to the next. Do not leave files in a half-written state.
- **Reversibility:** Prefer additive changes over destructive ones. When removing content, confirm with the user first.

## Data Safety

- **Credentials and secrets:** Never read, log, echo, or write `.env` files, API keys, tokens, passwords, or connection strings. If a task requires credential access, stop and instruct the user to provide it through a secure mechanism.
- **PII:** Never include personal names, emails, phone numbers, or addresses in framework files, reports, or logs unless the task explicitly requires it and the output is scoped to the client's project directory.
- **Client data boundaries:** Client-specific data must only exist in `clients/{CODE}/` directories or external workspace repos. Framework directories must remain generic and reusable.
- **Output sanitization:** Before writing any report or artifact, verify it contains no credentials, PII, or client-identifying information that could leak across projects.

## Subagent Orchestration & Completion Auditing

### When to Use Subagents

Scoped subagent orchestration is encouraged when it materially improves correctness — for example, parallelizing independent validation checks, delegating specialized analysis, or isolating concerns during multi-step implementation tasks.

Subagent usage must remain bounded:

- Prefer a small number of focused subagents over broad parallelization.
- Each subagent must have a declared purpose, mode, and tool set.
- Do not create recursive or open-ended agent spawning patterns.
- Trivial, read-only, or single-file tasks do not require subagent orchestration.

### Subagent Autonomy Policy

All subagents are spawned with `mode: "auto"` — they execute autonomously without interactive permission prompts. The orchestrator (the calling agent) retains interactive control at gate boundaries and escalation points.

**Safe for autonomous execution (no interactive gating required):**

| Operation | Agent | Risk Level | Rationale |
|---|---|---|---|
| Framework structure audit | `framework-auditor` | None | Read-only tools (Read, Grep, Glob); no write capability |
| Output review | `output-reviewer` | None | Read-only tools; no write capability |
| Completion audit | `completion-auditor` | None | Read-only tools; no write capability |
| Capture normalization | `capture-normalizer` | Low | Writes only to the capture bundle's own metadata files |
| Prompt execution | `framework-executor` | Medium | Write-capable; constrained by declared execution mode |
| Skill extraction | `extract-skill-agent` | Medium | Write-capable; constrained to new files in declared paths |

**Requires explicit user gating (never auto-execute):**

| Operation | Reason |
|---|---|
| Framework promotion | Irreversible structural change to the learning-language-models repo |
| Client data deletion | Destructive operation on user data |
| Credential or secret access | Safety-critical; must be user-initiated |
| Scope expansion beyond declared task | Prevents runaway agent behavior |

**Parallel subagent rules:**

1. **Explicit opt-in only.** Parallel execution must be declared in the workflow or manifest (e.g., `parallel_safe: true`). Never infer parallel safety from structure or array length.
2. **Disjoint write scope.** Each parallel subagent must write to a distinct set of files. If write scopes overlap, use sequential execution or provide an explicit orchestrator merge step.
3. **Atomic result merging.** When parallel subagents produce results that must be combined (e.g., run_state.json), the orchestrator performs a single atomic merge after all subagents complete. Subagents never write directly to shared state.
4. **Bounded concurrency.** Do not spawn more than 11 concurrent subagents (one per registered framework is the current maximum).
5. **Failure isolation.** If one parallel subagent fails, the others continue. The orchestrator collects all results (including failures) and reports them together.
6. **No recursive spawning.** A subagent must not spawn its own subagents. Only the top-level orchestrator may create subagents.

### Completion Auditing

Substantial implementation tasks (multi-file changes, new features, refactors, framework modifications) must undergo a completion audit before being declared done.

**Completion audit requirements:**

1. After implementation work is finished and tests/validators have run, invoke the `completion-auditor` subagent.
2. The auditor evaluates claimed completion against:
   - Acceptance criteria explicitly stated in the task
   - Required files added or modified as intended
   - Test and validation results (pass/fail with evidence)
   - Non-goals and scope boundaries respected
   - No blocker-level required work remaining
3. The auditor classifies findings as **blocker**, **warning**, or **info**.

**Reopen semantics:**

- **Blocker** findings require reopening: fix only the specific unmet items, then re-run the completion audit.
- **Warning** and **info** findings do not trigger reopen unless they violate explicit acceptance criteria.
- A maximum of two reopen cycles is permitted. If blockers persist after two fix-and-reaudit cycles, escalate to the user rather than looping further.

**Completion evidence:**

Final completion must be based on concrete evidence, not self-assessment:
- Changed files (list of paths)
- Passing tests or validator output
- Acceptance criteria satisfied (cited per criterion)
- Scope respected (non-goals not introduced)

Evidence, not opinion, determines completion.

### Exemptions

Completion auditing is not required for:
- Read-only operations (FINDINGS_ONLY, REVIEW_ONLY modes)
- Single-file documentation updates (REPO_HYGIENE mode)
- Status queries and inventory checks
- Tasks where the user explicitly waives audit

## Major Sequence Closeout

Major integrated implementation sequences require a formal closeout before the operator is told to clear context.

A major integrated sequence includes work where multiple frameworks, commands, prompt packs, workflows, or overarching system flows materially interacted.

### Closeout Order

The required order is:

1. Produce a durable debrief artifact.
2. Produce a post-session learning/reflection artifact when warranted.
3. Run validation appropriate to the changed surfaces and integration seams.
4. Decide whether the sequence is ready for clear.

### Debrief Requirements

The debrief artifact must include:
- sequence scope
- participating frameworks/workflows/system flows
- primary outcome
- changed files
- validation run
- artifacts created
- deferred items
- recommended next tracked action

### Reflection Requirements

Post-session learning/reflection is required when the sequence involved:
- substantial planning or orchestration
- new prompt-pack or system-rule authoring
- major operator-UX friction
- harness-truth mismatches
- a material change to the system model

### Validation Requirements

There must be a real validation step before a major integrated sequence is declared ready for clear.

- Validate the touched surfaces directly.
- If multiple frameworks, workflows, or system flows interacted, include at least one integration-seam validation.
- If validation is partially not applicable, state that explicitly with a reason rather than skipping it silently.

### Durable Artifact Requirement

Every closeout artifact must be written to a durable on-disk location within your project's reports directory. Temp-only state, conversation-only summaries, and ephemeral outputs do not satisfy closeout requirements.

No closeout step is complete until its artifact exists on disk somewhere the next session or a reviewer can find it without relying on chat memory.

### Closeout Artifact Contract

Each major sequence closeout must produce at minimum:

1. **Debrief report** — sequence scope, what changed, what was validated, what's next
2. **Validation evidence** — what was checked and the result, recorded alongside the debrief

Adopt one consistent location and naming convention for these artifacts within your project (for example, a `reports/` directory with a per-sequence identifier) so anyone picking up the work later can find them by convention rather than by asking.

### Intermodel Coordination Artifacts

When a major sequence involves coordination between multiple models or actors, all coordination artifacts must be durable on disk. Conversation-only handoff state is insufficient — the next actor or session should be able to resume from files, not from a transcript.

### Clear-Readiness Rules

Do not declare a major sequence complete, or recommend ending the session, until all of the following are true:
- the debrief artifact exists on disk at a durable path
- the validation evidence artifact exists on disk at a durable path
- no hidden required operator action remains

If those conditions are met, the closeout should explicitly report that the sequence is complete and what's next.

If those conditions are not met, report what's still pending and why the sequence isn't ready to close.

## Harness Truthfulness

The model must be truthful about what the current harness actually supports.

### Rules

1. **If a capability is documented but not available in the current harness, say so immediately.** Do not proceed as if the capability exists.

2. **Do not simulate native support rhetorically.** If a command or integration is described in documentation but the current harness does not provide it natively, do not present fallback behavior as if it were the documented native behavior.

3. **Resolve through the harness's real mechanism.** When a documented capability is unavailable, state what is documented vs. what is available, identify the real resolution path, and proceed through the real mechanism.

4. **Command registration truth.** If a command exists in documentation but is not registered or resolvable in the current harness, report the mismatch.

5. **Adapter vs. native distinction.** Harness adapters (`instructions/adapters/`) are the source of truth for what a specific harness supports, not the canonical operation inventory alone.

## Mode Checklists

Before beginning work in any mode, verify:

**FINDINGS_ONLY pre-flight:**
- [ ] Confirmed: no file writes planned
- [ ] Confirmed: no shell commands planned beyond read-only operations
- [ ] Output will be returned in response text only

**RUN_ONLY pre-flight:**
- [ ] Confirmed: execution targets are read from manifest/project config
- [ ] Confirmed: only reports and logs will be written
- [ ] Confirmed: no source file modifications planned

**REVIEW_ONLY pre-flight:**
- [ ] Confirmed: working from existing output artifacts
- [ ] Confirmed: only analysis artifacts will be written
- [ ] Confirmed: no external commands will be executed

**PATCH_ALLOWED pre-flight:**
- [ ] Each planned change has a cited justification
- [ ] Changes are minimal and scoped to the task
- [ ] No client data will be written to framework files

**COORDINATOR pre-flight:**
- [ ] Subagent roles and modes identified
- [ ] Each delegated step has a declared mode
- [ ] Coordinator will not write files directly

**REPO_HYGIENE pre-flight:**
- [ ] Only documentation, navigation, and index files will be touched
- [ ] No source code, configs, or framework definitions will change
