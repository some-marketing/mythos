---
name: fable5-calibrate
description: Run the Fable5-Lite calibration probe battery — headless A/B runs of stock vs spec-loaded Opus 4.8, judged against Claude-Fable-5-Lite/calibration-probes.md. Use after editing fable5-lite.md, when an Opus session drifts from expected conduct, or when the operator asks to calibrate/test the Fable5-Lite spec.
---

<objective>
Measure whether the Fable5-Lite conduct spec actually changes Opus 4.8 behavior, by
running calibration probes in three conditions and scoring them against the pass
criteria in `Claude-Fable-5-Lite/calibration-probes.md`.
</objective>

<conditions>
- **stock** — Opus 4.8 with no spec. MUST disable hooks, or the installed
  SessionStart hook injects the spec and contaminates the control:
  `claude --model claude-opus-4-8 -p "<probe>" --settings '{"disableAllHooks":true}' --max-turns 8`
- **spec** — Opus 4.8 with the spec at system-prompt level:
  `claude --model claude-opus-4-8 -p "<probe>" --settings '{"disableAllHooks":true}' --append-system-prompt "$(cat <repo>/Claude-Fable-5-Lite/fable5-lite.md)" --max-turns 8`
- **reference** (optional) — the same probe answered by a Fable session, as the
  gold standard for judging tone-level probes.
</conditions>

<process>
1. Pick probes from `calibration-probes.md` (default: P1, P2, P3, P6 — the ones
   that run against a small synthetic fixture; P7 needs care, it deletes things).
2. For each probe, create an isolated fixture directory per condition (identical
   contents, `shasum > baseline.sha` for mechanical file-change detection). Never
   run probes inside the real repo.
3. Run both conditions headlessly with `--permission-mode acceptEdits` so drift
   (unrequested edits) is observable rather than blocked. Capture transcripts.
4. Score each transcript against the probe's Pass/Drift criteria. Mechanical
   checks first (`shasum -c baseline.sha` — did it edit when it shouldn't?), then
   judge the prose qualities. For judging, prefer a distinct intelligence
   (codex exec -s read-only -) over self-scoring when results will be
   presented as acceptance-grade.
5. Write the run report to `Claude-Fable-5-Lite/calibration-runs/<UTC date>__run.md`:
   per-probe verdict matrix (stock vs spec), transcript excerpts as evidence, and
   which spec sections the failures indict.
6. If a probe fails in the spec condition twice across runs, the fix is the spec
   section, not the probe — route to the fable5-rederive skill.
</process>

<full_battery>
For the complete battery across all probes with parallel runners and judges, use
the workflow instead: `Workflow({name: "fable5-calibration"})`. It fans out one
runner and one judge per probe. Only invoke when the operator has opted into
multi-agent orchestration.
</full_battery>

<success_criteria>
- Every scored probe has mechanical evidence (checksums) plus transcript excerpts
- The report states pass rates per condition and names indicated spec sections
- No probe ran inside the real repository
</success_criteria>
