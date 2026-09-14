# Plan Amendment: Mythos Full Parity Port for Codex Skill Parity

**Plan:** `codex-skill-parity-remediation`
**Amendment:** `mythos-full-parity-port__codex-skill-parity-remediation__20260914T173619Z`
**Risk:** remains high
**Status:** approved for execution

## Trigger

PR #32 passed the scoped implementation checks and independent implementation review, but both portable CI verification jobs rejected the changed tree. The new skill packages, projector tooling, derived instructions, and evidence artifacts are not registered in the repository's protected exact-tree parity baseline.

This is a material new gate and output set, so it requires the reviewed amendment named by `parity/README.md`. The original plan remains unchanged.

## Amended execution boundary

The amendment adds only these responsibilities:

1. Remove the philosophy-grounding report from the public tracked surface and retain it only in a local private archive. Replace the two literal home-path findings with portable wording or fixture-derived construction while preserving semantics and negative-test behavior.
2. Finalize the amendment and review evidence before computing exact-tree state.
3. Resolve the five fresh PR review findings. Four are bounded projector repairs. The fifth requires a minimal instruction-loader correction so the canonical array-form alias registry renders named, typed aliases instead of numeric aliases with undefined targets.
4. Regenerate derived instructions and require both projector and alias regression tests to pass.
5. Regenerate `parity/wiring-graph.json` and require zero unresolved nodes.
6. Use the repository's target-only parity repair to register the legitimate target additions.
7. Preserve every `baseline.source` field verbatim, including the private-denylist hash. Do not run full source regeneration without the authoritative private inputs.
8. Run portable parity verification and authoritative private-denylist ratification, plus the parity test suite, focused tests, instruction validation, and diff checks.
9. Commit and push only if all gates pass, then confirm PR #32 checks.

Portable verification and private-denylist ratification remain separate evidence tiers. The authoritative external file has now been recovered and its digest matches the baseline binding; its location and contents remain outside tracked artifacts.

## Why the private denylist is not required for this bounded path

The full baseline builder needs the plaintext private denylist because it recalculates source bindings and contamination vocabulary. This amendment does not recalculate or alter source authority. The repository includes a target-only repair tool specifically for legitimate target-tree changes; it preserves the existing source commit and denylist hashes and refreshes only target inventory and wiring data.

If independent review finds that the target-only tool is not authorized for this change, execution stops. The amendment does not permit substituting an example denylist or fabricating private input.

## Added acceptance criteria

- `npm run verify:parity` returns `ok: true` with no findings.
- Authoritative private-denylist verification passes against the existing bound hash without serializing the file or its location.
- The private-denylist hash and all other source provenance fields remain unchanged.
- The regenerated wiring graph has zero unresolved nodes.
- All five fresh PR review findings have passing regression coverage or a documented evidence-based rebuttal.
- Independent review confirms no export-map authority was widened and no contamination gate was suppressed.
- PR #32 required checks pass after the amended commit is pushed.

## Independent review

The amendment was reviewed through the distinct-provider run `20260914T174455Z-codex-skill-parity-amendment-review`. Claude Sonnet 4 and Gemini 2.5 Pro both returned `APPROVE` and explicitly authorized the bounded target-only sequence with source provenance preserved.

## Exact next command

`/run-plan codex-skill-parity-remediation`
