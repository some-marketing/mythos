# Seeded-flaw calibration probes (OUT-OF-BAND library) — STUB

v3 law condition (4): the apex must pass a seeded-flaw calibration probe whose
**authorship, selection, insertion, AND grading** are ALL under non-defendant
custody (out-of-band or operator, NEVER the coordinator / defending family). A
probe drawn from THIS directory is "out-of-band" for a loop instance only if the
loop-instance did not author it.

> STATUS: STUB. This directory establishes the custody surface and the probe
> record shape. It is NOT yet populated with a vetted probe corpus, and nothing
> mechanically enforces that a probe referenced by `seeded_probe.probe_ref` was
> actually drawn from here rather than coordinator-authored — that binding is
> Layer-2 arming work. Until then, `seeded_probe.custody.*` presence is a
> declaration checked for the non-defendant VALUE ('operator' | 'out-of-band'),
> not a proof of provenance.

## Probe record shape (see `sample-probe.json`)

    {
      "probe_id": "<stable id>",
      "domain": "<domain the probe calibrates>",
      "flaw": "<the seeded flaw the apex must catch>",
      "custody": {
        "authorship": "out-of-band",
        "selection":  "operator",
        "insertion":  "operator",
        "grading":    "out-of-band"
      },
      "expected_catch": "<what a competent apex must report>"
    }

A grade record's `seeded_probe` block references a probe here by `probe_ref` and
records whether the apex `caught` the flaw. `assessProbe()` in
`tools/planning/lib/loop-grade-record.js` rejects the cycle unless every custody
stage is a non-defendant value and `caught === true && passed === true`.
