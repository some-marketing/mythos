# Tool Broker

A three-layer architecture for letting a brokered model propose actions
without ever handing it real write authority directly. This is the pattern
behind running an untrusted or lower-tier model as a worker: it can only ever
*propose*; a fixed enforcement layer decides what a proposal is allowed to
become.

## The three layers

1. **Provider Adapter** (`lib/provider-adapter.js`) — pure transport, zero
   authority. Wraps a model call (OpenAI-compatible API, via the gateway
   below) and returns the model's raw proposed action. It cannot itself
   decide what's permitted.

2. **Gateway** (`litellm-gateway.sh` + `litellm/config.yaml`) — an
   OpenAI-compatible proxy fronting your model backends. It owns the virtual
   key (`master_key`), budgets, per-request cost logs, and model
   access-control: the committed `model_list` in `config.yaml` **is** the
   allowlist — a client can only reach a `model_name` declared there. No
   secrets live in the committed config; every credential is an
   `os.environ/*` reference resolved at proxy start.

3. **Tool Broker** (`lib/tool-broker.js` + `lib/broker-capabilities.js` +
   `lib/phase3-executor.js`) — **the enforcement boundary.** The broker is
   the only component that maps a model's proposed action to a real
   repo/tool primitive, and only after checking it against the current
   permission phase. It never applies a change directly: earlier phases
   write proposals to a reviewed-application area for out-of-band review;
   the latest phase (phase 3) admits exactly one review-hash-bound
   `fs.write` primitive plus a sandboxed, focused test run — every other
   write or command surface stays denied.

## 4-phase permission staging

`broker-capabilities.js` is the capability registry: every primitive a
brokered model may propose is pinned to a permission layer.

```
read-only (1)  <  proposal (2)  <  bounded-patch (3)  <  autonomous (4)
```

The broker allows a capability only when its layer is at or below the
broker's current phase. Read-only executors read a bounded repo/signal/
artifact surface (secret-denylist enforced) and record analysis only.
Proposal executors write ONLY into the broker's own proposals area, never
the real target. Phase 3 is the only phase that exposes a real `fs.write`,
and only through `lib/phase3-executor.js`'s dedicated reviewed-sandbox path
— a proposal must already carry an exact content hash, path, sandbox cwd,
test invocation, timeout, and a distinct-reviewer sign-off before the
executor will touch disk.

## Running the gateway

```bash
cd tools/broker
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
export OPENROUTER_API_KEY=...   # or whatever backend your model_list declares
./litellm-gateway.sh start [--port N] [--foreground]
./litellm-gateway.sh status
./litellm-gateway.sh health
./litellm-gateway.sh stop
```

If `LITELLM_MASTER_KEY` isn't set, the script generates an ephemeral virtual
key for that run only, written to a gitignored `.runtime/master-key.txt` and
never committed. `.venv/` is never committed either — it's a local Python
environment, install it fresh with the pinned `requirements.txt`.

## Wiring your own model backend

Edit `litellm/config.yaml`'s `model_list`. The committed example wires one
proven-through entry (an OpenRouter-fronted model) and one config-ready but
currently-inert local Ollama entry (activates once `OLLAMA_BASE_URL` points
at a reachable host). Add your own entries the same way — every credential
value must be an `os.environ/*` reference, never a literal key.

## Every action leaves a trace

Every broker action — allowed or denied — is recorded as a span through the
telemetry trace-context layer (`tools/telemetry/`), inheriting the ambient
trace/scope lineage of whatever dispatched it rather than starting a
disconnected trace. This is deliberate: a denied action should be exactly as
visible in your evidence trail as an allowed one.

## What's excluded

- `.venv/` — never ported; install fresh with `requirements.txt`.
- `__tests__/`, `validate-phase3-run.js`, `trusted-reviewers.json`,
  `lib/sandbox-test-runner.cjs` — not part of this wave's port; the
  validation/trusted-reviewer-key machinery depends on `../kernel/` paths
  that haven't shipped yet (kernel is a later architecture-scaffold wave).

## Cross-wave dependency note

`lib/tool-broker.js` and `run-broker.js` both `require()` paths under
`../../kernel/` (`cascade-span.js`) and `../../ai-bridge/` (`provider-contract`,
the `openai-compatible` adapter) that are not part of this wave's port — they
belong to the OS-machinery architecture-scaffold wave. Until those land,
these two files won't resolve their requires standalone. This is expected:
the plan explicitly stages vendor integrations (this wave) ahead of OS
machinery (the next wave), and `tool-broker.js`/`run-broker.js` are two of
the files that bridge the two.
