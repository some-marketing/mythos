# tools/fleet — a generic compute-fleet orchestrator

A small orchestrator/worker system for dispatching bounded LLM/tool-call
tasks across a fleet of hosts you control (your own GPU workstations, cloud
instances, etc.), plus a health-check ticker and a homeostasis supervisor
that keeps the fleet's registered state honest.

This is the **engine**, ported close to as-is (the source's orchestrator/,
worker/, and lib/ directories were already fully generic — no private hosts,
no client data, only env-var-driven config with localhost defaults). What's
excluded is the personal host-provisioning/kerneling machinery the source
repo used to bring a *specific* physical machine online — that's inherently
one operator's own hardware setup, not a reusable pattern; see "What isn't
here" below.

## Layout

- `orchestrator/` — the coordinator: task dispatch, worker registry, workflow
  planning, cloud-node handling, response synthesis. Entry point: `main.py`.
- `worker/` — the per-host daemon that registers with the orchestrator,
  reports hardware, and executes tasks against a local Ollama and/or ComfyUI
  instance. Entry point: `__main__.py` / `daemon.py`.
- `lib/` — shared config (env-var driven, `WorkerConfig`/`OrchestratorConfig`
  dataclasses with `localhost` defaults), data models, and a CLI helper.
- `homeostasis.py` — a supervisor that checks fleet reachability, branch/version
  consistency, and load balance across registered nodes, with one safe
  self-healing repair class (stale `.lock` file removal) gated behind
  `--apply` and a kill-switch file. Everything else it finds is print-only
  suggestions (e.g. `git switch <branch>` commands), never auto-executed.
- `tick.js` — a lighter-weight ticker: SSHes to each host in your hosts
  config, runs a remote probe script, and writes a fleet index JSON. Expects
  each host to already have its own probe script installed (host-provisioning
  specific — write your own to match your fleet; see the comment at the top
  of `tick.js`).
- `broadcast-mirror.js` — pushes a URI to a small `display` tool-call task on
  each named node's worker daemon (useful for pushing an image/URL to every
  screen in your fleet at once).
- `print-node-update-command.js` — prints the shell commands to run on each
  Windows fleet node to pull the latest code and restart its worker service;
  every path/branch/service-name default is env-overridable.
- `hosts.example.json` — the shape `tick.js` expects for its hosts config.
  Copy to `_dev/config/remote-hosts.json` (gitignored) and fill in your own
  hosts.
- `test_homeostasis.py` — unit tests for `homeostasis.py`.

## Running it

```bash
# Orchestrator
python3 -m tools.fleet.orchestrator

# Worker (on each fleet host)
python3 -m tools.fleet.worker

# Health ticker (reads _dev/config/remote-hosts.json)
node tools/fleet/tick.js

# Homeostasis check (dry-run by default)
python3 tools/fleet/homeostasis.py
python3 tools/fleet/homeostasis.py --apply   # executes only stale-lock cleanup
```

Install `lib/requirements-fleet.txt` for the minimal orchestrator/worker
round-trip; `lib/requirements-full.txt` if you also want local inference
dependencies on a worker host.

## What isn't here

The source repo also had a `bootstrap-kit/` (one-shot provisioning scripts
for a specific physical Windows machine — install a kernel doctrine document,
join a private mesh VPN, enable SSH for a specific setup) and several
kerneling/idle-check scripts named after that one real host. None of that
generalizes — it's inherently "how one person brought their own GPU box
online," not a pattern another guild can reuse verbatim. If you want the
equivalent for your own hosts, the pattern is: a one-shot PowerShell
provisioning script per host class, a doctrine document describing what
"kerneled" means for your setup, and a README with the exact one-shot
command — write your own rather than adapting a stripped copy of someone
else's.
