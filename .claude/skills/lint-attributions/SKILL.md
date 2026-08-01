---
name: lint-attributions
description: >
  Scans generated content for fabricated testimonial-shaped quotes with
  named-source attributions. Use after authoring briefs, mockups, copy, or any
  client-facing artifact to catch inserted-without-evidence quotes like
  "— Halifax Theatre Notes, 2023" or "— Atlantic Festival Producer". Activates
  when you've just authored content that includes prose quotes followed by
  attribution lines, OR when reviewing artifacts before client delivery.
version: 1.0.0
---

<skill>
<objective>
Detect fabricated testimonial-shaped content in generated artifacts before it reaches the client. Both Claude and external models (Gemini, etc.) default to inserting plausibility-shaped attributions when authoring placeholder copy. This skill is the authoring-time guard that the standing memory rule (`feedback_enforce_clarity_in_attribution`) cannot enforce alone.
</objective>

<when_to_use>
- After authoring or generating any client-facing artifact that may include testimonials, pull-quotes, press citations, or attributed statements
- Before committing or sending any deliverable that contains quoted content
- When reviewing a subagent or external-model output (Gemini, Codex, etc.) that authored copy
- After running any framework prompt that produces brief / mockup / copy output (especially `wordpress/design-research`, `paid-media/ad-creative`, `wordpress/page-cro`)
</when_to_use>

<when_not_to_use>
- Code-only artifacts with no prose
- Configuration files
- Internal planning artifacts (plans, signals, debriefs) — these are operator-facing and document fabrication context naturally
- Files where every quote is sourced (academic citations, well-evidenced research synthesis with confirmed source URLs)
</when_not_to_use>

<process>
1. **Identify scan targets.** Take a file path, directory, or git diff range as input. If no input given, scan files modified in the last commit on the current branch.
2. **Run the lint scan.** Invoke `node tools/lint/fabricated-attributions.cjs <path>` for each target. The runner emits findings in JSON + text formats.
3. **Classify each finding** as one of:
   - **fabricated** — quote with named attribution (person, organization, publication) that is NOT cited from a verifiable source elsewhere in the project (no matching client testimonial file, no email evidence, no intake field)
   - **placeholder-acceptable** — uses lorem ipsum body OR explicit `[testimonial pending]` / `[citation pending]` markers
   - **evidence-backed** — attribution maps to a known source (intake testimonials_references, a captured email, a documented credit)
4. **Report.** For each fabricated finding: file path, line number, the quote text, the suspect attribution, and the recommended fix (replace with lorem ipsum, replace with placeholder marker, or cite real evidence).
5. **Optional: auto-fix.** If `--fix` flag passed AND only `fabricated` findings exist (no judgment calls needed), replace fabricated attributions with `[attribution pending — client to provide]` placeholder text. Flag what was changed for operator review.
</process>

<detection_patterns>
The runner uses these regex/heuristic patterns:

**Pattern 1 — Em-dash + attribution after quote (most common):**
```
"<quote>"
— <Name | Organization | Publication>
```

**Pattern 2 — Inline attribution in HTML:**
```html
<div class="quote">"<quote>"</div>
<div class="author">— <attribution></div>
```

**Pattern 3 — Markdown blockquote with attribution:**
```
> <quote>
> — <attribution>
```

**Pattern 4 — JSON/structured testimonial fields:**
```json
{ "quote": "...", "author": "...", "title": "..." }
```

**Pattern 5 — Inline CSS class hints:**
Any element with class containing `quote|testimonial|review|press|citation` followed by an `attribution|author|source|cite` sibling.

**Lorem ipsum exemption:** quotes whose body matches lorem ipsum patterns are exempted from fabrication checks IF the attribution is also lorem-shaped or absent.

**Evidence cross-check:** before flagging, the runner checks for matching attribution strings in:
- `**/intake.json` `TESTIMONIALS_REFERENCES`, `CERTIFICATIONS_CREDENTIALS`, `BUSINESS_HISTORY` fields
- `**/testimonials.{md,json,yaml}` files in the same project tree
- `**/credits.{md,json,yaml}`
- `**/press.{md,json,yaml}`

If the attribution string substring-matches any of those sources, classify as `evidence-backed` not `fabricated`.
</detection_patterns>

<output_format>
Per-file finding block:
```
FABRICATED: clients/{CLIENT_CODE}/.../mockup.html:142
  Quote:       "She turns a stage into a place where the audience leans forward..."
  Attribution: "— Halifax Theatre Notes, 2023"
  Evidence:    none found in intake/testimonials/credits/press
  Fix:         replace attribution with "— [pending — client to provide]" or use lorem ipsum body
```

Summary block:
```
Scanned: 12 files
Findings: 4 fabricated · 1 placeholder-acceptable · 7 evidence-backed
Action required: 4 fabricated attributions need replacement before delivery
```
</output_format>

<integration>
- **Manual invocation:** `/lint-attributions <path>` (slash command in `.claude/commands/lint-attributions.md`)
- **Framework hook:** add to `wordpress/design-research` prompt 03 closeout — run after mockup/brief authoring before commit
- **Pre-commit hook (optional):** add to `.claude/settings.json` PostToolUse hook for files matching `**/*.html`, `**/*.md` in `clients/*/projects/*/outputs/`
- **Codex bridge guard:** when dispatching review of authored content, include the lint output in context so Codex can verify fabrications were addressed
</integration>

<provenance>
Created from debrief I-2 of the {CLIENT_CODE}-site-launch-palette-faithful-variation-regen workstream. Both Claude (initial brief drafts) and Gemini-authored HTML mockups inserted fabricated testimonials — "Halifax Theatre Notes, 2023", "Atlantic Festival Producer", "Studio Owner, Halifax", "Theatre Director" — caught only on operator audit. The standing `feedback_enforce_clarity_in_attribution` memory rule fired in chat (Claude self-audited when asked) but did NOT prevent the fabrication at authoring time.

This skill closes that gap by providing a runnable detection pass that fires after authoring, not just on operator audit.
</provenance>

<success_criteria>
- Skill detects all 4 fabricated attributions from the original {CLIENT_CODE} v1 mockups when scanning the historical artifacts
- Skill correctly classifies the v2 mockups as `placeholder-acceptable` (lorem ipsum) or `evidence-backed`
- Operator can run `/lint-attributions <path>` and get actionable findings in under 5 seconds for typical project trees
- Skill integrates cleanly with framework closeout hooks
</success_criteria>
</skill>
