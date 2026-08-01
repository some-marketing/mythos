---
name: research/reference-compare
description: Compare a NEW artifact (research report, design brief, technical spec, audit) against a KNOWN-GOOD reference artifact from a prior successful project. Scores parity on N named dimensions, produces a verdict (SUFFICIENT / SUFFICIENT-WITH-NOTES / GAPS-TO-BACKFILL) with specific gaps, mitigation effort estimates, and a readiness assessment. Activates when the operator says "compare this research to <prior project>", "is this report deep enough", "benchmark this brief against the <X> brief", or names a new artifact alongside a prior reference. Output is qualitative analysis MD; success is operator-judged not grep-able.
status: provisional
graduation_criteria: Promote to stable after 3+ successful invocations across at least 2 distinct artifact types (e.g., research report, technical spec, audit) with operator confirmation that the verdict + gaps drove a correct downstream decision in each case. Do not graduate on lower evidence per LEARNING_AND_AUTOMATION_DOCTRINE §Promotion Rule. Reason the threshold is this specific: the underlying pattern has exactly one successful execution at authoring time ({CLIENT_CODE}-vs-maher-research-comparison.md, 2026-04-22). Three invocations across two artifact types provides repeat-success across distinct shapes; single-shape repeats would not falsify the heuristic that the pattern only fits research reports.
---

<skill>

<objective>
Compare a NEW artifact under evaluation against a KNOWN-GOOD reference artifact from a prior successful project, score parity on N named dimensions with file-path citations, produce a verdict + specific gaps + readiness assessment + recommended next move. The operator uses the output to decide: proceed to next phase, backfill specific items, or escalate.

This skill exists because "is the new work deep enough?" is asked over and over across projects, and the answer is almost always reached the same way: pull the closest prior win, list the dimensions that mattered there, walk both artifacts dimension-by-dimension, and surface specific gaps with mitigation effort. The pattern was proven this session at `_dev/reports/analysis/{CLIENT_CODE}-vs-maher-research-comparison.md` ({CLIENT_CODE} vs Maher Mechanical Perplexity research, 6 dimensions, SUFFICIENT-WITH-NOTES verdict, drove a correct "proceed to mockup with one <30 min reference pull" decision).
</objective>

<prompt_type>Worker</prompt_type>

<execution_mode>REVIEW_ONLY — reads two artifacts, produces analysis MD. No mutation of input artifacts or downstream surfaces.</execution_mode>

<model_recommendation>sonnet — qualitative reasoning over two text artifacts; opus is overkill, haiku misses subtle parity calls</model_recommendation>

<quick_start>
```bash
/reference-compare \
  --new <path-to-artifact-under-evaluation> \
  --reference <path-to-known-good-reference-artifact> \
  --scope <client-code|system> \
  [--dimensions <comma-separated-list>] \
  [--name <comparison-name-for-output-file>]
```

Example:
```bash
/reference-compare \
  --new clients/{CLIENT_CODE}/projects/elsweb/research/perplexity-deep-research-raw-output.md \
  --reference clients/MAHR/projects/maher-website/research/web_dev_framework_reference.pdf \
  --scope {CLIENT_CODE} \
  --name research-set-comparison
```
</quick_start>

<execution_rules>
<rule id="hard-precondition-files">[PROTOCOL] — REFUSE to run if `--new` or `--reference` paths do not exist or are not readable. Report the missing path and stop.</rule>
<rule id="hard-precondition-scope">[PROTOCOL] — REFUSE to run if `--scope` is missing. Output path depends on it; cannot guess.</rule>
<rule id="read-both-fully">[PROTOCOL] — Read both artifacts fully before assessing any dimension. PDF support via Read tool's `pages` parameter (chunk by 20 pages if large).</rule>
<rule id="cite-or-skip">[PROTOCOL] — Every dimension finding must cite specific section/file from each artifact. If a citation cannot be produced for a side, mark that side "absent" rather than asserting parity.</rule>
<rule id="no-input-mutation">[PROTOCOL] — Never modify either input artifact. This is REVIEW_ONLY.</rule>
<rule id="verdict-discipline">[PROTOCOL] — Verdict must be exactly one of: SUFFICIENT / SUFFICIENT-WITH-NOTES / GAPS-TO-BACKFILL. No softer verdicts, no scores, no percentages.</rule>
<rule id="effort-estimate-required">[PROTOCOL] — Each enumerated gap must include a mitigation suggestion AND a coarse effort estimate (e.g., "<30 min", "~2 hr", "half-day", "blocked on operator input").</rule>
<rule id="subagent-write-fallback">[PROTOCOL] — When invoked from a subagent context, write to `_dev/reports/analysis/` may be denied (documented gap I-2 in `_dev/reports/analysis/run-debrief__elsweb-kickoff-2026-04-22.md`). Fallback contract: return findings inline as the final assistant message; the parent context persists. Do not silently skip the artifact.</rule>
<rule id="dimension-source-of-truth">[PROTOCOL] — Dimensions come from `--dimensions` flag if provided; otherwise from artifact-type heuristic (see context). Do not invent ad-hoc dimensions mid-comparison.</rule>
</execution_rules>

