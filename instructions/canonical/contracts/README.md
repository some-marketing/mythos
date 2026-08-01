# Canonical Contracts v0.2.0

## Purpose

This directory is the home of **reusable cross-framework laws** extracted from the existing Mythos system.

It exists to make explicit the contract logic that is already distributed across:
- `instructions/canonical/system.yaml`
- `instructions/canonical/guardrails.md`
- framework manifests and guardrails
- command specs
- skill bodies
- runtime control surfaces

## Contents

| File | Version | Description |
|------|---------|-------------|
| `skill-contract.schema.yaml` | 0.2.0 | Normalized contract model for skill-like work |
| `execution.yaml` | 0.2.0 | 6 execution mode definitions with allowed/forbidden actions |
| `reporting.yaml` | 0.2.0 | Observational reporting law, labels, citation rules |
| `evidence.yaml` | 0.2.0 | Evidence standards, immutability rules, completion requirements |
| `trust-tiers.yaml` | 0.2.0 | 5 trust tiers with descriptions, gating rules, evidence scaling |
| `composition.yaml` | 0.2.0 | Prerequisites, gates, escalation, artifact compatibility |
| `reference-laws/` | staging | Laws awaiting cross-lane proof before promotion |

## Version History

- **v0.1.0** (concept branch): First-pass normalized contract model from initial extraction
- **v0.2.0** (current): Full rebuild against system.yaml, guardrails.md, QA proof surface, and CLIENTA gate law evidence

## What belongs here

- Normalized contract schema for skill-like work
- Reusable execution laws
- Reusable reporting and evidence laws
- Reusable trust-tier definitions
- Minimal composition and prerequisite rules that are broadly shared

## What does not belong here

- Framework-specific procedures
- Domain-specific prompt instructions
- Runtime routing logic
- Signal validity mechanics
- Lifecycle hook implementation details
- Local proof-packet content

## Working rule

If a rule is:
- shared across multiple frameworks or controls
- conceptually stable
- useful as a generator or validator input

then it belongs here.

If a rule is:
- specific to a framework
- tightly coupled to runtime code
- still under evaluation as design analysis

it should stay elsewhere (framework-local contracts or `reference-laws/`).

## Relationship to framework-local contracts

Frameworks may specialize or narrow these contracts locally, but they must not silently weaken them. The inheritance model is:

1. System defaults (this directory)
2. Framework narrowing (`frameworks/{service}/{framework}/contracts/`)
3. Skill specialization (individual skill contract)
4. Runtime invariant enforcement (code)

## Verification

Run `node tools/verify/verify-skill-contract.cjs <path>` to validate a skill against this schema.
