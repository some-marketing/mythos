---
description: Bookshelf — list all registered grimoires (frameworks) with status
allowed-tools: [Read, Glob, Grep]
---

> Authority: `list-frameworks` — this mythic name is an alias; state and errors belong to the resolved command.

<objective>
Walk the bookshelf: list all registered grimoires (frameworks) with their status and metadata.
</objective>

<process>
1. Scan `frameworks/` for all directories containing a `manifest.json` (a grimoire's stat block).
2. For each grimoire found:
   - Read `manifest.json`
   - Display: service category, grimoire name, version, description, prompt count
   - Check if skills/commands/agents directories exist
3. Output as a formatted table.
</process>

<success_criteria>
- All grimoires with manifest.json are listed
- Status includes version, prompt count, and asset completeness
- Output formatted as a readable table
</success_criteria>
