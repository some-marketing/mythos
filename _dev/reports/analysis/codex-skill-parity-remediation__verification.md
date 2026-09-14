# Codex skill parity remediation — coordinator verification

Verified at `2026-09-14T17:24:22Z` in the declared isolated worktree on `codex/skill-parity-remediation`.

## Mechanical results

- `node --test tools/skills/__tests__/sync-codex-skills.test.cjs tools/skills/__tests__/sync-lifecycle-command-skills.test.cjs`: 11 passed, 0 failed.
- `node tools/skills/sync-codex-skills.cjs --check`: aligned.
- Pinned Codex `quick_validate.py`, using the repository PyYAML environment: 124 of 124 applied packages valid; 174 of 174 staged candidate packages valid.
- Private-path and obvious-secret-pattern scan over applied and staged candidate trees: no matches.
- `npm run instructions:generate`: completed and wrote the generator-owned targets.
- `npm run instructions:validate`: passed with no parity or drift errors.
- `git diff --check`: passed.
- Scoped status check: zero changes under `instructions/canonical/**` and zero under `clients/**`.

The first package-validation attempt used a Python interpreter without PyYAML and failed before parsing any package (`ModuleNotFoundError: yaml`). It was rerun with the repository's dependency environment, which carries PyYAML 6.0.3, and all packages passed.

## Projection truth

- 122 canonical command skills applied: 118 `ADVISORY`, 4 handler-backed `BLOCKING`.
- 2 direct project skills applied: `go` and `ticktock`.
- 2 direct project skills blocked `ABSENT / missing_source`: `meditate` and `outward-inward-loop`.
- 10 aliases attached as target metadata: 9 `ADVISORY`, 1 handler-backed `BLOCKING`; no alias body was generated.
- 45 framework helpers staged `ADVISORY / pending_review`; none applied.
- 181 evidence receipts emitted; no collisions and no unclassified `UNKNOWN` projection was applied.

## Live Codex result

Fresh `codex exec --ephemeral --sandbox read-only` confirmed that `go`, `source-command-ground-in-philosophy`, and the `/tt` declaration on `ticktock` are discoverable with the expected authority boundaries. The staged framework helper `guild-wordpress-qa-qa-rerun-verify` was absent from the runtime catalog and was correctly reported as `UNKNOWN`. Receipt: `codex-skill-projections/runtime-receipt-codex-discovery.md`.

## Distinct review

Claude and Gemini reviewed the implementation. After the absolute home path was removed from the runtime receipt, both approved the implementation and the disposition of the generator-derived alias row. Review synthesis: `convene-runs/20260914T172053Z-codex-skill-parity-remediation-implementation-review/synthesis.md`.

## Falsifiers and residuals

Acceptance would be disproved by an applied `UNKNOWN` or pending candidate, copied alias behavior, a non-handler command marked `BLOCKING`, a private path in a shipped projection, a canonical/client diff, a failed runtime discovery claim, or an unresolved distinct-family blocker. None was observed.

Residuals are the two missing accepted direct sources, 45 unreviewed framework helpers, non-append-only first-write evidence, limited `--check` coverage, and the pre-existing instruction alias-renderer schema mismatch. These remain explicitly outside the accepted capability claim.
