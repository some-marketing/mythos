# docs/REPO_CONVENTIONS.md
Repo conventions for scaling runs, reports, and LLM retrieval.

## 1) Raw vs Derived
- Raw artifacts live under `runs/**` (or `runsets/**/runs/**`) in folders:
  - `cookies/`, `evidence/`, `exports/`, `network/`
- Derived artifacts live under:
  - per-run: `derived/`
  - global: `reports/`
  - handoffs: `dev_handoff/` (this repo's current convention)

## 2) Required files per run
- `run.meta.json` (structured metadata)
- `notes.md` (human narrative + deviations)
- `cookies/P1..P5.cookies.json` for phased testcases
- for submit testcases: `evidence/P5.submit.page.png` + `evidence/P5.console.log.txt`
- for tracking claims: `evidence/P5.datalayer.proof.png`

## 3) Naming rules
- Never overwrite raw artifacts; use `.retry01`, `.retry02`, etc.
- Use stable, short names; avoid spaces.
- Use phase prefix `P#.` for anything tied to a phase.

## 4) Era control
When schema/config changes, start a new era:
- new runset id (or record in `CONFIG_ERAS.md`)
- update `runset.meta.json` describing what changed

## 5) LLM retrieval
Every derived report should include:
- run_id, environment, era
- a `sources_used` list (paths)
- stable JSON output for indexing
