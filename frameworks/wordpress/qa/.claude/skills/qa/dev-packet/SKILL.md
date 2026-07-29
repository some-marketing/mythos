---
name: dev-packet
description: >
  Creates a developer-facing packet readable in under 10 minutes, with an
  evidence map and clear next actions. Used to produce a concise handoff
  document for developers covering what works, what is broken, likely causes,
  and exact repro steps.
---

<objective>
Generate a high-signal developer packet (For_Dev.md) and evidence map from a
single testcase runset, synthesizing run summaries, error evidence, screenshots,
and optional export comparisons into a concise actionable document. This is a
REVIEW_ONLY workflow -- no runs are executed, no code is changed.

Reports must be **observational, not diagnostic** per 09_SHARED_BLOCKS.md § E.

**Critical observational compliance rules:**
- Use "Observation:" or "HYPOTHESIS:" labels, never "Root Cause:" or "Diagnosis:"
- Use "Open Questions for Developer Context" instead of "Recommendations"
- Use "Evidence Locations:" instead of "Action Required:" or "Next Steps:"
- Never include code snippets, implementation suggestions, or time estimates
- Never use priority labels (P0/P1/P2) or "Confidence Level: HIGH" assertions
- All interpretations must be labeled "HYPOTHESIS:" with evidence path citations

Source prompt: frameworks/wordpress/qa/prompts/12_DEV_PACKET_GENERATOR.md
</objective>

<source_prompt>
frameworks/wordpress/qa/prompts/12_DEV_PACKET_GENERATOR.md
</source_prompt>

<prompt_type>Atomic</prompt_type>

<shared_blocks_references>
- 09_SHARED_BLOCKS.md § A — Standard inputs (PROJECT_ROOT, TESTCASE_ID, RUNSET_ID)
- 09_SHARED_BLOCKS.md § B — Operating rules (REVIEW_ONLY mode)
- 09_SHARED_BLOCKS.md § E — Observational Reporting Philosophy (facts vs hypotheses)
</shared_blocks_references>

<quick_start>
1. [AUTO] Read the source prompt file for full procedural detail.
2. [USER] Collect inputs: PROJECT_ROOT, TESTCASE_ID, RUNSET_ID. **STOP and wait for user response before proceeding.**
3. [AUTO] Read all required runset artifacts (summaries, errors, screenshots, exports).
4. [AUTO] Write For_Dev.md with facts, evidence, hypotheses, and repro steps.
5. [AUTO] Write evidence.map.json with the top 10-20 artifacts tagged by purpose.
</quick_start>

<execution_rules>
  <rule id="sequential">Execute steps in strict order. Do not skip or parallelize.</rule>
  <rule id="user-protocol">[USER] — Present question, STOP, wait for response. Do not assume or infer.</rule>
  <rule id="auto-protocol">[AUTO] — Execute autonomously. Report progress. No confirmation needed.</rule>
  <rule id="gate-protocol">[GATE: condition] — If condition TRUE, behave as [USER]. If FALSE, proceed as [AUTO].</rule>
  <rule id="no-speculation">Do not read files or prepare outputs for future steps.</rule>
</execution_rules>

<context>
Before starting, run these commands to understand the current state:
- `ls <PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/` -- see runset contents
- `ls <PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/derived/` -- check for summaries
- Read `frameworks/wordpress/qa/prompts/12_DEV_PACKET_GENERATOR.md` for full procedure
</context>

<inputs>
  <required>
    <input name="PROJECT_ROOT">Path to the project root (usually playwright_phased_runner)</input>
    <input name="TESTCASE_ID">The testcase identifier</input>
    <input name="RUNSET_ID">The runset identifier</input>
  </required>
  <optional>
    <input name="INCLUDE_EXPORTS">true|false (default false) — include export comparisons</input>
  </optional>
</inputs>

<automated_workflow>
<step number="1" type="USER" name="Collect inputs">
Ask the user for required inputs:
- PROJECT_ROOT (path to playwright_phased_runner or equivalent)
- TESTCASE_ID (testcase identifier)
- RUNSET_ID (runset identifier)
- INCLUDE_EXPORTS (optional, true|false, default false)

**STOP.** Wait for user response. Do not proceed until inputs are provided.
</step>

<step number="2" type="AUTO" name="Read source prompt">
Read the full source prompt at frameworks/wordpress/qa/prompts/12_DEV_PACKET_GENERATOR.md
to ensure all procedural steps are followed exactly.
</step>

