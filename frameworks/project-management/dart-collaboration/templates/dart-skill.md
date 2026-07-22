# Some Marketing Task Conventions

**When creating, renaming, or restructuring tasks in this workspace, follow these conventions.**

---

## Two task patterns

### Pattern 1: Brief (parent/project tasks)

Use when the task exists to gather decisions, align stakeholders, or scope a new workstream BEFORE implementation begins.

**Title:** Descriptive noun phrase (outcome or topic, NOT verb-first)
- Good: "Payment Estimate Displayed on Simple Grid"
- Good: "Inventory View Layouts"
- Good: "Can We Improve Inventory Filter Display?"
- Avoid: "Implement payment estimate on grid"

**Description structure:**

```
## Issue At Hand
(1-3 paragraphs: what's going on, why it matters. Include inline images/mockups
if visual. Conversational — this is a brief for humans, not a spec.)

## Questions For [Name]
(Repeat per stakeholder. Number the questions. Be specific about what you need.)

## Questions For [Other Name]
(Same format. Different person, different questions.)

## Done Looks Like
(Name specific people. Describe the handoff sequence.
End with: "Task is separated into subtasks and becomes the parent task.")

---
**Context:** <[filename.md](GitHub URL)> (if workspace context file exists)
```

**For design decisions**, replace the Questions sections with:

```
## Proposed Designs

### [Design Name A]
(Image or description)

#### Notes and Questions
- (Observation or trade-off)

### [Design Name B]
(Image or description)

#### Notes and Questions
- (Observation or trade-off)
```

Set status to **Decision Needed** for design decisions.

**Assignee:** The person who needs to respond first.

**Type:** Task or Project (use Project for large workstreams with 10+ expected children).

---

### Pattern 2: Deliverable (child/subtask tasks)

Use when the task is a single atomic step one person can complete.

**Title:** Verb + object + context
- Good: "Validate robots.txt, sitemap discovery, and sitemap submission"
- Good: "Configure SEO plugin for sitemap, OG tags, and robots rules"
- Good: "Create and publish the About Us page at /auto-sales-and-car-loans/"

**Description structure:**

```
(1-2 sentences: what this task is and current state.)

## Questions
- [ ] (checklist of open questions, or "(none)" if scope is clear)

## Action Items
- [ ] (specific executable step)
- [ ] (specific executable step)

---
**Context:** <[filename.md](GitHub URL)>
**Evidence:** [file.json](GitHub URL) (if applicable)
```

**Status:** To-do (or Doing if actively in progress).

**Assignee:** The person doing the work.

---

## Choosing the right pattern

| Signal | Use Brief | Use Deliverable |
|--------|-----------|-----------------|
| Multiple stakeholders need input | Yes | No |
| Needs mockups/visuals for alignment | Yes | No |
| Will spawn subtasks | Yes | No |
| One person can complete it | No | Yes |
| Has a clear verb + done state | No | Yes |
| Requires a decision before work starts | Yes | No |

---

## Task verbs by type

### Decision tasks
Start with **"Decide whether..."** — make the blocked choice obvious.

### Planning/definition tasks
**Define, Map, Plan, Outline** — should produce a clear source of truth.

### Implementation tasks
**Implement, Configure, Build, Create, Add, Connect, Fix, Update, Migrate, Restore** — describe the finished state, not just the activity.

### QA/validation tasks
**Validate** (broad correctness), **Verify** (confirm a known condition), **Test, Confirm** — keep QA separate from implementation.

### Investigation tasks
**Assess, Analyze, Review** — must end with a conclusion, recommendation, or constraint.

### Documentation tasks
**Document, Capture, Record** — state what the document is for and who uses it.

---

## Parent vs child tasks

- **Parent tasks** describe a workstream deliverable/outcome (not a generic category).
  - Good: "Payment Estimate Displayed on Simple Grid"
  - Avoid: "Design work", "Website fixes"
- **Child tasks** are single, atomic execution steps one person can complete.

---

## Splitting rule

Split when a task contains: multiple verbs, multiple owners, decision + build + QA combined, or multiple independent deliverables.

**One-line rule:** If the title doesn't clearly tell a teammate what to do, what outcome is expected, and what kind of work it is — rename it.

---

## Words and patterns to avoid

- Handle, work on, look at, deal with, stuff
- Setup (as a noun — use "Set up" or "Configure")
- Check (when Validate, Verify, or Confirm is more precise)
- Titles that are too conversational, all lowercase, shorthand-heavy, or category labels instead of outcomes

---

## Git workspace linking

When a git workspace repo exists for the client project, add a footer to the task:

```
---
**Context:** <[filename.md](GitHub URL)>
**Evidence:** [file.json](GitHub URL) (if applicable)
```

- Every parent task SHOULD link to a context file
- Every child task SHOULD link to its parent's context file
- Evidence files link separately for verification tasks

---

## Tag definitions

| Tag | Meaning |
|-----|---------|
| Blocker | Launch gate. Must be done before DNS cutover. |
| Pre-Launch NTH | Nice-to-have. Won't stop launch if deferred. |
| Post-Launch | Sequenced for after DNS cutover. |
| Engineering | Code, plugin, server, or GTM work. |
| Marketing | Analytics, SEO, content, or advertising. |
| QA | Verification, validation, or testing. |
| Design | Visual, layout, or UX work. |
| Product | Product decision or capability evaluation. |
| Operations | Process, handoff, monitoring, or compliance. |
| SEOPress | Depends on or involves the SEOPress Pro plugin. |
| plugin available | A plugin/tool exists that could accelerate this. |
| Planned Feature | Future consideration, not in current sprint. |

## Priority definitions

| Priority | Meaning |
|----------|---------|
| Critical | Launch cannot proceed without this. |
| High | Must be done this sprint. |
| Medium | Before launch or first post-launch week. |
| Low | Can be deferred beyond first post-launch week. |

## Tagging rules

1. A task tagged **Blocker** should generally be **Critical** or **High**.
2. A task tagged **Pre-Launch NTH** should generally be **Medium** or **Low**.
3. A task tagged **Post-Launch** should generally be **Medium** or **Low**.
4. If a tag and priority conflict, the tag is the source of truth for launch-gating.