<context>

## Inputs and paths

- **`--new`**: absolute or repo-relative path to the artifact under evaluation. May be `.md`, `.pdf`, `.txt`, or any text-readable format.
- **`--reference`**: absolute or repo-relative path to the known-good reference artifact. Same format constraints.
- **`--scope`**: one of `system` (cross-cutting analysis) or a client code (`{CLIENT_CODE}`, `MAHR`, `{CLIENT_CODE}`, etc.).
- **`--dimensions`** (optional): comma-separated dimension names. If omitted, infer from artifact type.
- **`--name`** (optional): kebab-case slug for the output filename. Default: `<new-basename>__vs__<reference-basename>`.

## Output paths

- **System scope**: `_dev/reports/analysis/<name>__system.md`
- **Client scope**: `clients/<CODE>/projects/<project>/outputs/<name>.md` — if `<project>` cannot be inferred from the `--new` path, fall back to `clients/<CODE>/comparisons/<name>.md` and warn.

## Dimension heuristics (when `--dimensions` not provided)

| Artifact type | Default dimensions |
|---|---|
| Research report (Perplexity/competitive/market) | business-context-capture, competitor-analysis, content-strategy, technical-recommendations, brand-visual-direction, actionable-specificity-for-next-phase |
| Design brief / direction | palette, typography, layout, CTA-hierarchy, voice-and-tone, reference-evidence |
| Technical spec / architecture | scope-and-bounds, dependencies, risks-and-failure-modes, test-and-verification-plan, rollback-and-migration |
| Audit (codebase / config / security) | findings-coverage, evidence-citations, severity-classification, mitigation-specificity, scope-boundary-discipline |
| Plan / proposal | objective-clarity, gates-and-acceptance, risks-enumerated, ownership-and-actor-routing, evidence-of-feasibility |

If artifact type cannot be inferred, ask the operator OR refuse with a list of supported types.

## Reference exemplar

`_dev/reports/analysis/{CLIENT_CODE}-vs-maher-research-comparison.md` — the proof-of-pattern artifact. Future invocations should match its shape: bold one-line verdict at top, 3-5 line summary, side-by-side table, per-dimension findings with file-path citations, specific-gaps section with mitigation+effort, readiness assessment, recommended next move.

</context>

<automated_workflow>

<step name="validate-inputs" type="AUTO">
1. Confirm `--new` and `--reference` paths exist and are readable. If either fails, refuse and report which path failed.
2. Confirm `--scope` provided. If not, refuse.
3. Compute output path per scope rules. If client-scope project cannot be inferred, fall back path + warn.
</step>

<step name="read-artifacts" type="AUTO">
1. Read `--reference` fully. For PDFs, use Read tool's `pages` parameter; chunk by 20 pages if larger.
2. Read `--new` fully, same approach.
3. If either artifact is empty or unreadable post-Read, refuse and report.
</step>

<step name="determine-dimensions" type="AUTO">
1. If `--dimensions` provided, parse comma-separated list and use verbatim.
2. Else: infer artifact type from filename + content cues (research / brief / spec / audit / plan), look up default dimensions from heuristic table.
3. If artifact type ambiguous: enumerate the candidates and ask the operator (or, in subagent mode, pick best-fit and note the assumption in output).
</step>

<step name="dimension-by-dimension-assessment" type="AUTO">
For each dimension:
1. Locate the corresponding section/coverage in the reference artifact. Cite file path + section.
2. Locate the corresponding section/coverage in the new artifact. Cite file path + section.
3. Score parity: NEW stronger / parity / REFERENCE stronger / NEW lacks / REFERENCE lacks.
4. Describe substantive delta in 2-4 sentences with concrete details (numbers, names, specific findings) — not vague "more thorough" judgments.
</step>

