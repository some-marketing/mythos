# Local setup (Phased runner)

## Prereqs
- Node.js 18+ recommended
- Project contains `<REPO_ROOT>/playwright_phased_runner/testcases/` (runner writes under `<REPO_ROOT>/playwright_phased_runner/testcases/<testcase_id>/runs/...`)

## Install
```bash
cd playwright_phased_runner && npm install && npm run install:browsers
```

**Note:** All CLI commands below are run from the repo root (not from `playwright_phased_runner/`).

### Note (macOS Apple Silicon + sandboxed CPU info)
In some sandboxed environments `os.cpus()` may not report an Apple CPU model, which can make Playwright pick `mac-x64` browser paths on an `arm64` machine.

This pack's `npm` scripts automatically set:
- `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE` (to the correct `macXX-arm64` value) when CPU model detection is missing
- `TMPDIR` (to `./.tmp`) to avoid temp-space issues (override via `PW_TMPDIR=/path`)

## Allocate a runset
Before running A/B/C, allocate a sequential runset folder:
```bash
node framework/runner/cli.js new-runset --testcase attribution_baseline_P1-P5 --tags "smoke"
```
Output (machine-parseable):
```
RUNSET_ID=run_0001
RUNSET_META=<REPO_ROOT>/playwright_phased_runner/testcases/attribution_baseline_P1-P5/runs/run_0001/runset.meta.json
```
Use the returned `RUNSET_ID` in all subsequent `--runset` flags.

## Run (baseline P1–P5)
Show CLI help:
```bash
node framework/runner/cli.js run --help
```

## Run with a testcase (recommended)
For the bundled testcase `attribution_baseline_P1-P5`, you can avoid repeating URLs and asset paths by passing `--testcase`:
```bash
node framework/runner/cli.js run \
  --testcase attribution_baseline_P1-P5 \
  --runset run_0001 \
  --env A-logged_out
```

## Set once: defaults config (recommended)
Edit `framework/runner/config/defaults.json` to set your project's baseline:
- `site`, `era`
- `decorated_url_base`, `direct_url`, `apply_url`
- `locator_map`, `identity`

Then most runs only need `--testcase`, `--runset`, and `--env`.

### URL parameter convention (enforced by default)
For a given run, the runner computes:
- `RUN_ITERATION` from the runset id (e.g. `run_0001` → `1`)
- `TOKEN = TEST_<ENV>_RUN_<RUN_ITERATION>` (e.g. `TEST_A_RUN_1`)

It requires these query params on the decorated landing URL (all values must equal `TOKEN`):
`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `gclid`, `msclkid`, `fbclid`.

To avoid typos, prefer `--decorated_url_base`, which auto-builds the decorated URL.

### Runsets (recommended for A/B/C)
To keep A/B/C grouped under a single run iteration, pass `--runset`:
- Outputs go to `<REPO_ROOT>/playwright_phased_runner/testcases/<testcase_id>/runs/<runset>/<ENV>-<login_state>/...` (e.g. `<REPO_ROOT>/playwright_phased_runner/testcases/attribution_baseline_P1-P5/runs/run_0001/A-logged_out/`)

### Reporting tags (optional)
Attach tags to runs/runsets for cross-test reporting:
- Pass `--tags "smoke,release-2026-01-24"` when allocating the runset.
- The runner writes/merges tags into `<REPO_ROOT>/playwright_phased_runner/testcases/<testcase_id>/runs/<runset>/runset.meta.json`.
- Generate reports:
  ```bash
  node framework/runner/cli.js report --testcase <TESTCASE_ID> --runset run_0001
  ```

### Recommended run naming + identity convention (copy/paste)
For run iteration `N`, use:
- `--runset run_000N` (the group folder)
- URL token is auto-computed as `TEST_<ENV>_RUN_<N>` and enforced on the decorated landing URL
- Default identity templates resolve to:
  - `first_name`: `TEST_<ENV>` (e.g. `TEST_A`)
  - `last_name`: `RUN_<N>` (e.g. `RUN_1`)
  - `email`: `test<ENV>run<N>@test.com` (e.g. `user@example.com`)
  - `job_title`: browser id (e.g. `chromium` / `chromium_chrome`)
  - `employer`: system id (e.g. `darwin-arm64-25`)

Example: A/B/C for run 1:
```bash
# A (logged_out)
node framework/runner/cli.js run \
  --testcase attribution_baseline_P1-P5 \
  --runset run_0001 \
  --env A-logged_out

