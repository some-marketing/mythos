# Codex — the harness-launcher pattern (scaffold)

This directory is a **scaffold port**, not a working port. The source
directory implements a managed entrypoint that lets a Claude Code session
drive an external CLI harness (e.g. `codex exec`) as a peer actor with its
own session lifecycle. This export ships a README describing that
architecture plus one small working stub demonstrating the innermost
primitive. Everything else is explicitly out of scope.

## The pattern: a launcher that emulates a harness's own lifecycle

When one agentic harness (Claude Code) wants to dispatch work to a
*different* CLI-based harness (a "codex exec"-style tool, or any other
external agent CLI) as a first-class actor rather than a black-box shell
call, three concerns show up:

1. **Command resolution** — map a typed command (`/review-task-plan
   task-id`) to whatever this codebase's own deterministic command runner
   knows how to do, so the external harness benefits from the same
   command surface the primary harness uses.
2. **Hook-lifecycle emulation** — the primary harness (Claude Code) has its
   own hook points (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse,
   SubagentStop, ...). When a *different* harness is standing in for part of
   a session, something has to emulate the moments those hooks would have
   fired, so downstream automation (state ledgers, custody gates, telemetry)
   still sees a consistent lifecycle regardless of which harness is actually
   running.
3. **Managed dispatch to the external CLI** — actually spawning the external
   binary (`codex exec ...`) with the resolved command/task, capturing its
   output, and threading the result back through the hook-emulation layer so
   the rest of the system reacts the same way it would to native activity.

The private `smos-launcher.js` composes all three: it resolves an action
(`boot`, `plan`, `ground`, `shell`, `command`, `bridge`, `signal`,
`end-session`, `state`), emulates the relevant hook events before and after
dispatch, and — for the `bridge` action — spawns a private dispatch runner
that hands a bounded task off to an external actor (Codex, Gemini,
OpenCode, or another configured target) and threads a distributed-tracing
context through the call.

## What's stripped: private signals/sessions coupling

Everything above the bare "spawn a binary, capture output" primitive in
this codebase is wired to private machinery that is out of scope for this
export target:

- **A private managed-runtime module** tracking session state (boot status,
  plan-mode entry, grounding acknowledgements) to a per-session state file.
- **A private hook-emulation module** that fires the equivalent of Claude
  Code's SessionStart/PreToolUse/PostToolUse/SubagentStop events for a
  session partly driven by an external harness.
- **A private managed-command registry** that decides which slash commands
  are "managed" (have a canonical spec and dedicated deterministic runner)
  versus purely narrative/process commands.
- **A private handoff-signal dispatch runner** (this codebase's own
  coordination-signal machinery) that the `bridge` and `signal` actions
  spawn to route a task to an external actor and track its resolution.
- **A private end-of-session closeout module** and a private telemetry
  trace-context builder, both wired into several of the launcher's actions.
- A private `tools/codex/commands/*.js` directory of command implementations
  (`repair-plan`, `telemetry-status`, `orchestrate`, `orchestrate-loop`,
  `review-task-plan`, `amend-plan`, `evidence-loop`, `plan-task`, `run-plan`,
  `_shared`) — every one of these requires the private planning/telemetry/
  signals modules above, so none of them are ported. This mirrors an
  earlier wave's exclusion of the same private command implementations from
  `tools/commands/mythos-command-runner.cjs` — see
  `tools/commands/README.md` in this export target (read-only reference) for
  how that exclusion was documented there.

## What's shipped: `launcher-stub.js`

The bare launch primitive with nothing built on top of it:

```js
const { launch } = require('./launcher-stub.js');
const result = launch('your-harness-binary', ['exec', '--task', 'do the thing']);
// result: { exitCode, stdout, stderr }
```

or from the CLI:

```
node launcher-stub.js <binary> [args...]
```

`binary` is always caller-supplied — this stub never hardcodes a CLI name,
so it works the same whether the external harness is `codex`, `gemini`,
your own tool, or anything else on `$PATH`.

## Building your own launcher from this stub

Layer the concerns back on in whatever order matches your own harness:
resolve a command to a task string, emit whatever lifecycle event your own
automation needs to observe before dispatch, call `launch(...)`, then emit
the corresponding after-dispatch event with the captured result. Keep each
layer independently testable, the way the private source keeps hook
emulation, command resolution, and the spawn call as separate modules.
