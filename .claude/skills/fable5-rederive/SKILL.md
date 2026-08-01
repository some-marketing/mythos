---
name: fable5-rederive
description: Re-derive or repair the Fable5-Lite conduct spec (Claude-Fable-5-Lite/fable5-lite.md). Use when calibration probes fail repeatedly in the spec condition, when Fable's observed conduct has changed (model or harness update), or when the operator asks to update/re-derive the Fable5-Lite spec.
---

<objective>
Update `Claude-Fable-5-Lite/fable5-lite.md` so it matches Fable 5's current
observed conduct, with cross-verification and probe evidence before the change is
accepted.
</objective>

<constraints>
- The spec must stay under ~250 lines. Sharpen existing sections before adding new
  ones; every added rule dilutes the rest.
- Derivation source ranking: (1) observed behavioral diffs between Fable and Opus
  transcripts on identical tasks, (2) a live Fable session diffing the spec
  against its own operating guidance, (3) reasoning about what should differ.
  Never rely on (3) alone.
- The spec governs conduct and process only. It must not acquire Mythos routing,
  client rules, or anything that belongs in `instructions/canonical/`.
</constraints>

<process>
1. **Collect evidence.** Gather the failing probe transcripts (from
   `Claude-Fable-5-Lite/calibration-runs/`) or the divergent session excerpts
   that triggered this re-derivation. Name the spec sections each piece indicts.
2. **Diff against Fable.** In a Fable-powered session, ask it to compare the
   current spec against its own conduct and process guidance and to propose
   minimal edits — sharpened sentences, not new sections, unless a genuinely
   uncovered behavior surfaced.
3. **Edit the spec.** Apply the minimal diff. Update the derivation date in
   `Claude-Fable-5-Lite/README.md`.
4. **Cross-verify.** Dispatch the edited spec to a distinct intelligence
   (`codex exec -s read-only -`) for the standard review: internal
   contradictions, rules an LLM would over-apply, gaps, probe/section mapping.
   Apply real defects; resist findings that just add bulk.
5. **Calibrate.** Run the fable5-calibrate skill (3–4 probes minimum, including
   every probe that was failing). The edit is accepted only if previously-failing
   probes now pass and no previously-passing probe regressed.
6. **Close.** Note the change and probe evidence in the calibration run report.
   Commit only when the operator asks, scoped to Claude-Fable-5-Lite/ and the
   two skills.
</process>

<success_criteria>
- Every spec edit traces to named evidence (transcript or probe failure)
- Codex review ran and its real findings were applied
- Probe re-run shows the failing behavior fixed without regressions
</success_criteria>
