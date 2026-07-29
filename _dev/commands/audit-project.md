---
description: Run full full project audit — mechanical verification + LLM analysis
argument-hint: "[framework-id|all]"
allowed-tools: Bash, Read, Glob, Grep, Agent
---

> DRAFT — a worked example of a command draft living in `_dev/commands/` (the
> scriptorium annex). When proven in use, a draft like this gets promoted to
> `.claude/commands/` with a mythic primary name and a registry alias.

<objective>
Validate the entire Mythos project by running mechanical verification scripts,
then dispatching the framework-auditor agent for LLM-tier nuance on any
failures or warnings. Produces a timestamped audit report in _dev/reports/analysis/audit/.
</objective>

<process>
1. **Parse arguments**
   - If `$ARGUMENTS` is a framework ID (e.g., `wordpress/qa`), audit that framework only.
   - If `$ARGUMENTS` is "all" or empty, audit the full system + all registered frameworks.

2. **Run mechanical verification (Tier 1)**

   For full audit:
   ```bash
   npm run verify 2>&1          # verify-system (system.yaml cross-refs, guardrails)
   npm run verify:guardrails 2>&1  # guardrails section completeness
   ```

   For each framework (all registered, or the one specified):
   ```bash
   npm run verify:framework -- {framework-id} 2>&1
   ```

   Collect all VerificationSignal JSON from `tools/verify/.scratch/`.

3. **Analyze signals**
   - Read each `.signal.json` file from `tools/verify/.scratch/`
   - Categorize: PASS (no action), WARN (note in report), FAIL (requires LLM analysis)
   - Count totals across all scripts

4. **Run LLM analysis (Tier 2) — only if failures or warnings exist**
   - For each framework with FAIL or WARN signals, dispatch the `framework-auditor` agent
     with the signal JSON as context
   - The auditor adds nuance: is the failure structural or cosmetic? What's the fix priority?
   - For system-level failures, analyze directly (guardrails gaps, orphaned frameworks, etc.)

5. **Produce audit report**
   - Generate timestamp: `YYYY-MM-DD__HHmmss`
   - Write report to: `_dev/reports/analysis/audit/AUDIT_REPORT__{timestamp}.md`
   - Copy signal JSON files to: `_dev/reports/analysis/audit/signals/`

   Report structure:
   ```markdown
   # Mythos Project Audit Report
   **Date:** {timestamp}
   **Scope:** {all | framework-id}

   ## Mechanical Verification (Tier 1)
   | Script | Scope | Verdict | Checks | Failures |
   {table of all verification results}

   ## Findings
   ### Critical
   {any FAIL items with fix hints from signals + LLM analysis}

   ### Warnings
   {any WARN items with context}

   ## Framework Status
   | Framework | Verdict | Checks Passed | Notes |
   {per-framework summary}

   ## Recommended Actions
   {prioritized list derived from findings}
   ```

6. **Report to user**
   - Print summary: total checks, pass rate, critical count, report path
   - If all PASS: "Clean audit — no action needed"
   - If WARN only: "Non-blocking warnings found — see report"
   - If FAIL: "Critical issues found — see report for details"
</process>

<context>
Verification scripts: `tools/verify/verify-*.cjs`
Signal output: `tools/verify/.scratch/*.signal.json`
Audit output: `_dev/reports/analysis/audit/`
Framework auditor agent: `.claude/agents/framework-auditor.md`
</context>

<success_criteria>
- All registered frameworks verified mechanically
- System-level verification completed
- Signal JSON files collected and archived
- Timestamped report written to _dev/reports/analysis/audit/
- Critical issues clearly identified with fix hints
- User receives summary with actionable next steps
</success_criteria>
