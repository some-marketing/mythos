# Board Conventions

Board workflow, column definitions, movement rules, and conventions for Mythos Dart boards.

This document is additive to [TASK_TYPES.md](./TASK_TYPES.md) and [WORKSPACE_LINKING.md](./WORKSPACE_LINKING.md). Task types, naming conventions, and workspace linking rules defined in those documents still apply.

---

## Three-Layer Model

| Layer | Surface | Purpose |
|-------|---------|---------|
| **Strategic / Execution Truth** | `planning/` plans, master run order, Git artifacts | Sequencing, rationale, architecture, implementation evidence |
| **Collaboration Truth** | Dart tasks, comments, assignments, decisions, status, priority | Human/agent conversation, ownership, visible work state, handoffs |
| **Evidence Truth** | Git commits, repo artifacts linked from Dart | Durable proof that work landed |

Dart and Git are paired sources of truth. Dart is the collaboration ledger: ownership, conversation, decisions, status, and handoff state live there first. Git is the execution and evidence ledger: plans, code, validation artifacts, and proof of completion live there and are linked back into Dart. Dart is not the orchestration runtime, and Git evidence is still required for real completion.

## Concept Registration Rule

Use `planning/concepts/` as the main trigger surface for early work that is no longer raw research but is not yet fully implementation-planned.

Create a Dart task only after the concept is sorted enough to track as a real workstream:
- stable concept title
- clear problem / why-now statement
- open questions worth tracking
- recommended next action

At that point, create a **parent Brief with no subtasks yet**:
- the Brief starts from the concept framing, open questions, and needs-before-starting sections
- subtasks come later, after the concept matures into a bounded implementation plan
- `planning/concepts/` and linked context files keep the deeper rationale and architecture
- the parent Brief becomes the operator-visible tracking object for status, handoff, ownership, and later subtasks

This means:
- `planning/` still holds strategic truth
- Dart still does not become the orchestration queue
- raw research, analysis artifacts, and chat-only discussion do not create tasks by themselves
- but concepts that are durable enough to steer future work should not stay invisible to the board

## Upcoming Work Visibility Rule

If a workstream is in the near-term plan, it should be visible on the board even before execution begins.

Use this pattern:
- create one parent Brief for the workstream
- include a concrete `Subtask Plan` section in the Brief description
- create actual child tasks when the subtasks are bounded enough to track individually

For the next upcoming tracks or planned slices:
- the parent Brief should exist early so the board shows what is coming
- the subtask plan should make the intended work visible even if some child tasks are not created yet
- when subtasks are already concrete enough, create the child tasks up front so the board reflects the expected workload

This keeps upcoming work visible without forcing vague planning lanes into fake execution tasks.

---

## Mythos Space Structure

Mythos has its own top-level Dart space with two dartboards.

| Dartboard | Scope | Primary Domains |
|-----------|-------|-----------------|
| **System** | Core infra, governance, lifecycle pipeline, instructions/adapters, cross-AI integration | Infra, Governance, Lifecycle, Instructions, Integration |
| **Frameworks** | Framework improvements, new frameworks, audits, prompt chain work | Framework (+ other domains as needed) |

Client project work stays on client dartboards (CLIENTA, CLIENTB, {CLIENT_CODE}, etc.). Strategic planning stays in `planning/`.

---

## Column Definitions

| Column | Dart Status | Definition | Entry | Exit |
|--------|-------------|------------|-------|------|
| **Proposed** | `To-do` | Created but not yet actionable. May need scoping, context, or dependency resolution. | Task created | Questions answered, context linked, dependencies identified |
| **Decision Needed** | `Decision Needed` | Blocked on a human stakeholder choice. Not blocked on capacity. | Open question requires human input, OR Design Decision created | Decision recorded in Dart task AND git context file |
| **In Progress** | `Doing` | Actively being worked on. Scope clear, context linked, no blocking decisions. | All preconditions met | All action items complete, deliverable committed |
| **Review** | `Review` | Work complete, awaiting verification, evidence linking, or sign-off. | Assignee declares work complete | Evidence linked, verification passed (if applicable) |
| **Done** | `Done` | Complete with linked repo evidence. Terminal state. | Evidence footer populated, all acceptance criteria met | Never exits. Rework = new task. |

---

## Transitions

