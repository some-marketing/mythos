---
name: mythos-operating-mechanics
description: Runbook for Mythos pipeline machinery — regenerating harness instructions from canonical source, validating manifests, running frameworks, driving the plan/signal lifecycle, and resolving credentials. Use in newcomer sessions, before editing anything under instructions/, when a validate/verify script fails, when running or modifying a framework, or when executing a registered plan.
---

# Mythos Operating Mechanics

Exact commands in dependency order. All paths are repo-relative to `{MYTHOS_ROOT}`.

## Rule zero: never hand-edit generated files

`CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/guardrails.md`, `AGENTS.md`, `OPENCODE.md`, `INSTRUCTIONS.md`, and `.cursorrules` at repo root are generator output (each carries an "AUTO-GENERATED" header). Claude files are live targets because `instructions/canonical/system.yaml` sets `rollout: claude_cutover` with `default_write_claude: true` (lines 263-264). Direct edits get flagged as drift by `tools/instructions/validate.js` and overwritten on the next regen. Edit `instructions/canonical/*` instead.

## Instructions pipeline (canonical → adapters → generated)

Source of truth: `instructions/canonical/` (`system.yaml`, `guardrails.md`, `routing.md`, `command-aliases.yaml`, per-command specs in `commands/`). Per-harness rendering rules: `instructions/adapters/*.yaml` (claude, codex, cursor, gemini, opencode, pi, generic). Architecture doc: `instructions/README.md`.

Canonical change workflow — one command does regen + validate:

```bash
npm run instructions:check
```

Individual steps when you need them (`package.json` scripts, generator `tools/instructions/generate.js`):

```bash
npm run instructions:generate          # write ALL live harness targets + instructions/generated/manifest.json
npm run instructions:generate:preview  # --preview-claude: render Claude files to instructions/generated/claude/ only, live files untouched
npm run instructions:regen             # generate, then preview (both of the above in sequence)
npm run instructions:validate          # tools/instructions/validate.js: schema + framework manifests + adapter capabilities + command-spec coverage + alias registry + byte-level drift
```

Gotchas:
- `instructions:regen` runs preview second, so `instructions/generated/manifest.json` ends up reflecting the preview invocation (`write_claude: false`). The manifest records the last run, not the union.
- `validate.js` accepts `--skip-claude` or `--compare-claude`, never both (it errors, `tools/instructions/validate.js` lines 8-12). Drift failures tell you the fix: run `npm run instructions:generate`.
- Machine-local path overrides go in `instructions/adapters/targets.local.yaml` (copy `targets.example.yaml`; the generator loads it via `tools/instructions/lib/engine.js` line 129). Never encode local paths in canonical source.

Continuous sync layer (normally runs via launchd, labels `ca.somemarketing.smos.harness-sync-crawler` and `ca.somemarketing.smos.harness-capability-crawler`, installed with `tools/launchd/install.sh <label>`):

```bash
npm run harness:sync:crawl                 # detect drift, read-only
npm run harness:sync:apply                 # --apply --include-claude: rewrite drifted files
npm run harness:capability:crawl           # capability parity report per harness
npm run harness:protocol:validate          # tools/instructions/validate-harness-protocol-parity.cjs
```

## System-wide verification

```bash
npm run verify:all
```

That chains `tools/verify/verify-system.cjs`, `validate.js --skip-claude`, `tools/verify/sync-manifest.cjs --check`, `verify-all-frameworks.cjs`, `tools/maintenance/declared-trigger-lint.cjs --enforce`, and `process-tier-rule-lint.cjs`. Gotcha: because it passes `--skip-claude`, it will NOT catch Claude-file drift — run `npm run instructions:check` for that. Single-artifact checks: `npm run verify:framework`, `verify:skill`, `verify:agent`, `verify:command`, `verify:guardrails` (all in `package.json`).

## Frameworks

Layout: `frameworks/<service-category>/<framework>/` (e.g. `frameworks/paid-media/campaign-management/`) with `manifest.json` (`input_contract`, `prompt_chain`, `prompt_count`, `output_contract` naming exact artifact paths, `execution_modes`) and `guardrails.md`. Every framework must be registered under `frameworks:` in `instructions/canonical/system.yaml`; a missing manifest fails `instructions:validate` (`tools/instructions/validate.js` line 152).

Execution path: `.claude/commands/fw-<category>-<name>.md` are thin COORDINATOR entries that route into `/run-framework <service/framework> <project-path>` (`.claude/commands/run-framework.md`); the engine is the **execute-framework** skill (`.claude/skills/execute-framework/SKILL.md`, workflows `intake.md` → `execute.md` → `review.md`) — read that skill for the execution rules rather than improvising. Non-negotiables it encodes: read `guardrails.md` before executing, enforce each prompt's declared execution mode (no writes in FINDINGS_ONLY), STOP if `manifest.json` or `guardrails.md` is missing, validate outputs against `output_contract`. Then close with `/debrief-run` (`.claude/commands/debrief-run.md`) — mandated by the canonical run-framework spec (`instructions/canonical/commands/run-framework.yaml`), not by the skill itself. Creating or auditing frameworks is the **manage-frameworks** skill's job.

## Plans, signals, sessions

Plan surfaces (note: `_dev/plans/` holds only a draft `inbox/` — it is not the registry):
- Registry: `_dev/prompts/prompt-plan-registry.json`; contract: `_dev/policies/plan-contract.md`; run order: `_dev/prompts/claude-master-run-order.md`.
- `/plan-task` (**plan-task** skill) writes `_dev/reports/analysis/task-plans/{task-id}__plan.json` + `.md`, conforming to `tools/planning/task-intake.schema.json`; client plans go to `clients/{CODE}/plans/`.

`/execute-plan` (`.claude/commands/execute-plan.md`) drives execution: resolve the plan id in the registry, verify the plan contract, then run ONE incomplete stage at a time through the seven-step pattern (Plan, Build, Verify, Fix, Lessons Capture, Codex Review, Gate). Hard requirements from that command:
- Verification is independent — the validator is never the implementer.
- After EVERY executed stage, publish a live Codex-targeted HandoffSignal/1.0 and generate the bridge prompt; this is mandatory, not conditional:

```bash
npm run signals:codex-bridge          # build the Codex bridge prompt
npm run signals:watch:codex:start     # start managed Codex listener (manage-codex-listener.js, 300s interval)
npm run signals:watch:codex:status    # check it; :stop to tear down
```

- Handoff claims are evidence-based: report only "handoff prepared", "auto-run active", or "feedback received", each backed by the artifacts named in `execute-plan.md` line 38. Never claim Codex reviewed something without a codex-authored follow-up signal.

## Credentials

Never put credential bytes in tool-call arguments or conversation text. Route through the existing skills instead of reimplementing: **github-auth** (resolves a GitHub PAT from env → `.env.local` → macOS Keychain → 1Password; NOTE: the resolver it cites, `tools/auth/github-token.js`, is missing from this checkout — `tools/auth/` does not exist), **store-credential** (fresh secrets into Keychain via `tools/boot/keychain-store.sh`), **migrate-credential-to-1password** (Keychain → 1Password without LLM exposure). The multi-source resolver pattern they mirror lives in `tools/dart-integration/lib/dart-api.js`.
