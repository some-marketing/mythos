# 06 — Dev Handoff

| Field | Value |
|-------|-------|
| **Framework** | wordpress/seo-validation |
| **Prompt** | 06 of 6 |
| **Execution Mode** | REVIEW_ONLY |
| **Dependencies** | `reports/findings.md`, `checks/results.json`, `checks/*.json` detail files, `crawl/page-inventory.json` |
| **Guardrails** | `frameworks/wordpress/seo-validation/guardrails.md` |

## Purpose

Classify SEO validation findings by responsible actor, filter out resolved and false-positive issues, and produce a self-contained dev handoff artifact that a developer without Mythos access can act on directly.

---

## Step 1 — Read artifacts [AUTO]

Read all required artifacts:

| Artifact | Path | Required |
|----------|------|----------|
| Findings report | `reports/findings.md` | Yes |
| Check results | `checks/results.json` | Yes |
| Check detail files | `checks/{check_id}.json` | If referenced |
| Page inventory | `crawl/page-inventory.json` | Yes |
| Mobile results | `mobile/results.json` | If present |
| Known issues | `known-issues.json` (project input) | No |
| Site config | `site-config.json` (project input) | Yes |

---

## Step 2 — Classify findings by actor [AUTO]

For each failed or warned check in `checks/results.json`, classify into exactly one actor category:

| Actor | Code | Description | Examples |
|-------|------|-------------|----------|
| Developer | `dev` | Requires code, template, or plugin changes | H1 tag structure, structured data implementation, plugin configuration |
| Content | `content` | Requires text/media editing in WP admin | Alt text, meta descriptions, page copy |
| SEO Config | `seo-config` | Requires SEO plugin settings changes | OG tag enablement, sitemap scope, robots rules |
| Resolved | `resolved` | Already fixed since the crawl | Operator-confirmed fixes |
| False Positive | `false-positive` | Expected behavior misidentified as failure | Dynamic URLs from plugins, query-string variations, JS-generated paths |
| Framework | `framework-improvement` | The check itself needs refinement | Over-broad link validation, missing page-type awareness |

Classification rules:
- If a check's affected URLs are all dynamic/query-string URLs from a known plugin pattern → `false-positive`
- If a check failure maps to an existing known-issues.json entry → `resolved` or `false-positive`
- If a check requires changes in WordPress admin content fields → `content`
- If a check requires SEO plugin dashboard changes only → `seo-config`
- If a check requires template/code/plugin changes → `dev`
- If the check logic itself is too broad for the site type → `framework-improvement`

Write classification to `handoff/classification.json`:

```json
{
  "classified_at": "ISO-8601",
  "total_findings": N,
  "by_actor": {
    "dev": N,
    "content": N,
    "seo-config": N,
    "resolved": N,
    "false-positive": N,
    "framework-improvement": N
  },
  "findings": [
    {
      "check_id": "string",
      "check_name": "string",
      "status": "fail|warn",
      "actor": "dev|content|seo-config|resolved|false-positive|framework-improvement",
      "actor_rationale": "string — why this actor",
      "affected_count": N,
      "summary": "string",
      "dart_task_id": "string|null — if maps to an existing Dart task"
    }
  ]
}
```

---

## Step 3 — Build dev handoff document [AUTO]

Produce `handoff/DEV_HANDOFF.md` — a standalone document readable by a developer who has NO access to Mythos, frameworks, or this toolchain.

Structure:

```markdown
# SEO Validation — Developer Handoff

**Site:** {site_url}
**Crawled:** {date}
**Prepared for:** {developer name from site-config or "Development Team"}
**Prepared by:** {operator — from site-config or "SEO Validation Framework"}

## Overview

{2-3 sentences: what was tested, how many pages, overall health}

## Action Items — Developer

{For each finding classified as `dev`:}

### {N}. {Check Name}
**What was found:** {plain-language observation — no jargon, no framework terms}
**How many pages:** {count}
**Example pages:**
{up to 5 URLs}
**Evidence file:** {path relative to output dir}
**Related Dart task:** {ID and link, or "None"}

## Action Items — SEO Plugin Configuration

{For each finding classified as `seo-config`:}
{Same format as above}

## Content Tasks (Not Developer)

{For each finding classified as `content` — listed for awareness but clearly marked as NOT the developer's responsibility}

## Not Actionable

{For each finding classified as `false-positive` or `framework-improvement`:}
- **{Check Name}:** {why it's not actionable} — {what will be done about the check}

## Resolved Since Crawl

{For each finding classified as `resolved`:}
- **{Check Name}:** Resolved — {brief note}

## Reference

- Full findings report: `reports/findings.md`
- Check results: `checks/results.json`
- Page inventory: `crawl/page-inventory.json`
- Mobile screenshots: `mobile/screenshots/`
```

Rules for the dev handoff document:
- **No Mythos terminology** — no "framework," "prompt chain," "guardrails," "observational reporting"
- **No code suggestions** — describe the problem, not the solution
- **Plain language** — write for a WordPress developer, not an LLM operator
- **Self-contained** — everything needed to understand the issue is in the document
- **Evidence paths** are relative to the output directory

---

## Step 4 — Build content task list [AUTO]

If any findings are classified as `content`, produce `handoff/CONTENT_TASKS.md`:

```markdown
# Content Tasks from SEO Validation

**Site:** {site_url}
**Date:** {date}

## Tasks

### {N}. {Check Name}
**What needs to change:** {plain description}
**Pages affected:** {count}
{list of URLs}
**Current state:** {what's there now — e.g., "47 images have no alt text"}
**Evidence:** {path}
```

This document can be consumed by the content-editing framework (`wordpress/content-editing`) as input for bounded content edits.

---

## Step 5 — Present for review [USER]

Present to the operator:
1. Classification summary (how many findings per actor)
2. Dev handoff document preview (first 3 action items)
3. Content task list preview (if any)
4. Any findings that were hard to classify — ask for operator input

**GATE:** Do not write to external systems (Dart, etc.) until operator approves the classification and handoff documents.

---

## Output Artifacts

| Artifact | Path | Required |
|----------|------|----------|
| Classification | `handoff/classification.json` | Yes |
| Dev handoff | `handoff/DEV_HANDOFF.md` | Yes |
| Content tasks | `handoff/CONTENT_TASKS.md` | If content findings exist |