```
Proposed --> Decision Needed --> In Progress --> Review --> Done
   |                                  |
   +-----> In Progress (no decision needed)
                                      |
                          Decision Needed (unexpected blocker)
                                      |
                   Review --> In Progress (review finds incomplete work)
```

### Forward Movement
- **Proposed -> Decision Needed:** An open question requires stakeholder input before work can begin.
- **Proposed -> In Progress:** Open Questions section is empty or "(none)" and Needs Before Starting is fully checked off.
- **Proposed -> Review:** Allowed only for Documentation tasks where the document already exists and only needs linking/sign-off.
- **Decision Needed -> In Progress:** Decision recorded in the Decision Log and in the git context file.
- **In Progress -> Review:** All action items complete, deliverable committed to repo.
- **Review -> Done:** Evidence footer populated, acceptance criteria met, verification passed (if applicable).

### Reverse Movement
Reverse movements are allowed but must be documented:

- **Review -> In Progress:** Review reveals incomplete work. Only the specific task moves back; siblings are unaffected.
- **In Progress -> Decision Needed:** Unexpected blocker requires stakeholder input. Only the blocked task moves; other children continue. Parent re-evaluates column.
- **Decision Needed -> Proposed:** Decision reveals fundamental rescoping. Rare.

**Never reverse from Done.** If rework is needed after Done, create a new task referencing the original: "Rework of [original title] (dart:{originalId})".

A task in **Review** that fails evidence validation moves back to **In Progress** (not to a new task). A new task is only needed if the scope has fundamentally changed.

---

## Subtask Movement

Subtasks move independently through columns based on their own state:

| From | To | Trigger |
|------|----|---------|
| Proposed | In Progress | Scope clear, context linked |
| Proposed | Decision Needed | Open question requires stakeholder input |
| Decision Needed | In Progress | Decision recorded |
| In Progress | Review | All action items complete, deliverable committed |
| Review | Done | Evidence linked, acceptance criteria met |

---

## Parent Movement (Derived)

Parent task column reflects the collective state of children. Parent movement is derived, not independently set. When a child moves, re-evaluate the parent's column.

| Parent Column | Condition |
|---------------|-----------|
| **Proposed** | Subtasks not yet defined |
| **Decision Needed** | Parent has an open question blocking subtask creation, OR any child is in Decision Needed |
| **In Progress** | At least one child is In Progress, no children in Decision Needed |
| **Review** | All children are in Review or Done; none in Proposed/Decision Needed/In Progress |
| **Done** | All children Done with evidence linked; decision log complete |

### Three-Level Derivation (Owner Summary -> For X -> Implementation)

For owner-facing client deliverables the tree has three levels: an **Owner Summary** (`owner_summary`) parent, a **For X** (`for_grouping`) grouping per contributor, and the implementation/verification/etc. tasks nested under each `For X`. (See [TASK_TYPES.md](./TASK_TYPES.md) types 7 and 8 and the Client-Deliverable Hierarchy section there.) Column derivation rolls up through each level:

- A **For X** grouping derives its column from its own children (the implementation tasks under it), using the same table above with the `For X` standing in for "parent."
- The **Owner Summary** derives its column from its `For X` groupings (treating each `For X` as a child), again using the same table.

So a child movement re-evaluates its `For X` first, and the `For X`'s resulting column then re-evaluates the Owner Summary. With a single contributor and no `For X` layer, the Owner Summary derives directly from its implementation children, exactly like an ordinary parent.

### Brief-to-Parent Transition

A Brief becomes a parent task at the moment the first subtask is created. Prerequisites:

1. All Open Questions are answered and recorded in the Decision Log
2. The Subtask Plan section is populated with planned children
3. The assignee (or coordinator) confirms the subtask definitions

The Brief moves from Proposed to In Progress when the first subtask is created. It does NOT move to In Progress before subtasks exist.

**Owner Summary as parent (client deliverables).** When the work has a distinct owner/stakeholder audience separate from the implementers, the parent is an **Owner Summary** (`owner_summary`) rather than a Brief, and the Brief's per-person questions distribute into the `For X` (`for_grouping`) groupings. The same transition logic applies: the Owner Summary moves from Proposed to In Progress once its first child exists (its first `For X` grouping when 2+ people contribute, or its first implementation child when a single contributor needs no `For X` layer). The Brief shape still applies to non-deliverable and internal work; the Owner-Summary shape is the client-deliverable form of the same parent transition.

