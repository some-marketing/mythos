# Runner spec (contract)

## What it captures
1) Cookie behavior at P1–P5 (structured cookies with domain/path/httpOnly/etc.)
2) Console events across the full run (jsonl) + a human error summary
3) All dataLayer.push payloads (jsonl ledger) + summary counts
4) Navigation timeline (jsonl)
5) Screenshots at P1/P3/P4/P5
6) Submit outcome (structured)

## Failure behavior
If the runner fails mid-run (timeouts, selector drift, missing storage state, etc.), it still writes:
- `derived/run.summary.json` + `derived/run.summary.md` with `status: "failed"`
- `evidence/run.error.json` with error details (phase/message/stack) and best-effort URL + failure screenshot pointer

## Testcases + runs layout (recommended)
- Test definitions live under `<REPO_ROOT>/playwright_phased_runner/testcases/<testcase_id>/`:
  - `testcase.json` (URLs, asset paths, shared auth state pointers)
  - `locator_map.json`, `identity.json`
  - `EXPECTED_OUTCOMES.md`
- Runner outputs live under `<REPO_ROOT>/playwright_phased_runner/testcases/<testcase_id>/runs/<runset>/<ENV>-<login_state>/...`

To use a testcase, pass `--testcase <testcase_id>`.

## Reporting tags (optional)
- Pass `--tags "smoke,release-2026-01-24"` when allocating the runset.
- Tags are stored in:
  - `run.meta.json` (per env run)
  - `derived/run.summary.json` / `derived/run.summary.md`
  - `<REPO_ROOT>/playwright_phased_runner/testcases/<testcase_id>/runs/<runset>/runset.meta.json` (runset-level metadata)
- The runner merges tags from an existing `runset.meta.json`, so you can set tags once and reuse across A/B/C runs.
- Generate reports:
  ```bash
  node framework/runner/cli.js report --testcase <TESTCASE_ID> --runset run_0001
  ```

## What it does not do
- CRM exports or WPForms PDF export (human post-step)
- Full HAR by default (only HAR-lite request/status ledger)

## Proof model for tracking
`dataLayer.push` interception is treated as canonical proof of event pushes.

## Locator map field types (supported)
Runner can fill these field `type` values:
- `text`, `email`, `tel`, `textarea`, `number`, `date`, `url` (filled via `page.fill`)
- `select` (via `page.selectOption`)
- `checkbox` (via `page.check` / `page.uncheck`)
- `radio` (expects selector targets the chosen option; uses `page.check`)
- `file` (via `page.setInputFiles`)
- `choices_js` (Choices.js custom selects; click container then click option by `data-value`)

Fields may use either:
- `css` (single selector), or
- `css_candidates` (array of selectors; runner uses the first that exists)

## Multipage + step hooks
- `visible_when_css` should match the page container for that step (e.g. `.wpforms-page-12`) and rely on Playwright `{state:"visible"}` to gate `display:block`.
- Avoid relying on `.wpforms-page-active` for WPForms, since it may not update across transitions.
- Optional `popup_after_next` per step supports an interstitial after clicking Next:
  - `container_css`: popup root selector
  - `continue_button_css`: selector to dismiss/continue
  - `timeout_ms` (optional, default 5000)
  - `active_when.z_index_gt` (optional): treat popup as active only when computed `z-index` is greater than this value

## Strict mode (optional)
Pass `--strict_identity` to fail fast when a required identity value is missing or a required field cannot be filled.

## Logged-in environment guardrails (env B)
- Use `--storage_state_in <path>` (Playwright `storageState` JSON) to ensure the run is authenticated.
- If `--storage_state_in` is omitted, the runner uses (in order):
  - `<REPO_ROOT>/playwright_phased_runner/testcases/<testcase_id>/testcase.json` → `auth_states.B.storage_state_in` (if provided), else
  - `playwright_phased_runner/auth_states/<site>/B-logged_in.storage.json`
- The runner captures `cookies/P0.cookies.json` for env B before the decorated click (P1).

## Runset allocator
A **runset** is a group of per-environment runs (A/B/C) executed together under a single sequential ID (e.g. `run_0001`). The allocator tool creates the next sequential runset folder and writes initial metadata:

```bash
node framework/runner/cli.js new-runset --testcase <TESTCASE_ID> --tags "smoke,v1"
```

Behavior:
- Scans `<REPO_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/` for existing `run_NNNN` folders
- Allocates the next sequential ID with zero-padded 4-digit suffix
- Concurrency-safe: retries on EEXIST (up to 10 attempts)
- Writes `runset.meta.json` with: version, runset_id, runset_uid (UUID), testcase_id, site, era, reporting tags, timestamps, env_runs_seen
- Outputs machine-parseable `RUNSET_ID=...` and `RUNSET_META=...` to stdout

## Defaults config (optional)
The runner can load shared defaults (site/URLs/locator map/identity) from `framework/runner/config/defaults.json` (or `--config <path>`). CLI flags always override config.
