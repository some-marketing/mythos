# Concept Storage Policy

**Status:** Recommended operating standard
**Applies to:** `_dev/concepts/`

---

## Decision

**Use a hybrid concept model.**

- Keep **flat markdown files** for simple, low-risk, mostly settled concepts.
- Promote a concept to a **subdirectory bundle** when it has a live working set:
  dispatch prompts, responses, research, synthesis, status tracking, or linked artifacts.

This avoids folder sprawl while still giving active concepts enough room to accumulate
context and mind handoffs.

## Canonical Rules

### Flat concepts

Use a single file when the concept is:

- one-shot or low-risk
- unlikely to need cross-model review
- not collecting research files or artifacts
- unlikely to generate multiple rounds of revision

Example:

```text
_dev/concepts/some-idea.md
```

### Bundled concepts

Promote to a subdirectory when **two or more** of the following are true:

- needs a distinct mind's review (a second model, a human)
- needs `status.json` state tracking
- needs research or context files
- has a review workflow attached
- will likely require multiple revision rounds
- needs synthesis across responses
- needs machine-readable links to an external tracker or a rank-up target

Example:

```text
_dev/concepts/some-idea/
  concept.md
  status.json
  context/
  research/
  dispatch/
  responses/
  synthesis/
```

## Canonical Files for Bundled Concepts

### Required

- `concept.md` — source of truth for the concept itself
- `status.json` — machine-readable workflow state

### Optional

- `context/` — supporting context curated for other models or reviewers
- `research/` — external or internal notes gathered during concept development
- `dispatch/` — prompts prepared for external models
- `responses/` — raw inbound responses from models or operators
- `synthesis/` — merged outcome and final decision log
- `artifacts/` — screenshots, exports, or other non-canonical deliverables

## Bundle Lifecycle

1. Create concept as flat file unless the bundle threshold is already met.
2. Promote to a bundle when support files or model handoffs become necessary.
3. Record dispatches and workflow state in `status.json`.
4. Keep `concept.md` canonical; store raw model outputs outside it.
5. Store merged reasoning in `synthesis/` and update `concept.md` only when the
   canonical decision changes.
6. Optionally archive or demote once the concept is settled.

## Promotion Rules

When promoting a flat concept into a bundle:

1. Move the original markdown into `concept.md`
2. Create `status.json`
3. Add only the directories actually needed
4. Preserve commit history through a Git move when possible

Example:

```text
_dev/concepts/example.md
→
_dev/concepts/example/concept.md
```

## Dispatch Rules

- Do not dispatch ad hoc prompts from chat history if the concept is expected to be reusable.
- Commit and push bundle artifacts **before** sending a prompt to another model.
- Prefer a durable response artifact when available; use `responses/` as the fallback capture path.
- The originating mind remains the synthesis gate and does not auto-accept external model output.

## Watch Rules

Watching for updates is **opt-in**, not implicit.

Recommended split:

- a dispatch step prepares and records the dispatch
- a watch step polls or listens for a response
- a review step assesses the returned material
- `/synthesize-concept` merges accepted changes

This prevents one command from silently dispatching, polling, reviewing, and merging
in a single opaque step.

## Recommended `status.json` Shape

```json
{
  "slug": "concept-slug",
  "created": "2026-03-31",
  "updated": "2026-03-31",
  "author": "claude",
  "stage": "draft",
  "concept_version": 1,
  "next_action": "none",
  "dispatches": [],
  "tracker": {
    "task_id": null,
    "status_synced": false
  },
  "promotion": {
    "target": null,
    "status": "none"
  }
}
```

## Command Contract

A bundled concept should be compatible with this command lifecycle:

- `/inscribe-lore` (concept-init)
- `/concept-promote`
- a dispatch command (if cross-model review is in use)
- a watch command
- a review-dispatch command
- `/synthesize-concept`
- a tracker-sync command
- a close-concept command

These commands do not all need to exist yet, but the file layout should assume they
will.

## Anti-Patterns

- Making every concept a folder by default
- Keeping active multi-file concepts flat until related files scatter across `_dev/`
- Treating raw model responses as canonical
- Watching indefinitely without an explicit return path
- Dispatching a concept that has not been committed and pushed
