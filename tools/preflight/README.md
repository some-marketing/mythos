# preflight — generic host and GPU readiness checks

Small, dependency-free checks that answer "is this host in a good state to
start/continue work" before a bounded operation runs.

## `host-state.cjs`

Local host snapshot (CPU count, memory, load average, swap usage, uptime) via
Node's `os` module plus a couple of local shell commands. No network calls,
no remote hosts, no configuration required.

```
node tools/preflight/host-state.cjs [--json] [--strict]
```

## `spawn-verify.cjs` / `envelope-verify.cjs`

Bounded verification helpers for a spawn/dispatch envelope — confirm the
declared shape of a dispatch request matches what actually landed before
trusting it. See each file's header comment and `lib/envelope-match.cjs` /
`lib/safe-persistence.cjs` for the matching/persistence primitives they share.

## `gpu-preflight.ps1`

Windows GPU/disk/BIOS/OS snapshot for a host about to have hardware swapped
or reconfigured — captures GPU driver info, disk inventory, BitLocker status,
and `nvidia-smi` output into a JSON report plus a human-readable
`READY_FOR_SWAP.md` marker. Run from an elevated PowerShell prompt:

```powershell
gpu-preflight.ps1
```

Output defaults to `_dev/outputs/gpu-preflight/` relative to the repo root;
override with the `PREFLIGHT_OUTPUT_DIR` environment variable.

## Tests

`__tests__/` covers `host-state.cjs` and `spawn-verify.cjs`. Run with your
project's usual test runner (these use Node's built-in `node:test`/`assert`
if that's what the source files import — check each test file's header).
