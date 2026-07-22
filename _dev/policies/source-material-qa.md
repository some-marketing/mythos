# Source Material QA Policy

Policy for evaluating when `_dev` documents are mature enough to become prompt packs,
system rules, or other durable operating guidance.

## Source-Status Ladder

Every document under `_dev/` that may feed prompt packs or system rules carries one of
these statuses:

### 1. `exploratory`

Useful thinking, but not ready to elevate.

Characteristics:
- may contain open questions without resolution paths
- provenance (where the ideas came from) is incomplete or absent
- may have unresolved contradictions between sections or with other docs
- may mix speculation with observation without distinguishing them
- appropriate for `_dev/research/`, early `_dev/concepts/` drafts, and session notes

### 2. `reviewed`

Provenance and primary inputs are captured. Open questions and conflicts are explicit.

Characteristics:
- the document states where its ideas come from (sessions, research, prior docs, operator decisions)
- open questions are listed, not hidden
- conflicts with other documents are acknowledged rather than silently collapsed
- useful for continued planning but not yet ready for durable promotion
- usually a good fit for mature `_dev/concepts/` documents

### 3. `promotion_ready`

Source has enough provenance, specificity, and actionability to author prompts or
system rules safely.

Characteristics:
- provenance is explicit and traceable
- remaining uncertainty is bounded and documented
- the document identifies what it promotes into (prompt pack, system rule, command, policy)
- open questions are either resolved or explicitly scoped as "acceptable remaining uncertainty"
- a reviewer can distinguish what is settled from what is still judgment
- the document has a recommended next action

### 4. `promoted`

The source has already been used to author prompt packs, system rules, or equivalent
durable assets.

Characteristics:
- downstream artifacts are explicitly linked (which prompt pack, which policy, which command)
- the source document itself may still be useful as reference but its actionable content has been absorbed
- further changes to the source should trigger a review of whether downstream assets need updating

## Minimum Source-Document Contract

Any document that is a candidate for promotion should eventually declare these sections:

| Field | Purpose |
|---|---|
| **Purpose** | What the document is for and why it exists |
| **Provenance** | Where the ideas come from: sessions, research, operator decisions, prior docs |
| **Key observations / decisions** | The substantive content that would feed durable assets |
| **Open questions / unresolved conflicts** | What is not yet settled, including conflicts with other docs |
| **Promotion targets** | What durable assets this document could become (prompt pack, policy, command, etc.) |
| **Recommended next action** | What should happen next with this material |
| **Current status** | One of: `exploratory`, `reviewed`, `promotion_ready`, `promoted` |

The first rollout should tolerate legacy docs that do not yet use this exact
structure. New promotion-candidate docs should move toward it.

## Concept Layer Lifecycle

The intended lifecycle from raw thinking to durable system assets:

```
research -> concept -> tracked task -> implementation plan -> subtasks -> evidence
```

### 1. Research (`_dev/research/`)

Raw findings, observations, logs, and session output.

Rules:
- does not create a tracked task by itself
- does not feed prompt authoring directly
- may feed concept development

### 2. Concept (`_dev/concepts/`)

Synthesized thinking with open questions.

Rules:
- should explain what the concept is, why it matters, and what is unresolved
- this is the first durable layer that can justify a future tracked task
- one concept should map to one parent task (one-concept-one-parent rule)

### 3. Parent Task (external tracker, if used)

A board-visible tracking object.

Trigger rules for creating a parent task:
- the concept has a **stable title** (not changing between sessions)
- the concept states a **clear problem / why-now**
- the concept has **open questions worth tracking**
- the concept has a **recommended next action**

When those conditions are met:
- create one parent task with no subtasks yet
- keep deeper rationale in the concept doc
- use the tracker for priority, status, and handoff visibility

### 4. Implementation Plan (`*_IMPLEMENTATION_PLAN.md`)

Bounded execution planning.

Rules:
- should enrich the same parent task, not create a second parent task
- this is where work becomes scoped enough to estimate and execute

### 5. Subtasks (tracker child tasks)

Created only when work is scoped enough to execute or review in bounded slices.

### 6. Evidence

Git commits, `_dev/reports/analysis/`, `_dev/reports/signals/`, and tracker evidence
footers close the loop.

## One-Concept-One-Parent Rule

One concept or workstream should map to one parent task.

New documents should usually attach to the same parent task:
- concept docs
- implementation plans
- architecture docs
- prompt packs

Those docs deepen or operationalize the workstream. They should not automatically
create duplicate parent tasks.

## What Creates a Parent Task vs What Does Not

### Creates or updates a future parent task:
- a concept doc under `_dev/concepts/` that meets the trigger rules
- an implementation plan that matures an existing concept
- an architecture doc that defines an active workstream rather than only reference context

### Does NOT create a parent task by itself:
- raw research in `_dev/research/`
- review outputs in `_dev/reports/analysis/`
- signal artifacts in `_dev/reports/signals/`
- run logs, test artifacts, or executed runbooks

Chat or session assessments matter when they are rewritten into `_dev/concepts/` as
actionable concept material.

## Structural Validation vs Human Judgment

### Can be checked structurally (now or in the future):
- presence of required sections from the minimum source-document contract
- whether provenance is stated (has a provenance section with content)
- whether open questions are listed
- whether a current status is declared
- whether promotion targets are identified
- whether downstream links exist for `promoted` documents
- whether the document follows naming conventions

### Requires human judgment (remains manual):
- whether provenance is actually trustworthy and sufficient
- whether open questions are the right ones
- whether conflicts are correctly characterized
- whether the document is specific enough to promote safely
- whether the recommended next action is appropriate
- whether the concept is ready for a parent task
- timing of promotion relative to other priorities

The QA process should surface structural gaps but never auto-promote. Promotion timing
remains a human decision until enough real examples prove which structural signals
reliably predict readiness.

## Applying This Policy

### For new documents

When creating a new document in `_dev/concepts/` or `_dev/` planning surfaces:
- include the minimum source-document contract fields
- set an initial `Current status` from the source-status ladder
- state provenance explicitly

### For existing documents

Do not retrofit every existing document. Instead:
- assess specific documents when promotion is being considered
- curate a small pilot set of promotion candidates first
- let the contract fields become standard practice through new documents rather than mass retrofitting

### For prompt authoring

Before authoring a prompt pack from a source doc:
- check whether the source has been reviewed for promotion readiness
- if the source is `exploratory`, consider whether it needs more development before becoming a prompt pack
- if the source is `reviewed`, note what open questions remain and whether they affect the prompt pack's correctness
- source readiness is a consideration, not a hard gate

## Deferred Work

The following are intentionally deferred until more real examples exist:

- repo-wide retrofitting of existing `_dev/` documents
- machine-readable source-status metadata (YAML frontmatter, JSON sidecar)
- automated promotion-timing decisions
- code-level structural validation beyond a prompt-led QA pass
- a formal promotion-candidate registry
- semantic scoring or confidence levels
