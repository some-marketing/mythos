# Codex skill parity remediation — coordinator verification

Refreshed under the approved parity amendment at `2026-09-14T18:51:57Z` in the declared isolated worktree on `codex/skill-parity-remediation`.

## Mechanical results

- Combined projector, lifecycle, and alias regressions: 41 passed, 0 failed.
- `node tools/skills/sync-codex-skills.cjs --check`: aligned.
- Pinned Codex `quick_validate.py`, using the repository PyYAML environment: 131 of 131 applied packages valid; 176 of 176 top-level staged candidate packages valid. Nested child skills are excluded from parent resources, so the staged tree contains exactly 176 independently projected `SKILL.md` files.
- Private-path and obvious-secret-pattern scan over applied and staged candidate trees: no matches.
- `npm run instructions:generate`: completed and wrote the generator-owned targets.
- `npm run instructions:validate`: passed with no parity or drift errors.
- `git diff --check`: passed.
- Scoped status check: zero changes under `instructions/canonical/**` and zero under `clients/**`.

## Protected parity amendment

- Wiring graph regenerated: 4,091 nodes, 2,899 edges, 0 unresolved.
- Target-only baseline repair registered 3,360 expected files while preserving the complete source and membrane policy objects byte-for-byte.
- Portable `npm run verify:parity`: `ok: true`, 0 findings.
- Authoritative private-denylist verification against the existing bound hash: `ok: true`, 0 findings. The external file and its location are not serialized in tracked artifacts.
- Parity test suite: 28 passed, 0 failed.

The first package-validation attempt used a Python interpreter without PyYAML and failed before parsing any package (`ModuleNotFoundError: yaml`). It was rerun with the repository's dependency environment, which carries PyYAML 6.0.3, and all packages passed.

## Projection truth

- 130 canonical command skills applied: 125 `ADVISORY`, 5 handler-backed `BLOCKING`. Eight typed aliases with their own canonical workflows retain distinct runtime pointers; handler capability is derived from each wrapper's resolved execution target.
- 1 direct project skill applied: `go`.
- 2 direct project skills blocked `ABSENT / missing_source`: `meditate` and `outward-inward-loop`; `ticktock` is additionally blocked `ABSENT / dependency_unavailable` because its mandatory TOCK phase requires `meditate`.
- 9 aliases attached as target metadata: 8 `ADVISORY`, 1 handler-backed `BLOCKING`; `/tt` is blocked `ABSENT / target_unavailable`, and no alias body was generated.
- 45 framework helpers staged `ADVISORY / pending_review`; none applied.
- 189 evidence receipts emitted; bundled-resource packages carry deterministic path/hash/mode manifests and complete-package hashes. Primary sources and resources must be regular non-symlink files contained by repository-anchored, non-symlink declared source roots before reading. Sensitive resource names and high-confidence credential material are rejected. Executable modes are preserved on newly written resources and checked thereafter. No collisions and no unclassified `UNKNOWN` projection was applied.

## Live Codex result

Fresh `codex exec --ephemeral --sandbox read-only` confirmed that `go`, `source-command-ground-in-philosophy`, and the `/tt` declaration on `ticktock` are discoverable with the expected authority boundaries. The staged framework helper `guild-wordpress-qa-qa-rerun-verify` was absent from the runtime catalog and was correctly reported as `UNKNOWN`. Receipt: `codex-skill-projections/runtime-receipt-codex-discovery.md`.

## Distinct review

Claude and Gemini reviewed the implementation and the protected parity amendment. The first Cloud Codex PR review led to candidate-path hardening, typed workflow preservation, resource reconciliation, lifecycle staging isolation, and correction of the instruction alias loader/renderer. The second Cloud Codex review identified two further path-identity gaps: unvalidated candidate IDs and filename/internal canonical-ID conflation. Both are repaired with slug validation, filename-keyed command loading, mismatch rejection, contained-write checks, and regressions. The third Cloud Codex review found that `ticktock` remained exposed despite its mandatory `meditate` dependency being absent; dependency gating now keeps both `ticktock` and `/tt` unavailable. The fourth Cloud Codex review found literal blocking-command argument placeholders and nested child skills bundled as parent resources; blocking projections now require the actual invocation arguments, while nested skills project only through their own receipts. The fifth Cloud Codex review found private rejected bytes still entering staging, raw malformed lines entering receipts, and incomplete resource hashing; rejected packages now retain only sanitized receipt metadata, parse errors expose line numbers only, and package evidence covers every resource path and hash. The sixth Cloud Codex review found symlinked-resource escape and executable-mode loss; resource collection now rejects symlinks before reading, records modes, preserves modes on new files, and detects later mode drift. The seventh Cloud Codex review found the equivalent symlink gap on primary skill sources; canonical, direct, and framework primary files now require non-symlink regular-file identity and resolved containment before reading. The eighth Cloud Codex review found credential-bearing regular resources and symlinked source-root ancestry; sensitive filenames and high-confidence credential patterns are now rejected, and declared source roots are anchored inside the repository with every ancestor checked for symlinks. The ninth Cloud Codex review found dangling destination symlinks, conflicting terminal advertisement for typed wrappers, and advisory classification of handler-backed wrappers; destination components are now lstat-checked immediately before writes, typed wrappers own their discovery metadata, and their execution tier follows the resolved handler. The tenth Cloud Codex review found stale installed targets omitted when their candidates become blocked; `--check` now reports those preserved obsolete installations as drift instead of returning aligned. The eleventh Cloud Codex review found orphaned installed targets when a source candidate disappears entirely; receipt-backed custody tracking now detects those managed orphans without scanning or claiming unrelated user-owned skills. The twelfth Cloud Codex review found a dangling staging-index symlink escape, raw JSON parser diagnostics entering receipts, and collision evidence being overwritten by shared candidate identifiers. Staging now rejects symlinked generated artifacts before cleanup or writes, canonical parse failures emit location-only diagnostics, and colliding projections receive deterministic evidence identifiers while retaining their shared blocked target identity. Gemini approved the earlier repaired tree. A remaining Claude block was tested directly and adjudicated: legacy aliases render correctly, and resolved-root plus strict-descendant checks satisfy the declared local CLI threat model. Final review synthesis: `convene-runs/20260914T185255Z-codex-skill-parity-final-code-review/synthesis.md`.

## Falsifiers and residuals

Acceptance would be disproved by an applied `UNKNOWN` or pending candidate, copied alias behavior, a non-handler command marked `BLOCKING`, a private path in a shipped projection, a canonical/client diff, a failed runtime discovery claim, or an unresolved distinct-family blocker. None was observed.

Residuals are the two missing direct sources, the dependency-blocked `ticktock` flow, 45 unreviewed framework helpers, non-append-only first-write evidence, and broader foreign-extra coverage in `--check`. These remain explicitly outside the accepted capability claim. The instruction alias-renderer mismatch is repaired and covered by focused tests. Repository parity is both portable-verified and privately ratified for this amended tree.
