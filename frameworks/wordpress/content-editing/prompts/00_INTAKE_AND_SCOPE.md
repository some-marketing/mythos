# 00 — Intake And Scope

> **Type**: Atomic
> **Mode**: REVIEW_ONLY
> **Purpose**: Validate that the requested WordPress content edit is concrete, bounded, and safe to execute before any admin login or mutation occurs.

---

## Overview

This prompt resolves the edit request into an executable scope.

You are not editing WordPress yet. You are deciding whether the run is safe to start.

---

## Required Inputs

- `site-config.json`
- `edit-request.json`
- `success-criteria.md`

Optional:

- `selector-hints.json`
- `reference-artifacts/`

---

## Resolve These Questions

1. What exact object is being edited?
   - post ID
   - slug
   - title
   - post type
   - environment

2. What is the approved edit scope?
   - headings
   - body copy
   - CTA text
   - CTA URLs
   - metadata fields
   - structured custom fields

3. What is explicitly out of scope?
   - layout rebuilds
   - page builder restructuring
   - theme/plugin settings
   - global blocks/templates
   - SEO or taxonomy changes not listed in the request

4. What is the publish policy?
   - capture only
   - edit but do not save
   - save as draft
   - update existing draft
   - update published page with approval
   - publish after verification

5. What defines success?
   - field-level expected values
   - rendered frontend expectations
   - allowed drift or non-goals

---

## Blocking Conditions

Stop the workflow and return `blocked_for_review` if any of the following are true:

- The target object is not uniquely identified.
- The request says "update the page" without field-level boundaries.
- Publish permission is implied but not stated.
- The change request blends content edits with layout or plugin work.
- Success criteria are subjective and undocumented.

---

## Output

Return a concise scope resolution with:

- target object
- approved edit surface
- explicit non-goals
- publish policy
- blocking questions, if any
- recommended next prompt:
  - `01_ADMIN_RECON_AND_PRE_EDIT_CAPTURE` if ready
  - stop if blocked