### Parent Completion Rule

A parent task moves to Done only when ALL of the following are true:

- Every child task is Done with evidence linked
- The parent's Decision Log has no unresolved entries
- The parent's context file (if it exists) reflects all decisions

**Deferred subtasks:** If a subtask must be deferred (e.g., documentation can wait), the parent's Decision Log must record the deferral with approval. The deferred subtask moves to a new parent Brief or becomes a standalone task. The original parent can then move to Done.

### Parent Column State Override

If a parent is manually moved to a column that contradicts its children's state:

1. A Dart task description edit MUST document the override reason
2. The override is temporary — re-evaluate parent state at the next child movement
3. Overrides should be rare. If they happen often, the parent's scope is likely wrong — consider splitting it.

---

## Parent Task Template

**Title:** Descriptive noun phrase (outcome, not verb-first)
- Good: "Artifact Retention and Compaction Model"
- Avoid: "Implement artifact compaction"

**Dart properties:** Type: Project | Status: To-do | Priority: per priority model below

```markdown
## What and Why

[1-3 paragraphs: what this workstream delivers and why it matters now.
Reference the planning doc.]

## Open Questions

1. [Question that must be answered before subtasks can be scoped]
2. [Architectural trade-off or sequencing question]

## Needs Before Starting

- [ ] [Input, evidence, or research required]
- [ ] [Dependency on another task or planning doc]

## Decision Log

### {Date} -- {Summary}
- **Decision:** {what}
- **Decided by:** {who}
- **Context:** {why}
- **Impact:** {what changes}

## Subtask Plan

1. {Verb + object + context} -- {task type}
2. {Verb + object + context} -- {task type}

---
**Plan:** [{filename}.md](https://github.com/{org}/{repo}/blob/main/planning/{file}.md)
**Context:** [{slug}.md](https://github.com/{org}/{repo}/blob/main/projects/{project}/tasks/{file}.md)
```

The `**Plan:**` footer bridges Layer 1 (`planning/` plans) to Layer 2 (Dart tasks). See [WORKSPACE_LINKING.md](./WORKSPACE_LINKING.md) for full footer conventions.

---

## Subtask Template

**Title:** Verb + object + context
- Good: "Add learning-ledger schema to workspace tooling"

**Dart properties:** Type: Subtask | Status: To-do | Priority: per priority model below

```markdown
[1-2 sentences: what to do and current state.]

## Action Items

- [ ] [Specific executable step]
- [ ] [Specific executable step]

## Acceptance Criteria

- [ ] [Observable, testable condition]
- [ ] [Observable, testable condition]

---
**Context:** [{slug}.md](https://github.com/{org}/{repo}/blob/main/projects/{project}/tasks/{file}.md)
**Evidence:** [{file}](https://github.com/{org}/{repo}/blob/main/{path}) (populated on completion)
```

No "Questions" section. If a subtask has open questions, it stays in Decision Needed until resolved.

---

## Parent vs Subtask Rules

**Must be a parent (Brief) when ANY are true:**

1. Produces more than one independently completable deliverable
2. Spans more than one task type (implementation + verification + documentation)
3. Requires a decision before work can be scoped
4. Corresponds to a `planning/` planning document
5. Involves coordination across multiple harnesses or sessions

**Must be a subtask when ALL are true:**

1. Has exactly one verb and one done state
2. One person or one harness session can complete it
3. Scope is fully determined — no open questions remain
4. Produces a single type of artifact

**Edge cases:**

- If unsure, make it a parent (cheaper to collapse than to extract)
- A Brief that needs no subtasks can be closed directly — add a note to the description explaining why
- Design Decision tasks are never parents — always standalone or children of a Brief

---

## Priority Model

| Priority | Mythos Definition | When to Use |
|----------|-----------------|-------------|
| **Critical** | Blocks other active work | Dependency blockers, broken tooling, schema violations |
| **High** | Must be done in the current implementation slice | Active plan phases, current critical path |
| **Medium** | Should be done in current or next slice | Non-critical phases, improvements from execution, documentation |
| **Low** | Desirable but deferrable indefinitely | Nice-to-haves, exploratory investigations, future-proofing |

