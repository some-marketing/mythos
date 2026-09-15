# Codex Skill Parity Remediation — Solo Reasoning

Recorded for the `/bp-r` deliberate leg at 2026-09-14T16:40:09Z.

## Current State

The read-only parity audit found four required direct Codex skills absent, 49 command-skill projections absent, 33 existing Codex skills rejected by the current Codex validator, 69 present command projections that may be stale, and 45 framework-local source skills without an explicit Codex exposure policy. Earlier work in this session already added a lifecycle projector, tests, adapter declarations, and the missing boot/shutdown projections. Four older lifecycle projections remain deliberately preserved because their custody is uncertain.

The repository is a heavily shared dirty worktree on an unrelated feature branch. Most `.agents/skills/**` paths are untracked, so presence is not proof of ownership. Existing plans cover framework registration, lifecycle mechanics, ticktock implementation, and outward/inward behavior, but none owns the umbrella Codex projection problem.

## Question / Work

How should Mythos close Codex skill-discovery and projection gaps without duplicating canonical authority, overstating deterministic capability, or overwriting foreign in-flight skill work?

## Desired State

Codex has an explicit projection contract, every required direct and canonical command capability is discoverable or explicitly disposed, aliases remain thin lenses over canonical targets, generated skills pass the Codex validator, framework-local access has a declared policy, and all changes are evidence-backed and custody-safe.

## Candidate Routes

1. Hand-author every missing skill. Rejected: it creates dozens of independent behavioral copies and guarantees future drift.
2. Bulk-copy Claude skills and commands into `.agents`. Rejected: Claude frontmatter is already invalid for Codex in 33 cases, and bulk writes would violate custody in the current shared tree.
3. Build one general, non-overwriting Codex projector driven by adapter policy. Preferred: canonical commands become runtime authority pointers; aliases resolve mechanically; direct skills are transformed to Codex-compatible packaging; absent outputs can be created additively; existing outputs require explicit refresh custody.
4. Export all 45 framework-local skills as global skills immediately. Deferred pending policy: framework entry routing may provide equivalent access with much lower catalog noise, and the audit did not establish a canonical destination naming contract.

## Consequential Assumptions

- `instructions/adapters/codex.yaml` is the correct project-space policy surface; this plan will not write `instructions/canonical/**`.
- Discoverability and deterministic execution are separate capability claims. A generated skill proves only discoverability unless a registered handler or runtime path is verified.
- The four direct missing skills should be projected from their current accepted Claude sources, with provenance hashes, rather than redesigned.
- Existing `.agents` files are foreign until path-level custody is established; additive creation is allowed only for paths proven absent immediately before write.
- The work should be split into a projector/tooling slice, an additive-output slice, and later custody-reviewed refresh slices. A single bulk refresh is unsafe.
- The implementation is BIG because it changes cross-harness behavior and many potential outputs, even though the first executable slice can be narrow.

## Research-Resolved Questions

- Existing owner: none; related plans own only subsets.
- Framework fit: `meta/execution-normalization` is the closest registered framework, but only at 51% with explicit gaps. Its cross-harness standardization pattern is reusable; the implementation remains bespoke.
- Direct skill sources: all four missing skills exist under `.claude/skills` with prior provenance.
- Validator: Codex `quick_validate.py` is the relevant package-format check. The repository `verify-skill.cjs` encodes older Claude layout assumptions and is not an acceptance gate for Codex packages.
- Framework-local projection: repository truth supports either collision-free `guild-<service>-<framework>` projection or entry-skill routing, but does not select one. The lower-complexity default is entry-skill routing until direct invocation is demonstrated necessary.

## Proposed Route

Create a new umbrella task plan. Adopt the current lifecycle slice as in-flight evidence, add a general projector and coverage tests, run it in additive-only mode to create absent direct/canonical/alias projections, declare framework-local access through framework entry skills for this pass, and stop before refreshing existing invalid or stale files unless custody is established. Validate the bounded slice in the real harness and send the resulting diff to a distinct-family reviewer. Follow-up refresh batches remain explicit children rather than hidden unfinished work.
