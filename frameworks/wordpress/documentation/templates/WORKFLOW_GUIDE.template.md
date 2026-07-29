# Documentation Workflow — {{CLIENT_NAME}} ({{CLIENT_CODE}})

Project: `{{PROJECT_NAME}}`
Framework: WordPress Documentation (client-facing admin guides)

---

## What This Does

Generates WordPress admin documentation for your client by walking their site, capturing screenshots, detecting UI differences from templates, and writing guide content to their Notion portal.

## Before You Start

You'll need:
- [ ] Client name (as it appears in Notion)
- [ ] The client's WordPress admin URL
- [ ] Login credentials for the WordPress admin
- [ ] A Notion workspace with the portal template

## Step-by-Step

### Step 1: Initialize the Client
**Command:** `/documentation:setup <client-name>`
**You provide:** Client name
**What happens:** Finds the client in Notion, duplicates the portal template, discovers guide pages, detects the page editor (Gutenberg vs LiveCanvas), and creates a local config.
**Output:** `config.json` in the project directory

### Step 2: Capture Screenshots
**Command:** `/documentation:capture <client-code>`
**You provide:** Client code (or add a specific guide slug)
**What happens:** Logs into WordPress admin, walks each guide step, captures screenshots, detects drift from template expectations.
**Output:** Step logs and drift reports

### Step 3: Write to Notion
**Command:** `/documentation:write-notion <client-code>`
**You provide:** Client code
**What happens:** Takes the capture artifacts and generates site-specific guide content, then writes it to the Notion portal pages.
**Output:** Updated Notion pages

### Step 4: Verify
**Command:** `/documentation:verify <client-code>`
**You provide:** Client code
**What happens:** Re-walks the guide in the browser, comparing what's written against what's live. Reports discrepancies.
**Output:** Findings report (no modifications)

### Or: Run Everything
**Command:** `/documentation:full <client-code>`
**What happens:** Runs capture → write-notion in sequence.

---

## Command Quick Reference

| Step | Command | When to Use |
|------|---------|-------------|
| Setup | `/documentation:setup <name>` | First time for a client |
| Capture | `/documentation:capture <code>` | Walk site, take screenshots |
| Write | `/documentation:write-notion <code>` | Generate and push to Notion |
| Full | `/documentation:full <code>` | Capture + write in one step |
| Verify | `/documentation:verify <code>` | Check guide accuracy |
| Status | `/documentation:status <code>` | See what's been done |

## Troubleshooting

### Setup can't find the client in Notion
Make sure the client name matches exactly what's in the Notion database. Check spelling and try searching by partial name.

### Screenshots look wrong or are missing elements
The WordPress admin may have changed since the template guides were written. The drift reports from capture will flag what's different — review them before writing to Notion.

### Write-notion fails with permission errors
Check that the Notion integration has access to the portal pages. The pages may need to be shared with the integration.

### Verify reports drift on a guide you just wrote
This is expected if the site has interactive elements that render differently on each visit. Focus on structural drift (missing sections, wrong navigation), not cosmetic differences.
