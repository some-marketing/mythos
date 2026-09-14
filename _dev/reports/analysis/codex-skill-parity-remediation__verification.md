# Codex skill parity remediation — coordinator verification

Refreshed under the approved parity amendment at `2026-09-14T18:51:57Z` in the declared isolated worktree on `codex/skill-parity-remediation`.

## Mechanical results

- Combined projector, lifecycle, and alias regressions: 26 passed, 0 failed.
- `node tools/skills/sync-codex-skills.cjs --check`: aligned.
- Pinned Codex `quick_validate.py`, using the repository PyYAML environment: 132 of 132 applied packages valid; 177 of 177 top-level staged candidate packages valid. All 182 staged `SKILL.md` files, including five bundled helper resources, also validate.
- Private-path and obvious-secret-pattern scan over applied and staged candidate trees: no matches.
- `npm run instructions:generate`: completed and wrote the generator-owned targets.
- `npm run instructions:validate`: passed with no parity or drift errors.
- `git diff --check`: passed.
- Scoped status check: zero changes under `instructions/canonical/**` and zero under `clients/**`.

## Protected parity amendment

- Wiring graph regenerated: 4,092 nodes, 2,899 edges, 0 unresolved.
- Target-only baseline repair registered 3,366 expected files while preserving the complete source and membrane policy objects byte-for-byte.
- Portable `npm run verify:parity`: `ok: true`, 0 findings.
- Authoritative private-denylist verification against the existing bound hash: `ok: true`, 0 findings. The external file and its location are not serialized in tracked artifacts.
- Parity test suite: 28 passed, 0 failed.

The first package-validation attempt used a Python interpreter without PyYAML and failed before parsing any package (`ModuleNotFoundError: yaml`). It was rerun with the repository's dependency environment, which carries PyYAML 6.0.3, and all packages passed.

## Projection truth

- 130 canonical command skills applied: 126 `ADVISORY`, 4 handler-backed `BLOCKING`. Eight typed aliases with their own canonical workflows retain distinct runtime pointers.
- 2 direct project skills applied: `go` and `ticktock`.
- 2 direct project skills blocked `ABSENT / missing_source`: `meditate` and `outward-inward-loop`.
- 10 aliases attached as target metadata: 9 `ADVISORY`, 1 handler-backed `BLOCKING`; no alias body was generated.
- 45 framework helpers staged `ADVISORY / pending_review`; none applied.
- 189 evidence receipts emitted; no collisions and no unclassified `UNKNOWN` projection was applied.

## Live Codex result

Fresh `codex exec --ephemeral --sandbox read-only` confirmed that `go`, `source-command-ground-in-philosophy`, and the `/tt` declaration on `ticktock` are discoverable with the expected authority boundaries. The staged framework helper `guild-wordpress-qa-qa-rerun-verify` was absent from the runtime catalog and was correctly reported as `UNKNOWN`. Receipt: `codex-skill-projections/runtime-receipt-codex-discovery.md`.

## Distinct review

Claude and Gemini reviewed the implementation and the protected parity amendment. Fresh PR review findings led to candidate-path hardening, typed workflow preservation, resource reconciliation, lifecycle staging isolation, and correction of the instruction alias loader/renderer. Gemini approved the repaired tree. A remaining Claude block was tested directly and adjudicated: legacy aliases render correctly, and resolved-root plus strict-descendant checks satisfy the declared local CLI threat model. Final review synthesis: `convene-runs/20260914T185255Z-codex-skill-parity-final-code-review/synthesis.md`.

## Falsifiers and residuals

Acceptance would be disproved by an applied `UNKNOWN` or pending candidate, copied alias behavior, a non-handler command marked `BLOCKING`, a private path in a shipped projection, a canonical/client diff, a failed runtime discovery claim, or an unresolved distinct-family blocker. None was observed.

Residuals are the two missing accepted direct sources, 45 unreviewed framework helpers, non-append-only first-write evidence, and broader foreign-extra coverage in `--check`. These remain explicitly outside the accepted capability claim. The instruction alias-renderer mismatch is repaired and covered by focused tests. Repository parity is both portable-verified and privately ratified for this amended tree.
