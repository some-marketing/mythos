---
title: Codex Skill Parity Remediation
identified: 2026-09-14
context: bp-r blueprint from full Codex skill audit
stage: draft
---

# Codex Skill Parity Remediation

## Problem

Mythos declares strict cross-harness parity, but Codex currently lacks required direct skills and canonical-command projections, contains invalid or stale skill packages, and has no explicit policy for framework-local helper exposure. Presence on disk is also being confused with package validity, runtime discoverability, semantic parity, and mechanical enforcement.

The repository is a shared, heavily dirty worktree. Most `.agents/skills/**` paths are untracked, so a bulk replacement would risk overwriting concurrent work. Earlier lifecycle work in this session is valid in part but still preserves four drifted projections pending custody.

## Decision

Build one Codex projection controller with independently testable strategies for canonical commands, direct system skills, aliases, and framework-local helpers. The controller will:

- derive deterministic handler capability from the actual runtime registry;
- keep canonical commands as thin runtime authority pointers;
- normalize direct skills into Codex-compatible packaging while preserving their bodies and resources;
- resolve aliases dynamically rather than giving them duplicated behavioral bodies;
- stage framework-local helpers under a collision-free lineage-preserving namespace;
- stamp candidates with source provenance, hashes, capability tier, and semantic-review state;
- refuse to apply `UNKNOWN`, harness-specific, colliding, or unreviewed candidates;
- default to additive-only writes, with existing-file refreshes split into custody-reviewed child batches.

## Rationale

Hand-authored wrappers and copied command bodies are the source of existing drift. A generator is appropriate for repeatable mechanics, but only after source-family distinctions are explicit. `ground-in-philosophy` is the first negative fixture because its canonical contract contains Pi-specific behavior that must not be presented as Codex truth without an adapter override.

The daily operator vocabulary should receive priority, but alias-authority law means names such as `/owl`, `/oa`, `/go`, `/tt`, `/dl`, and `/oc` remain lenses over canonical mechanisms. Discoverability must be demonstrated in the actual Codex harness rather than inferred from valid Markdown.

## Disagreements Held

- Gemini recommended overwriting every validator-failing skill. The plan rejects this because invalid packaging does not transfer custody in a multi-actor repository.
- The initial design preferred framework entry routing; Gemini argued that granular multi-actor execution needs helper-level discovery. The plan therefore supports direct collision-free framework candidates, but stages them until lineage and semantic review pass.
- Claude recommended physical skills only for primary aliases, while Gemini recommended no physical alias wrappers. The plan follows the stricter alias-authority interpretation: dynamic resolution plus catalog evidence, with no duplicated behavior.

## Next Steps

1. Write and review the bounded task plan.
2. Execute the projector/tooling slice through a worker lane.
3. Apply only absent, reviewed-safe projections.
4. Validate packaging, resolution, discovery, and capability classification separately.
5. Route existing invalid and stale files into explicit custody-reviewed child batches.