# B (logged_in)
node framework/runner/cli.js run \
  --testcase attribution_baseline_P1-P5 \
  --runset run_0001 \
  --env B-logged_in

# C (incognito)
node framework/runner/cli.js run \
  --testcase attribution_baseline_P1-P5 \
  --runset run_0001 \
  --env C-incognito
```

## Headed (watch it)
```bash
node framework/runner/cli.js run --testcase <TESTCASE_ID> --runset run_0001 --env A-logged_out --headed
```

## With slowmo for debugging
```bash
node framework/runner/cli.js run --testcase <TESTCASE_ID> --runset run_0001 --env A-logged_out --headed --slowmo 500
```

## Configure selectors + data
Recommended structure:
- Testcases live under `<REPO_ROOT>/playwright_phased_runner/testcases/<testcase_id>/` (config + expected outcomes + assets).
- Runs are written under `<REPO_ROOT>/playwright_phased_runner/testcases/<testcase_id>/runs/<runset>/<ENV>-<login_state>/`.

Default testcase assets:
- Locator map: `<REPO_ROOT>/playwright_phased_runner/testcases/attribution_baseline_P1-P5/locator_map.json`
- Identity: `<REPO_ROOT>/playwright_phased_runner/testcases/attribution_baseline_P1-P5/identity.json`

The default identity file supports simple templates:
- `first_name`: `TEST_{ENV}`
- `last_name`: `RUN_{RUN_ITERATION}` (derived from `--runset`, e.g. `run_0002` → `2`)
- `job_title`: `{BROWSER}` (e.g. `chromium` or `chromium_chrome`)
- `employer`: `{SYSTEM}` (e.g. `darwin-arm64-25`)
- `email`: `test{ENV}run{RUN_ITERATION}@test.com` (e.g. `user@example.com`)

If your form has more required fields, regenerate the locator map so it includes all inputs, then extend the identity file with values for every `required: true` field (or run with `--strict_identity` to fail fast).

## Environment behavior (A/B/C)
- **A (logged_out)**: default (no storage state).
- **B (logged_in)**: requires a Playwright `storageState` JSON. If `--storage_state_in` is omitted, the runner uses (in order):
  - the testcase-configured shared auth state path (see `<REPO_ROOT>/playwright_phased_runner/testcases/<testcase_id>/testcase.json`), else
  - `auth_states/<site>/B-logged_in.storage.json`
  The runner also captures a `cookies/P0.cookies.json` snapshot before P1 to record logged-in baseline noise.
- **C (incognito)**: disallows storage state flags.
- **CT (config_test)**: forces headed mode (for monitoring selector/flow setup). Use this for setup/debugging, not for final comparable A/B/C evidence runs.

### Record a logged-in storage state (env B)

> **Note:** Auth state recording is not yet implemented in the framework CLI. Currently, you need to manually:
> 1. Use Playwright's codegen to record a login session
> 2. Save the storage state JSON to `auth_states/<site>/B-logged_in.storage.json`

If selectors drift, generate a new locator map via the scaffolding prompt.

## Outputs
Under `<REPO_ROOT>/playwright_phased_runner/testcases/<testcase_id>/runs/<runset>/<ENV>-<login_state>/`:
- `cookies/P1..P5.cookies.json`
- `evidence/P1.page.png`, `P3.page.png`, `P4.page.png`, `P5.submit.page.png`
- `evidence/console.events.jsonl` + `console.errors.summary.md`
- `evidence/datalayer.events.jsonl` + `datalayer.summary.json`
- `evidence/navigation.timeline.jsonl`
- `evidence/submit.result.json`
- `derived/run.summary.md` + `derived/run.summary.json`
- optional: `network/network.summary.jsonl`

If you omit `--runset`, the runner still writes a run folder, but per-env grouping is strongly recommended for A/B/C comparability.

## Compile a runset summary (optional)
After running A/B/C under the same `--runset`:
```bash
node framework/runner/cli.js report --testcase attribution_baseline_P1-P5 --runset run_0001
```

## Post-run (optional)
If you also added the earlier framework tooling:
```bash
python tools/extract_signals.py --root . --runs_dir runs
python tools/generate_llm_jobs.py --root . --runs_dir runs
```