<step name="produce-verdict" type="AUTO">
Synthesize a single verdict from the dimension scores:
- **SUFFICIENT**: NEW meets or exceeds REFERENCE on all material dimensions; no enumerated gaps.
- **SUFFICIENT-WITH-NOTES**: NEW meets or exceeds REFERENCE on most dimensions; 1-3 small gaps that are clearly mitigable in <half-day or by routine operator input.
- **GAPS-TO-BACKFILL**: NEW materially lacks REFERENCE on 2+ dimensions OR has at least one gap requiring fresh research / fresh operator decision / framework-level work.
</step>

<step name="enumerate-gaps" type="AUTO">
For each dimension where REFERENCE was stronger or NEW lacked:
1. Name the specific thing the reference had.
2. Suggest a mitigation (what action would close it).
3. Estimate effort: `<30 min`, `~2 hr`, `half-day`, `~1 day`, `multi-day`, `blocked on operator input`, `blocked on external dependency`.
4. Flag whether the gap is blocking for the next phase or merely nice-to-have.
</step>

<step name="readiness-assessment" type="AUTO">
Two paragraphs:
1. **Can the new artifact drive the next phase?** Concrete yes/no with the specific things the artifact does and does not enable.
2. **What's blocking vs optional?** Distinguish gaps that gate next-phase work from gaps that would only improve quality.
</step>

<step name="recommend-next-move" type="AUTO">
Single recommendation, one of:
- **Proceed**: next phase can begin without backfill. Name the next command/action.
- **Backfill specific item(s)**: enumerate the must-do items + their effort. Then proceed.
- **Escalate**: gaps require operator input or framework-level work before next phase is safe. Name the decision needed.
</step>

<step name="write-output" type="AUTO">
1. Write the analysis MD to the computed output path using the required output template (see Outputs).
2. If write fails (subagent permission denial), return the full content inline in the final assistant message and note the fallback was triggered.
3. Report the output path back to the caller.
</step>

</automated_workflow>

<inputs>
<required>
<input name="--new">Path to the artifact under evaluation</input>
<input name="--reference">Path to the known-good reference artifact</input>
<input name="--scope">`system` or a client code (`{CLIENT_CODE}`, `MAHR`, etc.)</input>
</required>
<optional>
<input name="--dimensions">Comma-separated dimension names. If omitted, inferred from artifact-type heuristic.</input>
<input name="--name">Kebab-case slug for output filename. Default: `<new-basename>__vs__<reference-basename>`.</input>
<input name="--project">Project slug (only used for client scope; auto-inferred from `--new` path when possible).</input>
</optional>
</inputs>

<outputs>
<output name="comparison-analysis">Analysis MD written to `_dev/reports/analysis/<name>__system.md` (system scope) or `clients/<CODE>/projects/<project>/outputs/<name>.md` (client scope). Required template:

```markdown
# <Comparison Title>

**Captured:** <YYYY-MM-DD>
**New artifact:** <path>
**Reference artifact:** <path>
**Dimensions:** <comma-separated list, source: flag|heuristic>

## Verdict

**<SUFFICIENT | SUFFICIENT-WITH-NOTES | GAPS-TO-BACKFILL>** — <one-sentence justification>

## Summary

- 3-5 bullets capturing the headline parity story

## Side-by-side summary table

| Dimension | Reference coverage | New coverage | Parity verdict |
|---|---|---|---|
| ... | ... | ... | NEW stronger / parity / REFERENCE stronger / NEW lacks |

## Per-dimension findings

### N. <Dimension name>
- **Reference** (`<file>` §<section>): <substantive details with citations>
- **New** (`<file>` §<section>): <substantive details with citations>
- **Delta:** <one-sentence judgment>

(repeat for each dimension)

## Specific gaps (Reference had, New lacks)

1. **<Gap name>.** <What the reference had.> *Mitigation:* <action>. *Effort:* <estimate>. *Blocking:* yes|no.

(repeat for each gap)

## Readiness assessment

<Two paragraphs: can next phase proceed; what's blocking vs optional>

## Recommended next move

**<Proceed | Backfill <items> then proceed | Escalate>** — <specific next command or decision>
```
</output>
<output name="inline-fallback">When write to output path is denied (subagent context), the full analysis MD is returned in the final assistant message instead, with a note that the parent context should persist it.</output>
</outputs>

<success_criteria>
- Both input artifacts read fully and cited specifically
- Dimensions selected from `--dimensions` flag or heuristic, not invented mid-flight
- Each dimension has citations from both sides (or explicit "absent on side X")
- Verdict is one of the three allowed values
- Each enumerated gap has mitigation + effort estimate
- Readiness assessment distinguishes blocking from optional
- Recommended next move is a concrete action, not "consider X"
- Output written to correct path per scope, OR fallback inline return when write denied
- No mutation of either input artifact
</success_criteria>

</skill>
