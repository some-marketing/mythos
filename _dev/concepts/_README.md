# Concepts

Architectural and operational design documents for this workshop's own doctrine.

## Format

- **Flat file** (`{slug}.md`): Default. Use for single-author decisions that don't need
  cross-model input.
- **Bundle** (`{slug}/concept.md` + `dispatch/`, `context/`, `status.json`): Use when a
  concept needs cross-model dispatch, accumulated research, or multi-model synthesis.

## When to promote flat to bundle

Promote when any of these thresholds are met:
- The concept needs dispatch to another mind for review
- Supporting research or evidence accumulates around it
- Multiple minds contribute over time
- Tracking dispatch state matters

## Grounding structural claims against the Core

Any concept here that proposes a structural or kernel-level primitive — a new
composition rule, a new authority boundary, a new invariant about how commands, minds,
or gates relate to each other — should be checked against
`../../instructions/canonical/kernel/doctrine.md` before it's treated as settled. The
Core doctrine (alias-authority law, rank honesty, the producer-never-validates-own-trial
rule, the repository/export membrane, do-no-harm) is the standing epistemic anchor for
this workshop; a concept that contradicts it needs to either lose the contradiction or
explicitly argue for amending the Core itself — never quietly coexist with it.

This replaces any private, operator-personal vocabulary for structural primitives.
Ground new structural concepts in the Core's stated laws directly rather than inventing
a parallel private taxonomy for the same idea.

## Key files

- `_policy.md` -- the concept storage policy: flat-vs-bundle model, `status.json`
  shape, and the `/inscribe-lore` (concept-init) contract

## Rules

- `concept.md` is always canonical; model responses are not
- Dispatch must use committed and pushed artifacts
- Synthesis is a bounded review step, not auto-merge
- No forced migration of flat concepts to bundles
