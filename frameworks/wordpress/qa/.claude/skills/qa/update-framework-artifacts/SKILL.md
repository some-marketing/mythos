---
name: update-framework-artifacts
description: Detects changes in framework source prompts and regenerates corresponding skills, slash commands, and subagent configurations. Use when source prompts in frameworks/wordpress/qa/prompts/ have been modified and derived artifacts need updating.
---

<objective>
Scan all source prompt files in frameworks/wordpress/qa/prompts/, compare against the current skills, slash commands, and subagent configurations in .claude/, detect changes or drift, and regenerate any derived artifacts that are out of date.

This skill ensures the Claude Code integration layer (skills, commands, agents) stays synchronized with the canonical prompt definitions without modifying the source prompts themselves.
</objective>

<prompt_type>Meta-skill (orchestrator)</prompt_type>

<shared_blocks_references>
- 09_SHARED_BLOCKS.md § B — Operating rules (PATCH_ALLOWED mode for derived artifacts only)
- 09_SHARED_BLOCKS.md § G — Subagent delegation language (parallel regeneration)
</shared_blocks_references>

<source_prompt_directory>
frameworks/wordpress/qa/prompts/
</source_prompt_directory>

<derived_artifact_directories>
- Skills: frameworks/wordpress/qa/.claude/skills/qa/
- Commands: frameworks/wordpress/qa/.claude/commands/qa/
- Agents: frameworks/wordpress/qa/.claude/agents/qa/
</derived_artifact_directories>

<quick_start>
1. [AUTO] Scan all source prompts in frameworks/wordpress/qa/prompts/
2. [AUTO] Detect changes by comparing source prompts against existing skills, commands, agents
3. [AUTO] Report findings: CHANGED, NEW, ORPHANED, UNCHANGED counts
4. [AUTO] Regenerate affected artifacts (skill, command, agent) for each changed/new prompt
5. [AUTO] Handle orphaned artifacts (report but do not delete)
6. [AUTO] Validate all regenerated files (YAML, XML, paths)
7. [AUTO] Update CLAUDE.md if structural changes detected
Key deliverable: Synchronized skill/command/agent artifacts matching current source prompts.
</quick_start>

<execution_rules>
  <rule id="sequential">Execute steps in strict order. Do not skip or parallelize.</rule>
  <rule id="user-protocol">[USER] — Present question, STOP, wait for response. Do not assume or infer.</rule>
  <rule id="auto-protocol">[AUTO] — Execute autonomously. Report progress. No confirmation needed.</rule>
  <rule id="gate-protocol">[GATE: condition] — If condition TRUE, behave as [USER]. If FALSE, proceed as [AUTO].</rule>
  <rule id="no-speculation">Do not read files or prepare outputs for future steps.</rule>
</execution_rules>

