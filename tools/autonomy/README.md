# autonomy

A recurring-task completion gate: match a change (by command, changed paths, or
skill) to a task profile, run that profile's declared verifier script, and
gate on whether the resulting verification signal says the change is
acceptable.

## Quick start

```
node tools/autonomy/complete-task.cjs --profile verify-framework --framework <service/framework>
node tools/autonomy/complete-task.cjs --changed-paths frameworks/acme/widget/manifest.json
node tools/autonomy/complete-task.cjs --stats
```

## What changed from the private source

`lib/actor-registry.cjs` is an adaptation. The private source wrapped a large,
hand-maintained actor table (`tools/signals/lib/actor-registry.js`, part of a
private control-plane subsystem not included in this port) and also emitted a
"shadow mode" telemetry event on every model choice via another private
module. Both dependencies are gone.

This port reads a plain, user-populated `actor-registry.json` file instead —
copy `actor-registry.example.json` (same directory) to `actor-registry.json`
and edit it for your own actor roster. The schema is documented in
`schemas/actor-registry.schema.json`. Absent that file, the registry is empty
and every lookup returns `null`/`false` rather than throwing: an unconfigured
registry is a valid, if inert, state.

Nothing else in this directory (`complete-task.cjs`, `lib/delegation-controller.cjs`,
`lib/lane-selector.cjs`, `lib/profile-dispatcher.cjs`, `lib/profile-loader.cjs`,
`lib/run-log.cjs`, the two example profiles, and all five schemas) required any
change — none of it actually consumes `lib/actor-registry.cjs`; it ships here
as a standalone identity-resolution module for your own routing/dispatch code
to use if you want it.

## Dependency note

`complete-task.cjs` and `lib/profile-loader.cjs` depend on `tools/verify/lib/schema.cjs`
and `tools/verify/lib/signal.cjs`. `tools/verify/` ships as its own direct
(unmodified) export unit alongside this directory — it is not duplicated here.

## Files

- `complete-task.cjs` — CLI entry point (the completion gate).
- `lib/profile-loader.cjs` — loads and schema-validates a task profile by id.
- `lib/profile-dispatcher.cjs` — matches changed paths/commands/skills to a profile; selects an execution lane.
- `lib/lane-selector.cjs` — local-first / fast-slow lane classification.
- `lib/delegation-controller.cjs` — bounded worker delegation contracts (scope, depth, authority).
- `lib/run-log.cjs` — appends/reads the JSONL run log at `_dev/autonomy/run-log.jsonl` (created on first write).
- `lib/actor-registry.cjs` — actor identity resolution (adapted; see above).
- `actor-registry.example.json` — copy to `actor-registry.json` and edit.
- `profiles/` — two example task profiles (`verify-framework`, `verify-system`).
- `schemas/` — JSON Schemas for every artifact this directory produces or consumes.
