# Continuity Gate (`.githooks/`)

Operator-facing documentation for the Continuity Gate — a pre-push hook plus a
mirrored CI workflow that converts "recurrent silent loss of canonical
history" into "audited opt-in migration".

## What the gate protects

The gate blocks two failure modes by default:

1. **Orphan-root push** — pushing a branch tip that has no merge-base with the
   remote tip of the same ref. This is the shape of a force-push that
   abandons all prior history. (This is the failure mode that produced the
   `branch-state-reconciliation-option-c` workstream.)

2. **Canonical-divergent force-push** — a non-fast-forward push that changes
   blob content of canonical surfaces:
   - `instructions/canonical/`
   - `tools/kernel/`
   - `tools/retrieval/`
   - `tools/signals/lib/`
   - `tools/auto-bridge/`
   - `tools/memory/`
   - `frameworks/*/*/manifest.json`
   - `frameworks/*/*/guardrails.md`

The gate is mirrored server-side in
`.github/workflows/continuity-gate.yml` so a local bypass cannot silently
land canonical-divergent state on `main`.

## How to activate (operator-only)

The hook is **inert by default**. It is present in the tree but Git does not
run it until the operator opts in.

To activate, the operator runs:

```bash
git config core.hooksPath .githooks
```

To deactivate:

```bash
git config --unset core.hooksPath
```

Activation is a per-clone setting and is not tracked in the repository. CI
enforcement runs regardless of local activation.

## Escape hatch — Migration Signal

A push that legitimately needs to introduce a new root or rewrite canonical
surfaces requires an audited, ratified Migration Signal artifact.

1. Author a signal at `_dev/reports/signals/migration-signal__<slug>.json`
   conforming to `_dev/reports/signals/migration-signal.schema.json`.
2. Fill `path_mapping`, `reason`, and `old_paths` / `new_paths` so the
   migration is auditable after the fact.
3. Set the appropriate allow flag:
   - `allow_orphan_root: true` to permit an orphan push
   - `allow_canonical_divergent_force_push: true` to permit canonical
     divergence on a non-fast-forward push
4. Operator ratifies by setting `ratification.signed: true`, naming
   themselves in `ratification.operator`, and recording the
   `ratification.commit` of the head being pushed.
5. `expires_at` must be in the future and reasonably bounded (hours, not
   weeks).

The signal must be committed to the repo (CI cannot trust a working-tree-only
signal).

## When to bypass with `--no-verify`

**Never** — without an explicit, recorded operator decision. The hook is the
last line of defence against silent loss of canonical history. If you find
yourself reaching for `--no-verify`, author a Migration Signal instead. The
audit cost is small; the cost of silent canonical loss is the entire
reconciliation workstream that produced this gate.

## Schema

`_dev/reports/signals/migration-signal.schema.json` defines the signal shape.
Both the local hook and the CI workflow validate against it.

## Provenance

- Phase 1 convene (operator decision: Continuity Gate ships in this
  workstream): `_dev/reports/signals/ready-for-review__20260506T232347Z__codex-phase-1-disposition-cross-verification-for-branch-state-reconciliation-o.json` and the matching Gemini disposition.
- Phase 4 plan step (this commit) installs the gate inert.
- Operator ratification activates it.
