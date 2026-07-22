# iron-rank-worked-example (formerly meta__staged-remediation)

Dev-only framework candidate for extracting the current `_dev/prompts` remediation orchestration into a deterministic `meta` execution model. Kept here as the canonical worked example of what an Iron-rank framework candidate looks like — see `../README.md` for how this exemplar is meant to be used.

Current status:
- restricted to `_dev/`
- not registered in canonical system inventory
- not promoted into `frameworks/`
- Stage 1 only is modeled as executable in this first pass

Candidate contents:
- `candidate.json` — candidate metadata
- `evidence/` — source material inventory for the extraction
- `proposed_framework/` — draft framework assets
- `replay_cases/` — example Stage 1 replay-oriented inputs

Important constraint:
- this candidate does not live under `<project>/framework_candidates/`
- existing workspace candidate tooling should not be treated as authoritative for this dev-only path yet

