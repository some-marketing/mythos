# Framework Guardrails

This document consolidates all safety rules, execution modes, and constraints for the Feedback-to-Tasks framework. Reference this file from skills, commands, and agents via anchor links.

---

## Quick Reference Table

| Mode | Writes Files | Fetches Data | Modifies Tasks | Use Case |
|------|-------------|--------------|----------------|----------|
| FINDINGS_ONLY | No | No | No | Observe and document only |
| RUN_ONLY | Reports only | Yes | No | Fetch feedback, record results |
| PATCH_ALLOWED | Yes (scoped) | Optional | Yes (scoped) | Generate and refine task lists |

---

## 1. Execution Modes {#execution-modes}

### FINDINGS_ONLY
- **Purpose:** Analyze feedback and report observations without writing files
- **Allowed:** Read artifacts, analyze provenance, generate findings in chat
- **Forbidden:** Write any files, fetch from PM tools, create or modify task lists
- **Use when:** Communication architecture mapping, provenance auditing, ambiguity flagging

### RUN_ONLY
- **Purpose:** Fetch feedback from source tools and record raw data
- **Allowed:** Connect to Dart/Notion via MCP, fetch feedback items, write raw data artifacts
- **Forbidden:** Interpret feedback, create tasks, modify provenance records
- **Use when:** Source fetch phase — collecting raw feedback from PM tools

### PATCH_ALLOWED
- **Purpose:** Generate and refine task lists from audited feedback
- **Allowed:** Read all prior artifacts, generate task lists, write output files
- **Forbidden:** Modify raw feedback data, alter provenance records, add tasks not derived from feedback
- **Constraints:**
  - Every task MUST cite its source with exact provenance
  - No action inference beyond what was explicitly stated
  - Changes must be presented for review before finalizing
- **Use when:** Task formatting and compilation phase

---

## 2. Observational Reporting {#observational-reporting}

**CRITICAL:** All reports and analysis outputs MUST follow observational reporting principles.

### What TO do:
- Describe what you observe: "Stakeholder X said Y in comment Z"
- Cite evidence with exact source: "Comment by @jane on task DART-123 at 2024-01-15T10:30Z"
- Preserve exact wording: Quote feedback verbatim, do not paraphrase intent
- Flag ambiguity explicitly: "This statement could mean A or B — clarification needed"
- Track provenance chains: "Task derived from comment → on task → in board → by stakeholder"

### What NOT to do:
- Do NOT infer actions — "I don't like the color" is NOT "Change to blue"
- Do NOT diagnose intent — Report what was said, not what you think they meant
- Do NOT assign priority based on tone — Authority level determines priority, not urgency words
- Do NOT promote out-of-scope items — They go to Deferred, never to the active task list
- Do NOT suggest implementations — Tasks describe what to review, not how to fix

### Forbidden Labels and Patterns {#forbidden-labels}

Reports must contain **ZERO** instances of:

| Forbidden | Replace With |
|-----------|-------------|
| `Root Cause:` | `Observation:` + `HYPOTHESIS:` |
| `Recommendation:` | `Open Questions for Stakeholder` |
| `Action Required:` | `Feedback Source:` |
| `Implementation:` | Remove entirely — developer decides implementation |
| Code snippets | Remove entirely |
| Implementation suggestions | Remove entirely |
| Priority labels not derived from authority | Remove — use authority-based priority only |

### Required Labels {#required-labels}

All interpretive statements MUST use one of:

- `**Observation:**` — Factual description of what was said
- `**HYPOTHESIS:**` — Labeled interpretation with source citation
- `**Provenance:**` — Source chain for a derived task
- `**Ambiguity Flag:**` — Statement requiring clarification
- `**Out of Scope:**` — Item beyond current project boundaries

---

## 3. Provenance Rules {#provenance-rules}

**MANDATORY:** Every derived task MUST have a complete provenance chain.

### Provenance Chain Format
```
Stakeholder → Source Tool → Location → Item ID → Timestamp → Content
```

