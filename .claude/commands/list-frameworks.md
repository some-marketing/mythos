---
description: List registered frameworks
mode: REVIEW_ONLY
---

<objective>
List all registered Mythos frameworks with their status, metadata, and asset completeness so the user can quickly assess the framework inventory.
</objective>

<process>
- Scan frameworks/ for all directories containing a manifest.json.
- For each framework found, read manifest.json and extract: service category, framework name, version, description, prompt count, and declared execution modes.
- Check whether each framework has skills/, commands/, and agents/ directories and note asset completeness.
- Cross-reference against instructions/canonical/system.yaml frameworks[] array to identify any unregistered frameworks on disk or registered frameworks missing from disk.
- Output a formatted table with columns: Framework ID, Version, Prompts, Modes, Assets, and Registration status.
</process>

<success_criteria>
- All frameworks with manifest.json on disk are listed
- Status includes version, prompt count, and asset completeness
- Unregistered or missing frameworks flagged
- Output formatted as a readable table
</success_criteria>

<handoff>
framework_needs_audit: audit-framework <service/framework>
unregistered_framework_found: sync-manifest
</handoff>
