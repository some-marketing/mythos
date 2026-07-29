# Claude Health Remediation Playbook

Claude-oriented playbook for fixing the concrete audit gaps currently present in Mythos.

This pack is tailored to Claude's multi-agent `Task` structure:
- one coordinator in the main thread
- small read-only explorers for inventory and evidence gathering
- disjoint write-owning workers only when the write surface is cleanly separable
- validation in the main thread
- a final read-only completion audit

Primary repo evidence for the current gaps:
- [`frameworks/wordpress/design-research/manifest.json`](../../frameworks/wordpress/design-research/manifest.json)
- [`frameworks/wordpress/qa/manifest.json`](../../frameworks/wordpress/qa/manifest.json)
- [`tools/verify/verify-framework.cjs`](../../tools/verify/verify-framework.cjs)
- [`tools/workspace/validate-workspace.js`](../../tools/workspace/validate-workspace.js)
- [`tools/workspace/replay-candidate.js`](../../tools/workspace/replay-candidate.js)
- [`tools/workspace/scaffold-candidate.js`](../../tools/workspace/scaffold-candidate.js)
- [`tools/workspace/validate-output.js`](../../tools/workspace/validate-output.js)
- [`tools/workspace/lib/output-contract.js`](../../tools/workspace/lib/output-contract.js)
- [`package.json`](../../package.json)
- [`_dev/reports/analysis/CODEX_REVIEW_RESPONSE.md`](../reports/analysis/CODEX_REVIEW_RESPONSE.md)

## Goal

Bring Mythos from "structurally healthy" to "meaningfully auditable" by closing the current blind spots:

1. semantic prompt-chain drift is not mechanically detected
2. `verify:all` does not cover the full registered framework inventory
3. workspace/project health checks use generic assumptions that do not match several framework runtimes
4. candidate replay checks do not execute real replay runs
5. candidate scaffolding and output review are structurally useful but semantically underpowered

## Recommended Execution Order

1. Run the semantic verifier and framework coverage work first.
   This raises the quality of every later check.
2. Align project/workspace status and runtime health checks next.
   This reduces false green / false red project health reporting.
3. Harden candidate replay and promotion gates.
   This improves framework repeatability claims.
4. Improve semantic output review only after the structural and replay layers are trustworthy.

## Prompt Packs

Use these prompt packs in order:

1. [`claude-prompt-pack-semantic-verification.md`](./claude-prompt-pack-semantic-verification.md)
2. [`claude-prompt-pack-project-health-alignment.md`](./claude-prompt-pack-project-health-alignment.md)
3. [`claude-prompt-pack-candidate-replay-hardening.md`](./claude-prompt-pack-candidate-replay-hardening.md)
4. [`claude-prompt-pack-semantic-output-audit.md`](./claude-prompt-pack-semantic-output-audit.md)

## Multi-Agent Rules

Apply these rules to every pack:

1. Start in the main thread.
2. Read the cited repo files before planning edits.
3. Produce a short plan with explicit acceptance criteria.
4. Launch at most 2 read-only explorers in parallel for inventory or evidence gathering.
5. Keep write ownership disjoint if you use workers.
6. Do not use recursive delegation.
7. Keep validation in the main thread.
8. Run one final read-only completion audit.
9. Reopen only blocker items.
10. Stop after 2 reopen cycles and escalate if blockers remain.

## Completion Standard

A remediation task is complete only if all of the following are true:

- the targeted check or workflow behavior is implemented
- automated validation exists or was updated
- at least one failing-before / passing-after proof exists when practical
- docs or prompts were updated where behavior changed
- no new hardcoded framework assumptions were introduced

## Suggested Branching

If you split work:

- Branch A: verifier and framework inventory coverage
- Branch B: project/workspace health alignment
- Branch C: candidate replay and promotion hardening
- Branch D: semantic output auditing

Do not run multiple write-owning workers against the same file set.