### Provenance Validation
- A task without a source citation is **INVALID** and must not appear in output
- Broken provenance chains must be flagged, not silently repaired
- If a task synthesizes multiple feedback items, ALL sources must be cited
- Provenance records are **immutable** — never modify raw feedback after fetch

### Authority Levels

| Level | Role | Priority Weight |
|-------|------|----------------|
| 1 | Decision-maker | Highest — directs what gets done |
| 2 | Reviewer | Medium — identifies issues and approves |
| 3 | Observer | Lowest — provides input, does not direct |

Authority-aware priority: decision-maker feedback outweighs reviewer feedback outweighs observer feedback when items conflict.

---

## 4. No-Action-Inference Rule {#no-action-inference}

This is the most critical guardrail for this framework.

### The Rule
Transform feedback into review tasks, NEVER into implementation directives.

### Examples

| Feedback | WRONG Task | CORRECT Task |
|----------|-----------|--------------|
| "I don't like the color" | "Change color to blue" | "Review color choice per stakeholder feedback" |
| "This is slow" | "Optimize database queries" | "Investigate performance concern raised by stakeholder" |
| "Can we add search?" | "Implement search feature" | "Evaluate search feature request (scope check needed)" |
| "The button is broken" | "Fix the submit button" | "Investigate reported submit button issue" |

### Why
- The framework compiles feedback, it does not interpret intent
- Developers have context the framework does not
- Inference creates false authority — making it look like a stakeholder directed a specific action

---

## 5. Scope Boundary Rules {#scope-boundaries}

### In-Scope Items
- Feedback that relates to deliverables defined in the scope document
- Bug reports on existing functionality
- Clarification requests about current features

### Out-of-Scope Items
- Feature requests beyond the current project scope
- Feedback about systems or pages not in the project
- Strategic/business decisions disguised as feedback

### Handling Out-of-Scope
- Out-of-scope items go to the **Deferred** section of the task list
- They are NEVER promoted to active tasks
- Each deferred item must cite why it is out of scope
- If no scope document is provided, flag items that appear to be new feature requests

---

## 6. Step Type Markers {#step-markers}

| Marker | Meaning | Behavior |
|--------|---------|----------|
| `[AUTO]` | Autonomous execution | Execute without confirmation, report progress |
| `[USER]` | User interaction required | Present question, STOP, wait for response |
| `[GATE: condition]` | Conditional checkpoint | If condition TRUE -> behave as [USER]; if FALSE -> proceed as [AUTO] |

### Sequential Execution
- Execute steps in strict order
- Do not skip or parallelize unless explicitly allowed
- Do not read files or prepare outputs for future steps (no speculation)

---

## 7. Data Safety {#data-safety}

### Never Include
- Real PII (names, addresses, phone numbers of real people)
- Secrets (API keys, passwords, tokens)
- Auth cookies/tokens
- Production credentials

### Safe Patterns
- Reference stakeholders by role or mapped alias when possible
- Use source tool item IDs rather than embedding full content in summaries
- Reference evidence paths instead of pasting sensitive content

---

## 8. Mode-Specific Checklists {#mode-checklists}

### FINDINGS_ONLY Checklist
- [ ] No files were written
- [ ] No PM tool connections were made
- [ ] All findings presented in chat
- [ ] Evidence paths cited for all claims
- [ ] Provenance chains traced for all observations
- [ ] No action inference in any finding

### RUN_ONLY Checklist
- [ ] Source tool connected via MCP
- [ ] All feedback items fetched with full metadata
- [ ] Raw data written to designated output location
- [ ] No interpretation or task creation performed
- [ ] Provenance metadata recorded for every item (author, timestamp, parent, thread)

### PATCH_ALLOWED Checklist
- [ ] All prior artifacts loaded before generating tasks
- [ ] Every task has a complete provenance citation
- [ ] No action inference — tasks describe what to review, not what to do
- [ ] Authority-based priority applied correctly
- [ ] Out-of-scope items in Deferred section only
- [ ] Task list presented for user review before finalizing
- [ ] No "drive-by" tasks added without source feedback