**Parent/child priority rules:**

- Parent priority = maximum of children's priorities
- Children can be lower priority than parent
- If a child exceeds parent priority, raise the parent to match
- Re-evaluate parent priority when a child is created or when a child's priority changes (manual step during task review)

---

## Domain Model

Domain is a **custom multi-select property** on Mythos tasks. It answers "what part of the system does this touch?" — not "what kind of work?" (that is the task type) or "how urgent?" (that is priority).

| Domain | Meaning |
|--------|---------|
| `Infra` | Core tooling, scripts, schemas, workspace scaffold |
| `Framework` | Framework definitions, prompts, manifests, guardrails |
| `Instructions` | Canonical instructions, adapters, harness parity |
| `Lifecycle` | Capture, candidate, replay, promotion pipeline |
| `Governance` | Agents, skills, execution modes, safety rules |
| `Integration` | MCP connections, external tool bridges, AI-bridge |

**Cardinality:** A task may have up to two domains. More than two usually signals the task scope is too broad — consider splitting.

**Why a custom property, not tags:** Domain is scoped to Mythos boards as a dedicated field. It does not pollute the workspace-wide tag list shared with client boards. It shows up as a groupable/colorable column in board layouts.

**Not included (by design):**

- No `Planning` domain — planning stays in `planning/`, not on the board
- No `Verification`/`Documentation` domains — those are task types
- No `Bug`/`Enhancement` domains — covered by task types (Investigation, Implementation)
- No phase domains — those are columns

---

## Evidence Footer Population Protocol

When moving a task from Review to Done, the assignee (human or harness) must:

1. Edit the Dart task description to populate the `**Evidence:**` footer
2. Use format: `**Evidence:** [{short hash}]({GitHub commit URL})` for code, or `**Evidence:** [{filename}]({GitHub blob URL})` for artifacts
3. If multiple evidence items exist, list each on the same line separated by `, `
4. The Evidence footer must be populated BEFORE the status is changed to Done
5. A task without a populated Evidence footer cannot be moved to Done

This protocol is enforceable by external GPTs: they can check whether the Evidence footer is non-empty before treating the task as complete.

---

## Commit-to-Task Convention

- Commit messages should reference the Dart task ID for searchability: `(dart:{dartId})`
- For verification tasks, link verification signal JSON as evidence
- The Evidence footer in the Dart task closes the loop: it points from Dart back to the repo artifact that proves completion

---

## Comment Conventions

Comments are the **inter-actor coordination log**. They record what happened operationally so that any actor (human, Claude, Codex, external GPT) reading the task via MCP can understand current state without needing repo access.

### Three Surfaces, Three Roles

| Surface | Role | Who reads it |
|---------|------|-------------|
| **Description** | Task definition (what to do, acceptance criteria, footers) | Everyone |
| **Comments** | Coordination log (what happened, handoffs, evidence, blockers) | LLMs via MCP, humans in Dart |
| **Git context file** | Decision truth + deep technical context | LLMs with repo access |

### Comment Templates

**Handoff** — when one actor finishes and another should pick up:

```
## Handoff
Actor: {name or harness}
Status: {what was completed}
Evidence: [{ref}]({URL})
Next: {what the next actor should do}
```

**Blocked** — when work cannot proceed:

```
## Blocked
Actor: {name or harness}
Blocker: {what is blocking}
Needs: {who or what can unblock}
```

**Evidence** — when linking verification results:

```
## Evidence
Actor: {name or harness}
Verdict: {VERIFIED, VERIFIED_FIXED, etc.}
Evidence: [{ref}]({URL})
```

### Comment Rules

1. **Short and factual.** Comments are operational signals, not discussion threads. One to three lines preferred.
2. **No decisions in comments.** If a comment contains a decision, it must also be recorded in the parent's Decision Log in the git context file. Comments feel ephemeral even though they are permanent — decisions need the durable surface.
3. **Handoff comments are encouraged.** When one actor finishes and another needs to pick up, a comment is the right signal.
4. **Evidence comments during Review.** When populating the Evidence footer, add a comment noting what was verified and the result. This creates an audit trail readable via MCP.
5. **Do not use comments for deep technical context.** That belongs in the git context file. Comments should be scannable, not comprehensive.
