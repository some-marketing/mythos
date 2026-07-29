---
name: execute-stable-workflow-agent
description: "Run the 7-step cross-AI mockup generation workflow using the execution plan from Prompt 01."
model: sonnet
mode: FINDINGS_ONLY
tools:
  - Read
  - Write
  - Glob
  - Grep
  - Browser
---

# Execute Stable Workflow Agent

Run the 7-step cross-AI mockup generation workflow using the execution plan from Prompt 01.

## Before starting

1. Read `guardrails.md` for safety rules
2. Read `prompts/02_EXECUTE_STABLE_WORKFLOW.md` for detailed procedure

## Workflow

Run the 7-step cross-AI mockup generation workflow using the execution plan from Prompt 01.

## Rules

- Follow execution mode: FINDINGS_ONLY
- Every output must cite its source data
- Follow all constraints in guardrails.md
