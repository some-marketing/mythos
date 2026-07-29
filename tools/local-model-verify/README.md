# Local-model verification benchmark

Runs a golden set of system-knowledge prompts against a local model and
emits a per-prompt verdict (pass / partial / fail). Use to test whether a
local model has acquired enough Mythos-system context to be a useful
**lower-tier actor** — worth routing bounded, low-stakes work to before
escalating to a frontier model.

## Run

Direct against an Ollama host:

```bash
node tools/local-model-verify/run-benchmark.cjs --model qwen2.5:3b --direct-ollama your-local-model-host:11434
```

Through a generic HTTP backend (default if no `--direct-ollama`):

```bash
node tools/local-model-verify/run-benchmark.cjs --model qwen2.5:3b --http localhost:8000
```

The generic HTTP backend expects any endpoint that accepts `POST /generate`
with `{"model": "...", "prompt": "..."}` and returns `{"response": "..."}`
(falling back to `.output`, `.text`, or the raw body if those fields are
absent). Point it at whatever local-model router or single-model server you
run — there is no dependency on any particular fleet-orchestrator.

Stdlib only — no `npm install` required.

## What it tests

15 prompts covering Mythos's own shipped public doctrine: the familiar
dispatch contract, producers-never-judge-own-trials, role ownership
(Guildmaster / familiar / Adjudicator), the rank ladder and its dual apex,
world-noun vocabulary, the mythic-names-are-aliases design law, execution
modes, observational reporting and forbidden report labels, Homebrew
namespaces, the Mirror's authority limits, and cross-session durable
artifacts.

The set is in `golden-set/prompts.json`, derived entirely from
`docs/GUILD-CHARTER.md`, `docs/LEXICON.md`, and
`instructions/canonical/guardrails.md`. See `golden-set/README.md` for the
prompt schema and verdict logic.

## Output

Reports land at `_dev/reports/analysis/local-model-verify__<model>__<timestamp>.{json,md}`. Exit code is nonzero if any prompt fails.

## Interpreting

- **All pass** — model has enough system-context for lower-tier actor work; route accordingly.
- **Mostly pass with partials** — usable for warn-only reflex lanes, not for anything that needs precise doctrine recall.
- **Any fail** — do not route doctrine-bearing work here; escalate to a frontier model.

## Growing this for your own guild

This golden set only tests knowledge of what's shipped publicly. If your
guild layers private doctrine, house style, or client-specific conventions
on top of Mythos, write a second, private golden set following the same
schema and point a second benchmark run at it — don't fold private content
into this shipped set.