<context>
Run these commands to gather current state before proceeding:
- Source prompts: ls -la frameworks/wordpress/qa/prompts/*.md
- Current skills: ls frameworks/wordpress/qa/.claude/skills/qa/*/SKILL.md
- Current commands: ls frameworks/wordpress/qa/.claude/commands/qa/*.md
- Current agents: ls frameworks/wordpress/qa/.claude/agents/qa/*.md
</context>

<prompt_to_artifact_mapping>
This is the canonical mapping from source prompts to derived artifacts:

| Source Prompt | Type | Skill Dir | Command File | Agent File |
|--------------|------|-----------|--------------|------------|
| 01_INTAKE_AND_SCAFFOLD.md | Atomic | intake-scaffold/ | intake.md | intake-agent.md |
| 02_LOCATORS_AND_CORRECTION.md | Atomic | locator-correction/ | locator-correct.md | locator-agent.md |
| 03_REPORT_AND_DEV_HANDOFF.md | Atomic | report-handoff/ | report.md | report-agent.md |
| 04_PARALLEL_RUN_MANAGER.md | Playbook | parallel-run/ | parallel-run.md | parallel-run-agent.md |
| 05_MCP_WALKTHROUGH_FINDINGS_ONLY.md | Atomic | mcp-walkthrough/ | walkthrough.md | walkthrough-agent.md |
| 06_ITERATE_UNTIL_PASS.md | Playbook | iterate-until-pass/ | iterate.md | iterate-agent.md |
| 07_IMPLEMENT_FIXES.md | Atomic | implement-fixes/ | fix.md | fix-agent.md |
| 08_RERUN_VERIFY.md | Atomic | rerun-verify/ | rerun.md | rerun-agent.md |
| 09_SHARED_BLOCKS.md | Reference | (none) | (none) | (none) |
| 10_DEEP_PIPELINE_ANALYSIS.md | Atomic | deep-pipeline-analysis/ | pipeline-analysis.md | pipeline-analysis-agent.md |
| 11_CROSS_RUN_ANOMALY_INDEX.md | Atomic | cross-run-anomaly/ | anomaly-index.md | anomaly-index-agent.md |
| 12_DEV_PACKET_GENERATOR.md | Atomic | dev-packet/ | dev-packet.md | dev-packet-agent.md |
| 13_PAYLOAD_DEEP_ANALYSIS_AND_{DEVELOPER_NAME}_HANDOFF.md | Playbook | compile-dev-bundle/ | compile-dev-bundle.md | compile-dev-bundle-agent.md |
| 14_APPEND_PAYLOAD_REPORTING_TO_EXISTING_HANDOFF.md | Playbook | append-to-dev-bundle/ | append-to-dev-bundle.md | append-to-dev-bundle-agent.md |
| 15_NAVIGATION_CLEANUP_AND_DEPRECATION.md | Atomic | navigation-cleanup/ | navigation-cleanup.md | navigation-cleanup-agent.md |
| 16_CHANGELOG_CAPTURE_FROM_DEV.md | Atomic | changelog-capture/ | changelog-capture.md | changelog-capture-agent.md |

Prompt types determine required skill tags:
- **Atomic**: `<prompt_type>`, `<shared_blocks_references>`, `<source_prompt>`, `<execution_mode>`, `<model_recommendation>`, `<quick_start>`, `<inputs>`, `<outputs>`, `<automated_workflow>`, `<success_criteria>`
- **Playbook**: All Atomic tags PLUS `<delegation_plan>`, `<acceptance_criteria>`, `<failure_modes>`
- **Reference**: No derived artifacts (09_SHARED_BLOCKS.md is reference-only)
</prompt_to_artifact_mapping>

<model_assignments>
Each prompt type has an assigned model based on complexity:

- **opus**: locator-correction, mcp-walkthrough, iterate-until-pass, compile-dev-bundle, update-framework-artifacts (browser interaction, orchestration, complex analysis)
- **sonnet**: intake-scaffold, report-handoff, parallel-run, implement-fixes, rerun-verify, deep-pipeline-analysis, cross-run-anomaly, dev-packet, append-to-dev-bundle, navigation-cleanup, changelog-capture (reasoning, code changes, straightforward analysis)
</model_assignments>

<automated_workflow>

<step number="1" type="AUTO" title="Scan source prompts">
Read all files in frameworks/wordpress/qa/prompts/ (excluding _archive/ and playbooks/ subdirectories).
Build a list of active prompt files with their modification timestamps.
Compare against the `<source_prompt>` paths referenced in each existing SKILL.md.
</step>

<step number="2" type="AUTO" title="Detect changes">
For each prompt-to-artifact mapping:
1. Read the source prompt file
2. Read the corresponding SKILL.md, command .md, and agent .md
3. Check if the SKILL.md's `<source_prompt>` tag still matches the correct file
4. Compare key structural elements:
   - Prompt type (Atomic vs Playbook vs Reference)
   - Execution mode (FINDINGS_ONLY, RUN_ONLY, PATCH_ALLOWED, REVIEW_ONLY, COORDINATOR, REPO_HYGIENE)
   - Shared blocks references (§A through §I)
   - Required inputs and their names
   - Expected outputs and their paths
   - Key workflow steps
   - Playbook-specific: delegation plan, acceptance criteria, failure modes
   - Stakeholder Interview Gate presence (prompts 03, 06, 13, 14)
5. Flag as CHANGED if any structural element differs
6. Flag as NEW if a source prompt exists without corresponding artifacts
7. Flag as ORPHANED if artifacts exist without a source prompt
</step>

<step number="3" type="AUTO" title="Report findings">
Present a change report:

```
Source Prompt Changes Detected:
- CHANGED: 04_PARALLEL_RUN_MANAGER.md (new input: FAIL_FAST_SCOPE)
- NEW: 15_NEW_PROMPT.md (no artifacts exist)
- ORPHANED: frameworks/wordpress/qa/.claude/skills/qa/old-skill/ (no source prompt)
- UNCHANGED: 11 prompts
```

If no changes detected, report "All artifacts are in sync" and stop.
</step>

<step number="4" type="AUTO" title="Regenerate affected artifacts">
For each CHANGED or NEW prompt, regenerate all three artifacts in parallel:

Launch 3 Task agents per changed prompt (skill, command, agent) using the same structural patterns as the original creation:

- **Skill**: Read source prompt, create SKILL.md with pure XML structure, YAML frontmatter. Required tags vary by type:
  - All skills: `<source_prompt>`, `<prompt_type>`, `<shared_blocks_references>`, `<execution_mode>`, `<model_recommendation>`, `<quick_start>`, `<context>`, `<inputs>`, `<outputs>`, `<automated_workflow>`, `<success_criteria>`
  - Playbook skills additionally: `<delegation_plan>`, `<acceptance_criteria>`, `<failure_modes>`
  - Skills for prompts with Stakeholder Interview Gate (03, 06, 13, 14): include gate step in `<automated_workflow>` and §F in `<shared_blocks_references>`
- **Command**: Create command .md with YAML frontmatter (description, argument-hint), XML body (objective, process, success_criteria)
- **Agent**: Create agent .md with YAML frontmatter (name, description, tools, model), XML body (role, workflow, constraints, output_format, success_criteria)

Use the model assignments from `<model_assignments>` above.
</step>

<step number="5" type="AUTO" title="Handle orphaned artifacts">
For any ORPHANED artifacts (no matching source prompt):
- Do NOT delete automatically
- Report them and recommend manual review
- The user may want to keep them or remove them
</step>

<step number="6" type="AUTO" title="Validate regenerated files">
For each regenerated file:
1. Verify YAML frontmatter is valid
2. Verify all required XML tags are present
3. Verify source_prompt path points to existing file
4. Verify execution_mode matches source prompt
5. Report validation results
</step>

<step number="7" type="AUTO" title="Update CLAUDE.md if needed">
If new prompts were added or prompt names changed:
1. Read the project CLAUDE.md (locate via the nearest parent .claude/CLAUDE.md or the repo root CLAUDE.md)
2. Update the Framework Skills, Commands, and Agents tables
3. Write the updated CLAUDE.md
</step>

</automated_workflow>

<inputs>
<required>
None - the skill auto-discovers all source prompts and artifacts.
</required>
<optional>
- PROMPT_FILTER: Specific prompt number(s) to check (e.g., "04,07" to only check those)
- DRY_RUN: If true, report changes without regenerating (default: false)
- FORCE_REGENERATE: If true, regenerate all artifacts regardless of change detection (default: false)
</optional>
</inputs>

<outputs>
- Regenerated SKILL.md files (only for changed/new prompts)
- Regenerated command .md files (only for changed/new prompts)
- Regenerated agent .md files (only for changed/new prompts)
- Change report printed to chat
- Updated CLAUDE.md (if structural changes detected)
</outputs>

<execution_mode>
PATCH_ALLOWED — modifies derived artifact files only. NEVER modifies source prompt files.
</execution_mode>

<model_recommendation>
Use opus for this skill. It requires meta-reasoning about the structure of skills, commands, and agents, understanding of execution modes, and the ability to regenerate artifacts that faithfully encode source prompt workflows.
</model_recommendation>

<success_criteria>
- All source prompts scanned and compared against existing artifacts
- Changed prompts correctly identified with specific change descriptions
- Regenerated artifacts match the structural patterns of existing artifacts
- All skills have `<prompt_type>` and `<shared_blocks_references>` tags
- Playbook skills have `<delegation_plan>`, `<acceptance_criteria>`, `<failure_modes>`
- Skills for prompts with Stakeholder Gate (03, 06, 13, 14) include §F reference and gate step
- All regenerated files pass YAML and XML validation
- Source prompt files are NEVER modified
- Orphaned artifacts are reported but not automatically deleted
- Change report is complete and accurate
</success_criteria>
