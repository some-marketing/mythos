# Follow-On Inventory Checklist

**When this fires:** before any `/plan-task` that authors a bounded follow-on slice for a project already running this framework — palette correction, variation re-author, mockup regen, brief rewrites, copy iterations, render reproductions.

**Why:** original framework chain (prompts 01-03) enforces inventory at Stage-0 (`brand photography path resolve and verify existence before lane dispatch`). But follow-on slices launched via `/plan-task` bypass that contract because they look like fresh tasks. Three confirmed misses on the {CLIENT_CODE} run before introducing this checklist:

1. Plan author missed pre-existing `outputs/nano-banana-renders-v2/` populated with stale tracked files (Codex pass 1 MAJOR-2)
2. Plan author missed 5 real client brand photos at `assets/brand-photography/` and used AI-imagined likeness instead (operator correction)
3. Plan author missed implicit "more visually striking" design direction not in the original brief (operator correction)

**Evidence:** `reports/analysis/run-debrief__{CLIENT_CODE}-site-launch-palette-faithful-variation-regen.md` finding F-1.

## Mandatory pre-`plan-task` enumeration

Run all five before drafting the plan JSON. Cite each by relative path in the plan's `similarity_assessment.lived_context` section. If any returns unexpected state, surface it in the plan's `non_goals` or `forbidden_artifacts` rather than silently overwriting.

### 1. Brand photography asset inventory

```bash
find clients/{CODE}/projects/{PROJECT}/assets -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.heic" -o -iname "*.webp" \) 2>/dev/null
ls clients/{CODE}/projects/{PROJECT}/shared/brand/photography/ 2>/dev/null
```

If photos exist, the follow-on slice MUST use them as ref images or `<img>` sources. Generating AI-imagined client likeness when real photos exist is the failure mode this check prevents.

### 2. Prior-iteration output directory inventory

```bash
ls clients/{CODE}/projects/{PROJECT}/outputs/
find clients/{CODE}/projects/{PROJECT}/outputs -type d -name "nano-banana-renders*" -o -name "mockup-renders*" -o -name "variations-v*"
```

Any directory matching the planned execution target's pattern → mark as `forbidden_artifacts` (read-only preserved historical evidence) and reroute fresh outputs to a new versioned directory (e.g., `-v3/`, `-v4/`).

### 3. Existing prompt and brief content

```bash
ls clients/{CODE}/projects/{PROJECT}/outputs/variations-v1/
ls clients/{CODE}/projects/{PROJECT}/outputs/nano-banana-prompts/ 2>/dev/null
```

If briefs or prompts already exist for the slugs in scope, the follow-on must REWRITE rather than CREATE — Edit tool, not Write tool. Check whether content has been operator-overruled (e.g., palette diverged from intake) and which fields are authoritative.

### 4. Brand tokens / palette state

```bash
cat clients/{CODE}/projects/{PROJECT}/intake/intake.json | grep -iE "color|palette|brand"
ls clients/{CODE}/projects/{PROJECT}/outputs/variations-v1/palette-tokens.md 2>/dev/null
```

If `palette-tokens.md` exists, that is the source of truth (not intake prose). If it doesn't exist but intake declares colors, palette-tokens.md authoring is a Stage-0 prerequisite step in the plan.

### 5. Operator intent surface beyond the literal task

```bash
cat clients/{CODE}/next-session-handoff.md 2>/dev/null
ls reports/analysis/run-debrief__*{CODE}*.md 2>/dev/null
```

Recent handoffs and debriefs may name design direction, audience, or constraint that the literal task description omits. Surface any unresolved BLOCKED items as either non-goals or operator-gate triggers in the plan.

## When inventory reveals scope friction

If any of the 5 checks reveals state that the proposed plan would conflict with:

- **Stale outputs at the same path** → reroute to `-v(N+1)/` and add the stale dir to `forbidden_artifacts`
- **Real photography exists** → use as ref images / embeds; do not generate AI likenesses
- **Operator intent in handoff exceeds task description** → expand plan scope OR surface for operator confirmation before drafting JSON
- **Palette already pinned** → cite `palette-tokens.md` as authority; do not re-derive

## Deferral

This checklist is not a blocking gate; it is an authoring discipline. The plan author CAN proceed without it, but the resulting plan will be reviewed against it and any miss will surface as a Codex MAJOR finding. The cost of skipping is amendment cycles; the cost of running is ~2 minutes of bash + read.
