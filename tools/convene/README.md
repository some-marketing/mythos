# convene

Convene a triadic (or larger) deliberation on a single task: fan a prompt out to
several models/harnesses in parallel, capture each one's response as a durable
artifact, and leave a synthesis skeleton for the origin actor to fill in.

## Quick start

```
node tools/convene/convene.js --task "review this plan" --scope plan-review
```

Defaults to the `local-council` profile (zero-cloud, Ollama-only). Pass
`--allow-frontier --profile kernel` to use the cloud Claude/Codex/Gemini triad, or
`--list-profiles` to see every built-in profile.

## Dispatch backends

Every participant slot resolves to one of three dispatch modes:

1. **Built-in CLI adapters** — `claude`, `codex`, `gemini`, the `local-*` Ollama
   actors, and `openrouter-<model-slug>`. These shell out to an installed CLI and
   pipe the prompt to its stdin.
2. **Custom adapters** — copy `convene-adapters.example.json` to
   `convene-adapters.json` (gitignored by default) and add an entry for any other
   CLI-driven model or harness you want to convene with. Each entry is
   `{ "command": "...", "argv": [...] }`; convene shells out to it exactly like a
   built-in.
3. **Manual mode** — the universal fallback. Any actor name with no built-in and
   no custom-adapter entry resolves to manual mode automatically: no subprocess
   is spawned. The prompt lands in `prompts/<slot>__<actor>.md` in the run's
   artifact directory (written regardless of dispatch mode); paste that into
   your model of choice by hand, save the reply over `<slot>__<actor>.md` in the
   same directory, and continue the synthesis from there.

This is an adaptation: the original had two additional built-in adapters
(`opencode`, `opencode-local`) that shelled out to a private bridge runner not
included in this port. Route those through a custom adapter entry instead, or
use manual mode.

## Model pinning (optional)

`lib/model-tiering.js` can pin a specific model version per actor and risk tier.
Absent any config, no pin is applied and each adapter's own CLI default is used.
To opt in, create `convene-model-pins.json` next to this README:

```json
{
  "gemini": { "high": "your-pro-tier-model-id", "low": "your-fast-tier-model-id" }
}
```

This is also an adaptation: the original resolved pins through a private,
target-specific routing policy module. This port replaces that with a plain,
user-populated config file with the same call signature, so `lib/adapters.js`
did not need to change.

## What changed from the private source

- `lib/adapters.js` — replaced the two private-bridge-backed actors with the
  custom-adapter-config + manual-mode fallback described above.
- `lib/run.js` — dropped a telemetry-lineage seeding step that required two
  private telemetry modules; slot spawning is otherwise unchanged. Added
  handling for the new manual dispatch mode.
- `lib/model-tiering.js` — replaced a private target-routing-policy dependency
  with the optional `convene-model-pins.json` file described above.
- Everything else (`convene.js`, `lib/profiles.js`, `lib/prompt.js`,
  `lib/artifacts.js`, `lib/openrouter-bridge.js`, `local-convene.js`) is
  unchanged in logic; a few string literals were genericized (env var prefix,
  a couple of brand mentions in comments/prompts).

## Files

- `convene.js` — CLI entry point.
- `local-convene.js` — a simpler, fully-local (Ollama-only) convene runner for
  when the orchestrating session is not itself a triad slot.
- `lib/adapters.js` — dispatch-backend resolution (built-in, custom, manual).
- `lib/profiles.js` — the built-in triad profiles (kernel, code-review,
  local-leaf, local-council, openrouter-triad).
- `lib/prompt.js` — builds the per-slot prompt text.
- `lib/run.js` — spawns (or manual-dispatches) one slot.
- `lib/artifacts.js` — writes the run's durable artifact set.
- `lib/model-tiering.js` — optional per-actor model pinning.
- `lib/openrouter-bridge.js` — stdin/stdout bridge to the OpenRouter API.
- `convene-adapters.example.json` — copy to `convene-adapters.json` and edit.
- `__tests__/` — `profiles.test.js` and `artifacts.test.js` ported unchanged;
  `adapters.test.js` and `model-tiering.test.js` are new, covering the adapted
  dispatch-backend and model-pinning logic. The original `run-telemetry.test.js`
  and `convene-model-tiering.test.js` were dropped — they asserted against the
  removed private telemetry seeding and the removed private routing-policy
  values respectively, and no longer describe this port's behavior.

## Artifacts

Every run writes to `_dev/reports/analysis/convene-runs/<timestamp>-<scope>/`:
`prompt.md`, `prompts/`, one file per participant slot, `synthesis-skeleton.md`,
and `manifest.json` (schema `ConveneRun/3.0`).
