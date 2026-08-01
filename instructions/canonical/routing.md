# Canonical Routing

## Session Boot Sequence (ALL HARNESSES)

On every new session, before any operator work begins:

1. Read `_dev/config/fleet-index.json` for live hardware specs, disk space, installed models, and host status across the Tailscale fleet.
2. If fleet-index is more than 1 hour stale, run `npm run fleet:tick` to refresh it.
3. Read `_dev/reports/analysis/next-session-handoff.md` for the prior session's outcomes, blockers, active plans, and recommended next command.
4. If a boundary marker exists at `_dev/state/session-boundary-pending.json`, consume it as an additional signal that handoff is waiting.

This boot sequence applies to pi, claude, codex, and any future harness. It is the first thing any orchestrator does.

## Fleet Index (MANDATORY)

Before any work touching remote hosts (orwell, rupert, syme, vps-orchestrator) or model dispatch:
- Read `_dev/config/fleet-index.json`
- Never write to rupert's C: drive (3GB free). All rupert storage targets E: (1.3TB) or Z: (919GB).
- Check disk free space on target host before any download or installation.
- Check which models are installed before attempting to pull.

## Framework Routing

For a request scoped to a framework:

1. Resolve `{service}` and `{framework}`.
2. Load `frameworks/{service}/{framework}/manifest.json`.
3. Load `frameworks/{service}/{framework}/guardrails.md`.
4. If project-scoped, load `clients/{client_code}/{project_name}/project.json`.
5. Execute with framework-level instructions and declared execution modes.
