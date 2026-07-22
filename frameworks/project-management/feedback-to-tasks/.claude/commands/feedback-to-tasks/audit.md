---
name: audit
description: Audit provenance chains for all feedback items
skill: feedback-to-tasks
mode: FINDINGS_ONLY
---

Audit provenance for previously fetched feedback.

1. Load `task_output/raw_feedback.json` and `communication_architecture.json`
2. For each item, trace: who said it, when, in response to what, authority level
3. Flag broken chains (forwarded without attribution, deleted sources)
4. Write `task_output/provenance_audit.json`
