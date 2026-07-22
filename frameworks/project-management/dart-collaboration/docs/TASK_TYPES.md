# Task Types

This document defines eight task types for Dart boards. Each type has a title convention, description template, and decision signal. Use the decision table at the bottom to choose the right type.

---

## 1. Brief

A collaborative brief that gathers stakeholder input before work begins. Briefs become parent tasks once decisions are made and subtasks are created.

**Title:** Descriptive noun phrase (outcome or topic, NOT verb-first)
- Good: "Payment Estimate Displayed on Simple Grid"
- Good: "Inventory View Layouts"
- Avoid: "Implement payment estimate on grid view"

**Dart properties:** Type: Task or Project | Status: To-do | Assignee: first responder (the person whose questions come first)

**Description template:**

```markdown
## Issue At Hand
[1-3 paragraphs: what's going on, why it matters. Include inline images/mockups
if visual. Keep it conversational — this is a brief for humans, not a spec.]

## Questions For [Name]
1. [Question that needs their specific expertise]
2. [Question that needs their specific expertise]

## Questions For [Other Name]
1. [Question that needs their specific expertise]
2. [Question that needs their specific expertise]

## Done Looks Like
1. [Name]'s questions are answered in comments by [date if applicable]
2. [Coordinator] answers any follow-up questions before bringing to [next person]
3. Task is separated into subtasks and becomes the parent task for this project

---
**Context:** <[slug.md](GitHub URL)> (if workspace context file exists)
```

**When to use:** Multiple stakeholders need input. The task will spawn subtasks. Decisions must be made before implementation starts.

---

## 2. Design Decision

A visual decision task where stakeholders choose between multiple options. Uses inline mockups, screenshots, or HTML examples.

**Title:** Topic noun phrase
- Good: "Inventory View Layouts"
- Good: "Homepage Hero Section Options"
- Avoid: "Decide on inventory layout" (use this verb form only when no visuals are involved)

**Dart properties:** Type: Task | Status: Decision Needed | Assignee: decision-maker | Priority: as appropriate

**Description template:**

```markdown
## Issue at Hand
[What needs to be decided and why it matters now. Include context on constraints —
styling rules, shared code, responsive requirements.]

## [Option/Design Name A]
[Image or description]

### Notes and Questions
- [Observation about this option]
- [Question about feasibility or preference]

## [Option/Design Name B]
[Image or description]

### Notes and Questions
- [Observation about this option]
- [Trade-off or concern]

## [Option/Design Name C] (if applicable)
[Image or description]

### Notes and Questions
- [Observation about this option]

---
**Context:** <[slug.md](GitHub URL)> (if workspace context file exists)
```

**When to use:** Multiple visual/UX/architectural options exist. Someone needs to pick one. The task involves mockups, screenshots, or design alternatives.

---

## 3. Implementation

A single atomic step that one person can complete. The scope is clear and the done state is testable.

**Title:** Verb + object + context
- Good: "Create Clarity event tags for 8 new events"
- Good: "Configure SEO plugin for sitemap, OG tags, and robots rules"
- Good: "Create and publish the About Us page at /auto-sales-and-car-loans/"

**Dart properties:** Type: Task or Subtask | Status: To-do | Assignee: implementer (single person)

**Description template:**

```markdown
[1-2 sentences: what needs to happen and current state.]

## Questions
- [ ] [Any open question, or "(none)" if scope is clear]

## Action Items
- [ ] [Specific executable step]
- [ ] [Specific executable step]
- [ ] [Specific executable step]

---
**Context:** <[slug.md](GitHub URL)>
**Evidence:** [file.json](GitHub URL) (if applicable)
```

**Preferred verbs:** Implement, Configure, Build, Create, Add, Connect, Fix, Update, Migrate, Restore

**When to use:** One person can complete it. There's a clear verb and done state. No stakeholder decision is needed.

---

## 4. Verification

