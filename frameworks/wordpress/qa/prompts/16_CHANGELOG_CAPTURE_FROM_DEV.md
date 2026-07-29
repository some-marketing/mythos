# 16 — Changelog Capture — Collect Dev Changes for QA Context

> **Type**: Atomic
> **Mode**: PATCH_ALLOWED
> **Purpose**: Collect a structured dev changelog describing recent codebase changes for QA context.
> **Agent-platform agnostic**: Works with any agent; the dev-facing prompt can be run in any LLM or terminal.

## Goal
Collect a structured changelog describing what changed (and what might have changed behavior). This changelog is typically generated **after code fixes** have been implemented, as a post-fix deliverable before handing back to QA.

## When to use
- **After implementing fixes** identified from a handoff bundle — before declaring the task complete or requesting QA to rerun.
- **Before running a new testcase** after any recent update (runner changes, mapping changes, tracking changes, CRM schema changes, form updates).
- When you are unsure whether observed behavior is a regression or an intentional change.

## Output (required)
Produce a markdown changelog report that is short, structured, and diff-friendly:
- `## Identity` (repo name, branch, from_commit, to_commit, generated_at_utc — required for downstream parsing by Prompts 13/14)
- `## Summary`
- `## Behavioral changes (high signal)`
- `## Data format / mapping changes`
- `## Risk areas / what to re-verify`
- `## Rollback/compat notes (if any)`
- `## Evidence` (commit range, PR links if available, filepaths)

---

## Step 0 — Ask the operator to collect dev input
Tell the operator:

"I need the changelog context for this analysis. Please ask the dev to copy/paste the prompt below into their environment (or into their own LLM) and paste the output back here."

---

## Step 1 — Copy/paste prompt for the dev (operator sends this to dev)

> **DEV PROMPT (copy/paste as-is)**
>
> You are generating a changelog for a testing/QA pipeline. Provide a concise, structured changelog for the **most recent update**.
>
> 1) Identify the repo + branch + deployment target (if applicable).
>
> 2) Provide the **exact commit range** to describe:
>    - `FROM_COMMIT` (last known-good / last tested / last deployed)
>    - `TO_COMMIT` (current HEAD / deployed)
>
> 3) Paste these command outputs:
>    - `git log --oneline --decorate --no-color FROM_COMMIT..TO_COMMIT`
>    - `git diff --name-status --no-color FROM_COMMIT..TO_COMMIT`
>    - `git diff --stat --no-color FROM_COMMIT..TO_COMMIT`
>
> 4) Answer these questions (bullets are fine):
>    - Did anything change that affects **form behavior** (steps, required fields, popups, selectors, conditional logic)?
>    - Did anything change that affects **tracking** (`dataLayer` events, GTM triggers, cookie setting/reading, attribution computation)?
>    - Did anything change that affects **payload formatting** (phone/date formats, province/country codes, encoding, null/empty conventions)?
>    - Did anything change that affects **CRM mapping/schema** (field names, constraints, truncation limits, connector behavior)?
>    - Are there known **environment deltas** (A/B/C differences) that changed?
>    - Any migrations/backfills or “known gaps” introduced/resolved?
>
> 5) Produce a markdown changelog with these sections (in order):
>    - Identity (repo, branch, from_commit, to_commit, generated_at_utc)
>    - Summary (3–6 bullets)
>    - Behavioral changes (what users/testcases will observe)
>    - Data/mapping/format changes (payload + CRM fields)
>    - Risk + required re-verification steps
>    - Rollback/compat notes
>    - Evidence (commit range + top filepaths changed)

---

## Step 2 — Ingest the dev’s response (LLM work)
When the dev’s changelog is pasted back:
- Summarize it into a short "Change context" section.
- Extract a checklist of **what the next testcase run must verify** (focus on behavior + data format + CRM mapping).
- If any details are missing (no commit range, no diffstat, vague claims), ask for the missing pieces explicitly.

---

## Step 3 — Save the changelog to canonical location + bundle (required)

### 3a) Save to canonical location (always)

1. Parse the changelog's `## Identity` section to extract:
   - `generated_at_utc` → date component (`YYYY-MM-DD`)
   - `from:` → from_commit (short hash or tag)
   - `to:` → to_commit (short hash or tag)

2. Save the changelog to:
   - `playwright_phased_runner/changelogs/dev_changelog__{date}__{from}__{to}.md`
   - If commit range is unknown, use: `dev_changelog__{date}__manual.md`

3. Update `playwright_phased_runner/changelogs/LATEST.txt` with the filename (one line, filename only).

### 3b) Save to bundle (if a bundle context exists)

If the run/reporting process creates a handoff bundle, also save:
- the dev-provided changelog markdown as `raw/dev_changelog.md`
- a machine-friendly extracted checklist as `raw/dev_changelog.checklist.json`

Also reference these paths in the bundle index/manifest so downstream LLMs read them first.