<step number="3" type="AUTO" name="Read runset artifacts">
From <PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/, read:
  - derived/runset.summary.md
  - derived/runset.manager_report.md (if present)
  - Per env (A, B, C):
    - <ENV>/derived/env.report.md (if present)
    - <ENV>/derived/run.summary.json
    - <ENV>/evidence/run.error.json (if present)
    - <ENV>/evidence/FAILURE.*.page.png (note paths if present)

If INCLUDE_EXPORTS is true and exports exist:
  - exports/compare/compare__<RUNSET_ID>__*.md
</step>

<step number="4" type="AUTO" name="Write For_Dev.md">
Create For_Dev.md (at repo root OR dev_handoff/For_Dev.md -- pick one, be consistent).

Required sections:
  - What's working (FACT -- verified from evidence)
  - What's broken (FACT + evidence paths to specific artifacts)
  - Most likely causes (HYPOTHESIS + fastest way to confirm each)
  - Questions/decisions needed from developer
  - Repro steps using the framework CLI (exact commands, copy-pasteable)

Keep under 10-minute read time. Be concise and evidence-driven.
</step>

<step number="5" type="AUTO" name="Write evidence map">
Create dev_handoff/evidence.map.json containing the top 10-20 artifacts with:
  - path: relative path to the artifact
  - purpose: tag describing what it proves (e.g., "failure_screenshot", "error_trace",
    "pass_summary", "export_mismatch")
  - description: one-line summary of the artifact's content
</step>
</automated_workflow>

<outputs>
- For_Dev.md -- concise developer handoff document (at repo root or dev_handoff/)
- dev_handoff/evidence.map.json -- tagged artifact index (top 10-20 items)
- Optional: portable handoff bundle via CLI
</outputs>

<execution_mode>
REVIEW_ONLY -- no test runs are executed, no code is modified.
Only reads existing run data and writes developer-facing summary documents.
</execution_mode>

<model_recommendation>
sonnet -- This is a concise writing and evidence synthesis task. Sonnet produces
clean, scannable developer documentation efficiently. The structured output
format (facts vs hypotheses, evidence paths) is well within sonnet's strengths.
</model_recommendation>

<observational_examples>
**WRONG (prescriptive):**
```
**Root Cause:** The attributionpath field exceeds the 100-char limit.

**Recommendations:**
1. Truncate attributionpath to 100 chars
2. Implement compact format: "source1→source2"

**Action Required:** Immediate backend fix
**Confidence Level:** VERY HIGH
```

**CORRECT (observational):**
```
**Observation:** The `{crm_field_prefix}attributionpath` field contained 253 characters.
The CRM API returned error code 0x80044331 citing a maximum length of 100 characters.

**HYPOTHESIS:** The field length (253 chars) exceeds the CRM's 100-char limit, which
may explain the API rejection. Evidence: `raw/error_logs.txt` line 17.

**Open Questions for Developer Context:**
1. What is the intended format for attributionpath?
2. Is the 100-char limit a schema constraint or API validation?

**Evidence Locations:**
- Error logs: `raw/error_logs.txt`
- Sent payload: `raw/run_0009__sent_payload__C.json`
```
</observational_examples>

<failure_modes>
| Condition | Action |
|-----------|--------|
| Runset directory missing | Flag as BLOCKING; ask user for correct path |
| No summaries exist for runset | Proceed with available evidence; note gaps in For_Dev.md |
| Report contains prescriptive content | MUST REWRITE: replace "Root Cause" → "Observation" + "HYPOTHESIS", replace "Recommendations" → "Open Questions", remove code/solutions/priorities |
</failure_modes>

<success_criteria>
- All required runset artifacts were read (summaries, errors, screenshots)
- For_Dev.md written with all five required sections
- Every "broken" item backed by an evidence path, not just a description
- Hypotheses clearly separated from facts
- Repro steps include exact CLI commands
- evidence.map.json contains 10-20 artifacts with purpose tags
- Document is concise enough for a sub-10-minute read
- No code was modified; no test runs were executed
- **Observational compliance verified:** Zero instances of "Root Cause:", "Recommendation:", "Action Required:", code snippets, P0/P1/P2 labels, or "Confidence Level" assertions in any report
- All interpretive statements use "HYPOTHESIS:" label with evidence citations
</success_criteria>
