# Analytics Tracking Workflow — {{CLIENT_NAME}} ({{CLIENT_CODE}})

Project: `{{PROJECT_NAME}}`
Framework: WordPress Analytics Tracking (intake → plan → implement → validate)

---

## What This Does

Assesses the current analytics/attribution state of a WordPress site, develops a
tracking plan, implements (when authorized), and validates that events and
attribution fire correctly end-to-end — from page collection through to the CRM
or destination.

## Before You Start

You'll need:
- [ ] `intake/INTAKE.md` filled in (site URL, site type, tracking goals)
- [ ] `project.json` carrying `site_url`, `site_type`, `tracking_goals`
- [ ] Read access to the site (and host/CRM credentials for deeper diagnostics, via 1Password)
- [ ] A declared execution mode (FINDINGS_ONLY for diagnostics; only escalate to writes with explicit authorization)

## Step-by-Step

### Step 1: Intake and Assessment
**Prompt:** `prompts/01_INTAKE_AND_ASSESSMENT.md` (FINDINGS_ONLY)
**What happens:** Inventories current tracking, technical environment, and privacy/consent posture; establishes a baseline.
**Output:** Assessment findings in this project's `outputs/analytics-tracking/`.

### Step 2: Tracking Plan
**Prompt:** `prompts/02_TRACKING_PLAN.md`
**What happens:** Defines the events, parameters, and attribution model to implement, grounded in the assessment.
**Output:** A tracking plan artifact.

### Step 3: Implementation
**Prompt:** `prompts/03_IMPLEMENTATION.md`
**What happens:** Implements the plan (requires explicit write authorization; respects guardrails).
**Output:** Implemented tags/config + change record.

### Step 4: Validation
**Prompt:** `prompts/04_VALIDATION.md`
**What happens:** Verifies events and attribution fire correctly end-to-end.
**Output:** Validation report.

### Optional: Full Attribution Reconciliation
Use this when page/network validation is insufficient because attribution must be
reconciled across browser events, form entries, CRM rows, and backend notes.

Inputs:
- Browser/network evidence or dataLayer capture for the tested submissions
- Form-entry export, API read, or admin evidence for the same submissions
- CRM export/API read for the same submissions
- A stable join key such as generated email, token, form id, timestamp window, or submission id
- Any backend notes/logs that record attribution transformation

Expected output:
- A reconciliation table keyed by the stable join key
- A per-field comparison of observed browser attribution, form-entry value, CRM value, and backend note value
- Explicit `Observation` and `HYPOTHESIS` sections for any dropped, overwritten, truncated, or transformed attribution field
- Evidence paths to raw exports and scripts used for the join
- A developer handoff only when the framework evidence shows the issue crosses from tracking validation into implementation review

## Guardrails

From the Mythos repo, read `frameworks/wordpress/analytics-tracking/guardrails.md`.
Never expose secrets/PII/full lead payloads; never modify live options, plugins,
CRM records, forms, or leads outside a declared, authorized write mode.
