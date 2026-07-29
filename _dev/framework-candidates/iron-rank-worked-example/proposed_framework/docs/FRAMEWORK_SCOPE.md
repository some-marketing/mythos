# Framework Scope

## Purpose

`meta/staged-remediation` is a dev-only framework candidate for converting a staged repo-improvement playbook into a deterministic execution model.

The framework is intended to:
- read a known staged run-order document
- execute one stage at a time
- emit structured state and validation artifacts
- stop cleanly with a go/no-go decision for the next stage

This candidate follows the architecture doctrine in [`_dev/concepts/LEARNING_AND_AUTOMATION_DOCTRINE.md`](../../../../concepts/LEARNING_AND_AUTOMATION_DOCTRINE.md):
- prompts and skills provide adaptive reasoning
- validations and signals act as the control layer
- templates and scripts absorb proven repeated mechanics

## First-Pass Scope

The first pass intentionally supports only:
- Stage 1: semantic verification and framework coverage remediation

The first pass intentionally does not support:
- Stage 2 and later as executable prompt chains
- canonical registration
- promotion into shared framework inventory
- generalized runner automation

## Why This Is Dev-Only

This candidate still depends on:
- prompt-pack source material in `_dev/prompts/`
- a repo-specific staged roadmap
- replay and resume behavior that has not been proven across repeated runs

That makes it suitable for internal development use, but premature for framework promotion.
