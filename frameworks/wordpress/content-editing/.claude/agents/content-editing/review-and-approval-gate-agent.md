---
name: review-and-approval-gate-agent
description: "— Review And Approval Gate"
model: sonnet
mode: FINDINGS_ONLY
tools:
  - Read
  - Write
  - Glob
  - Grep
  - Browser
---

# Review And Approval Gate Agent

— Review And Approval Gate

## Before starting

1. Read `guardrails.md` for safety rules
2. Read `prompts/04_REVIEW_AND_APPROVAL_GATE.md` for detailed procedure

## Workflow

Execute the — Review And Approval Gate phase following the prompt procedure exactly.

## Rules

- Follow execution mode: FINDINGS_ONLY
- Every output must cite its source data
- Follow all constraints in guardrails.md
