# commands

`mythos-command-runner.cjs` resolves a typed slash command (through the alias
registry) to its canonical spec and, if a deterministic handler is registered
for it, runs that handler. Everything else about a command — its process,
success criteria, handoff — lives in the command's own markdown spec under
`.claude/commands/`; this runner is only for the subset of commands that have
a mechanical, deterministic implementation instead of (or in addition to) an
AI-driven process.

## Quick start

```
node tools/commands/mythos-command-runner.cjs --command '/route remember this'
node tools/commands/mythos-command-runner.cjs --command '/review-task-plan my-task-id'
```

## Handlers kept vs. stubbed

This port kept every handler whose dependencies are fully satisfiable inside
this export target (node builtins, other files in this directory, or
`tools/planning` / `tools/verify`, which ship as their own direct export
units):

| Handler | Status | Notes |
|---|---|---|
| `route` | **ported unchanged** | advisory-only intent router; depends only on `lib/operator-route.cjs`. |
| `concept-promote` | **ported unchanged** | policy-promotion state machine for concept bundles; fs/path only. |
| `debrief-run` | **ported unchanged** | deterministic debrief-artifact writer; fs/path only. |
| `review-task-plan` | **ported, one dependency relocated** | the private source pointed at `tools/signals/lib/review-task-plan-narrative.js`; that file's logic was generic (hash-binding a review artifact to a plan's content), so it was relocated in-tree to `lib/review-task-plan-narrative.cjs` rather than dropped. Depends on `tools/planning/lib/resolve-task-plan`. |
| `review-progress` | **not ported** | its adapter layer depends on a private live-signal scanner and a private status-surface module, plus a private telemetry trace-context call. |
| `new-session`, `shutdown` | **not ported** | depend on a private session-boundary-marker subsystem and (for `shutdown`) a private end-of-session closeout module. |
| `follow-signal` | **not ported** | depends on a private signal-authority resolver; also not wired into the runner in the private source. |
| `telemetry-status`, `run-plan`, `repair-plan`, `orchestrate-loop`, `plan-task`, `orchestrate`, `amend-plan`, `evidence-loop` | **not ported** | these lived under a private `tools/codex/commands/` directory not included in this port. |

The runner's own telemetry-completion-event wiring (the private source
emitted a span + reflex-outcome event to a private telemetry pipeline on
every handler run) was also dropped — handlers just run and return.

`lib/command-registry.cjs`, `lib/command-aliases.cjs`, `lib/operator-route.cjs`,
and `lib/lifecycle-spec-drift.cjs` were ported unchanged; none of them had any
dependency outside this directory. `lib/lifecycle-spec-drift.cjs` currently has
no consumer in this port (its only two call sites were the stubbed `shutdown`
and `new-session` handlers) — it ships anyway as a small, self-contained,
generically useful spec-drift comparator if you want to wire up your own
lifecycle command with a similar "declared coverage must match the live spec"
contract.

## Adding your own handler

1. Write `handlers/<command-id>.cjs` exporting a function
   `(projectRoot, argsText, options) => { exitCode, stdout, stderr }`.
   `options.json === false` should switch you to a short human-readable
   `stdout`; `options.write === false` should mean "compute and report, don't
   write files" (a dry run).
2. Register it in the `HANDLERS` map in `mythos-command-runner.cjs`.
3. Add a test in `__tests__/` that builds a temp fixture project root (see
   `mythos-command-runner.test.cjs` for the pattern) rather than depending on
   this repo's own live command specs.

## Files

- `mythos-command-runner.cjs` — CLI entry point / handler dispatch.
- `handlers/` — the four ported deterministic handlers.
- `lib/command-registry.cjs` — loads a canonical command spec by id; parses a slash-command string.
- `lib/command-aliases.cjs` — resolves a typed command id through the alias registry.
- `lib/operator-route.cjs` — the rule table `route.cjs` runs against.
- `lib/lifecycle-spec-drift.cjs` — generic declared-coverage-vs-live-spec drift comparator (currently unused; see above).
- `lib/review-task-plan-narrative.cjs` — hash-binding contract helper for `/review-task-plan`, relocated here from a private directory (logic unchanged).
- `__tests__/mythos-command-runner.test.cjs` — new; exercises the runner and all four ported handlers against temp fixture project roots.