Confirms something works correctly. Should be separate from the implementation task (don't self-certify).

**Title:** Verb + object + context
- Good: "Validate robots.txt, sitemap discovery, and sitemap submission"
- Good: "Verify no AggregateRating schema on LocalBusiness pages"
- Good: "Test Meta CAPI events end-to-end from test events to live"

**Dart properties:** Type: Task or Subtask | Status: To-do | Assignee: verifier (ideally different from implementer)

**Description template:**

```markdown
[1-2 sentences: what to verify and what constitutes pass/fail.]

## Questions
- [ ] [Any open question about scope]

## Action Items
- [ ] [Specific verification step]
- [ ] [Specific verification step]

---
**Context:** <[slug.md](GitHub URL)>
**Evidence:** [file.json](GitHub URL) (if applicable)
```

**Preferred verbs:** Validate (broad correctness), Verify (confirm a known condition), Test, Confirm

**When to use:** Something was built or changed and needs independent confirmation. Use Validate for broad checks, Verify for specific conditions.

---

## 5. Investigation

Answers an unknown before any decision or implementation can happen. Ends with a documented finding, not a code change.

**Title:** Noun phrase or question format
- Good: "Can We Improve Inventory Filter Display?"
- Good: "Assess landing page generator capabilities and document constraints"
- Avoid: "Look at the filter thing" (too vague)

**Dart properties:** Type: Task | Status: To-do or Decision Needed | Assignee: investigator

**Description template:**

```markdown
## Issue at Hand
[What we don't know and why it matters]

## Scope
1. [What to investigate]
2. [What to investigate]
3. [What to investigate]

## Expected Output
[What the investigation should produce: a recommendation, constraint doc,
comparison, or set of options for a Design Decision task]

---
**Context:** <[slug.md](GitHub URL)> (if applicable)
```

**Preferred verbs:** Assess, Analyze, Review

**When to use:** Something is unknown. The task ends with a conclusion, recommendation, or documented constraint — not a code change.

---

## 6. Documentation

The primary deliverable is a document, not a code or config change.

**Title:** Verb + object + audience
- Good: "Document dataLayer and event taxonomy as the source of truth"
- Good: "Document custom plugins, integrations, and operational handoff requirements"

**Dart properties:** Type: Task or Subtask | Status: To-do | Assignee: author

**Description template:**

```markdown
## Purpose
[What the document is for and who will use it]

## Scope
1. [What to cover]
2. [What to cover]

## Definition of Done
1. [Document exists at specified location]
2. [Stakeholder has reviewed]

---
**Context:** <[slug.md](GitHub URL)> (if applicable)
```

**Preferred verbs:** Document, Capture, Record

**When to use:** The main output is a document, handoff material, or operational guide. State what it's for and who uses it.

---

## 7. Owner Summary

Type name: `owner_summary`. The plain-language, owner/stakeholder-facing parent for a client deliverable. It replaces the Brief as the parent when the work has a distinct owner audience separate from the implementers. No jargon: what it costs or saves, the timeline, why it's safe or invisible. The owner reads one thing; contributors see their own work nested below.

**Title:** Plain-language outcome noun phrase, owner-facing (NOT verb-first, NO jargon)
- Good: "New Phone and Internet Setup for the Office"
- Good: "Faster Website With No Downtime"
- Avoid: "Migrate homenet stack to fiber" (jargon, implementer-facing)

**Dart properties:** Type: Project | Status: derived from children (see BOARD_CONVENTIONS Parent Movement) | Assignee: coordinator | Priority: maximum of children's priorities

**Description template:**

```markdown
## What This Is

[1-2 plain-language paragraphs for the owner: what changes for them, what it
costs or saves, the timeline, and why it's safe/invisible. No jargon, no task IDs.]

## Who's Doing What

- **[Person A]** — [one plain line of what they own]
- **[Person B]** — [one plain line of what they own]
- **[Operator]** — [one plain line of what they own]

## When It's Done

1. [Plain-language outcome the owner can confirm]
2. [Plain-language outcome the owner can confirm]

---
**Context:** <[slug.md](GitHub URL)> (if workspace context file exists)
```

**When to use:** A client deliverable has a distinct owner/stakeholder audience separate from the implementers. Use this as the parent in place of a Brief; the Brief's per-person questions distribute into the `For X` groupings nested below.

---

## 8. For X

Type name: `for_grouping`. A per-contributor grouping subtask that sits between the Owner Summary and the implementation tasks. It holds one person's scope and their questions, and the implementation/verification/etc. tasks nest under it. One `For X` per contributor (including the operator). Required when 2+ people contribute to one deliverable.

**Title:** Literally `For <Name>`
- Good: "For Taylor"
- Good: "For the Operator"
- Avoid: "Taylor's tasks" (use the exact `For <Name>` form)

**Dart properties:** Type: Subtask | Status: derived from children (see BOARD_CONVENTIONS Parent Movement) | Assignee: that person | Priority: maximum of that person's child tasks

**Description template:**

```markdown
[1-2 sentences: this person's scope on this deliverable.]

## Questions For [Name]
1. [Question that needs their specific expertise]
2. [Question that needs their specific expertise]

## Their Work
- [ ] [Child task title] — [task type]
- [ ] [Child task title] — [task type]

---
**Context:** <[slug.md](GitHub URL)> (if workspace context file exists)
```

**When to use:** 2+ contributors work on one owner-facing deliverable and each needs their own scope and questions isolated. Create one `For X` per contributor under the Owner Summary; nest that person's Implementation/Verification/etc. tasks under their `For X`, never directly under the Owner Summary. With a single contributor plus a distinct owner, the `For X` layer is optional — children may hang directly under the Owner Summary.

---

## Decision Table

| Signal | Brief | Design Decision | Implementation | Verification | Investigation | Documentation | Owner Summary | For X |
|--------|:-----:|:---------------:|:--------------:|:------------:|:-------------:|:-------------:|:-------------:|:-----:|
| Multiple stakeholders need input | X | | | | | | | |
| Will spawn subtasks | X | | | | | | | |
| Visual options for review | | X | | | | | | |
| Status should be "Decision Needed" | | X | | | | | | |
| One person can complete | | | X | X | | X | | |
| Clear verb + done state | | | X | X | | X | | |
| Confirms existing work | | | | X | | | | |
| Something is unknown | | | | | X | | | |
| Ends with a finding, not code | | | | | X | | | |
| Primary output is a document | | | | | | X | | |
| Distinct owner/stakeholder audience | | | | | | | X | |
| 2+ contributors on one deliverable | | | | | | | | X |

**When in doubt:** Use Brief for parent-level tasks. Use Implementation for child-level tasks. When the work has a distinct owner audience, use an Owner Summary parent instead of a Brief; when 2+ people contribute to it, give each a `For X` grouping.

**Decision signal:** Use the Owner-Summary hierarchy when the work has a distinct owner/stakeholder audience separate from the implementers. Use the full For-X middle layer when 2+ people contribute. Otherwise keep the simple task shape.

---

## Naming Rules (All Types)

1. Make titles scannable without opening the task.
2. Briefs and Design Decisions use noun phrases.
3. Deliverables (Implementation, Verification, Investigation, Documentation) use verb-first titles.
4. Avoid vague words: handle, work on, look at, deal with, stuff, setup (as noun), check (when Validate/Verify/Confirm is clearer).

## Parent vs Child

- **Parent tasks** describe a workstream deliverable or outcome, not a generic category.
- **Child tasks** are single atomic execution steps that one person can complete.
- A Brief typically starts as a standalone task and becomes a parent once subtasks are created.

## Splitting Rule

Split a task when it contains: multiple verbs, multiple owners, decision + build + QA combined, or multiple independent deliverables.

**One-line rule:** If the title doesn't clearly tell a teammate what to do, what outcome is expected, and what kind of work it is — rename it.

## Client-Deliverable Hierarchy (multi-person work)

For client work that spans multiple people, use a **three-level tree** so the owner sees one thing and each contributor sees only their work:

```
PARENT  = Owner Summary        plain-language, stakeholder/owner-facing (NO jargon):
                               what it costs/saves, the timeline, why it's safe/invisible.
                               Audience = the owner; assignee = the coordinator.
  ├── For <Person A>           per-user grouping subtask — that person's scope + their questions
  │     ├── <Implementation>   verb+object, Questions + Action Items (the standard child shape)
  │     └── <Implementation>
  ├── For <Person B>
  │     └── <Implementation>
  └── For <Operator>           the operator's own setup/unblock action items
```

- The **Owner Summary replaces the Brief as the parent** for owner-facing deliverables — the Brief's per-person questions distribute into the "For X" groupings.
- One **"For X"** per user (including the operator). Title literally `For <Name>`.
- Implementation/Verification/etc. tasks nest **under their owner's "For X,"** never directly under the Owner Summary.
- Mirror the same shape in the repo `tasks/` workspace: an `OWNER_SUMMARY` doc (parent), `FOR__<person>.md` groupings, `IMPL__*.md` children, and an `index.json` that records the hierarchy. `tools/dart-integration/create-tasks-from-workspace.js` creates the tree (re-parent existing tasks via `updateTask` parentId).
