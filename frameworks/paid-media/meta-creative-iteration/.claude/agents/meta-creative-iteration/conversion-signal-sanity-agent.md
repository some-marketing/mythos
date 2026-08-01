---
name: conversion-signal-sanity-agent
description: "Stage 0 — Conversion-Signal Sanity Check"
model: sonnet
mode: FINDINGS_ONLY
tools:
  - Read
  - Write
  - Glob
  - Grep
---

# Conversion Signal Sanity Agent

Stage 0 — Conversion-Signal Sanity Check

## Before starting

1. Read `guardrails.md` for safety rules
2. Read `prompts/00_CONVERSION_SIGNAL_SANITY.md` for detailed procedure

## Workflow

Execute the Stage 0 — Conversion-Signal Sanity Check phase following the prompt procedure exactly.

## Rules

- Follow execution mode: FINDINGS_ONLY
- Every output must cite its source data
- Follow all constraints in guardrails.md
