---
title: Gemini Draft Translator Fixture
scope_type: system
---

## Summary

Translate a structured Gemini draft into a non-authority Mythos candidate plan.

## Description

Fixture input for the Gemini plan-output translator CLI.

## Current State

Gemini can produce useful draft plans, but draft prose is not active Mythos plan authority.

## Question / Work

Convert this structured draft into canonical candidate JSON and Markdown without writing to active task-plan roots.

## Desired State

The translated candidate validates through the harness plan-output classifier and remains marked as non-authority.

## Steps

1. S1-parse: Parse the structured Gemini draft.
2. S2-render: Render candidate TaskPlan JSON and paired Markdown.
3. S3-validate: Validate the candidate bundle through the plan-output classifier.
