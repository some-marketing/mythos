# Reference Laws Staging Area

## Purpose

This directory holds laws that have been identified from proof surfaces but are **not yet promoted** to canonical contract status. They remain here as structured reference material until they accumulate cross-lane proof.

## Promotion Criteria

A reference law may be promoted to `instructions/canonical/contracts/` when it has:

1. **Repeated evidence beyond one package or one lane** -- the law has been observed in at least two independent proof surfaces (e.g., QA and CLIENTA, or QA and a future framework)
2. **Clear cross-framework usefulness** -- the law is not specific to a single framework's domain
3. **Stable wording** -- the formulation does not overfit the details of the originating proof surface

## Current Contents

| File | Source | Laws | Status |
|------|--------|------|--------|
| `clienta-gate-laws.yaml` | CLIENTA recovery/debug evidence package | 4 gate laws | Awaiting cross-lane proof |

## How to Use

- Reference these laws when mapping new framework proof surfaces
- Check whether new evidence supports or contradicts these candidates
- When a law meets promotion criteria, extract it into the appropriate canonical contract file and note the cross-lane evidence that justified promotion

## What Does Not Belong Here

- Laws that already have canonical status (those go in the parent directory)
- Framework-specific procedures that are not candidates for reuse
- Runtime implementation details
- Speculative architecture proposals without evidence
