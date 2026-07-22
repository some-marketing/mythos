# TEMPLATE_REPO_SPEC — Modular "Journey + Evidence" Web Testing Framework

## Goal
A drop-in testing framework for **any web project** that:
- Runs repeatable "user journeys" (login, signup, checkout, lead form, settings, etc.)
- Captures high-signal **evidence artifacts** (screenshots, console, cookies, navigation, network summary, optional dataLayer)
- Is **LLM-assisted** for setup and correction (copy/paste prompts), with optional Claude MCP walkthroughs

## Key Design Principles
- **90% declarative** journeys (JSON/YAML): LLM-friendly, diffable, validateable
- **10% escape hatch** journeys (TS/JS) via named hooks: flexibility without losing structure
- One unified engine: JSON/YAML/TS all compile into the **same normalized step model**
- Evidence is first-class: every run produces consistent artifacts and a structured step log

---

> **Note**: This document describes a **roadmap vision** for a future journey-based runner. The current framework CLI is testcase-based. For current usage and CLI commands, see [LOCAL_SETUP.md](./LOCAL_SETUP.md).

---

## Repo Concept (future)
**Template repo** (download/copy into projects), later optionally extract runner into an npm package.

Top-level folders (future state):
- `docs/` (workflow + spec + adapters)
- `prompts/` (copy/paste into ChatGPT/Claude)
- `project/` (user-owned: config, personas, hooks, journeys)
- `runner/` (engine, collectors, adapters, schemas)
- `runs/` (output artifacts)

---

## Workflow Loop (LLM-assisted)
1) **Intake**
- Define what matters to test (top 3–10 journeys) + environments (A/B/C, staging/prod) + auth strategy.

2) **Scaffold**
- Use an LLM to produce initial journey configs (`project/journeys/*`) and persona files (`project/personas/*`).

3) **Run (Roadmap)**
- Execute `journey` with the runner; generate artifacts under `runs/<run_id>/`.
- Note: Current CLI is testcase-based. See [LOCAL_SETUP.md](./LOCAL_SETUP.md).

4) **Iterate (Claude → GPT → Claude)**
- **Claude (Walkthrough / Findings-only):** execute the flow as if it were the automation (same selectors + waits), and write a new findings document describing anything that would break or flake (popups, async transitions, widget quirks, selector drift, ordering constraints). No patches/edits.
- **GPT-5.2 (Apply fixes):** update journey/config/runner/adapters based on findings.
- **Claude (Re-run):** attempt the flow again after fixes. If it still fails, repeat the loop until the config is functional and stable.

---

## Prompts (bootstrap assets)
Canonical prompts are located in `framework/prompts/`:
- `01_INTAKE_AND_SCAFFOLD.md`
- `02_LOCATORS_AND_CORRECTION.md`
- `03_REPORT_AND_DEV_HANDOFF.md`

Legacy/archived template prompts are under `framework/prompts/_archive/legacy_template_prompts/`.

Important: the **Walkthrough** prompt is explicitly "findings-only": it must produce a findings document and **must not** start making changes.

---

## Journey Authoring Formats

### A) Declarative journeys (default)
- `project/journeys/<name>.json` or `.yaml`
- Best for most flows; easiest to scaffold with an LLM.

### B) Code journeys (escape hatch)
- `project/journeys/<name>.journey.ts` or `.journey.js`
- Exports `defineJourney({...})`
- Still mostly declarative `steps[]`, but can include named hooks for special logic.

---

## Journey Loading Rules (deterministic)
CLI flag: `--journey <name-or-path>`

1) If `--journey` ends with `.json|.yaml|.yml|.ts|.js`: load that file directly.
2) If `--journey` is a name (e.g. `checkout`), search `project/journeys/` in this order:
   - `<name>.journey.ts`
   - `<name>.journey.js`
   - `<name>.json`
   - `<name>.yaml`
   - `<name>.yml`
3) If multiple matches exist: fail and require explicit path.

---

## Step Standard Library (supported actions)

### Navigation
- `goto`: `{ url, waitUntil?, timeoutMs?, checkpoint? }`
- `reload`: `{ waitUntil?, timeoutMs? }`
- `back` / `forward`: `{ waitUntil?, timeoutMs? }`

### Stability / waits
- `sleep`: `{ ms }`
- `waitForURL`: `{ includes? | regex?, timeoutMs? }`
- `waitForVisible|Hidden|Attached|Detached`: `{ selector, timeoutMs? }`
- `waitForNetworkIdle`: `{ idleMs?, timeoutMs? }`

### User actions
- `click`: `{ selector, button?, clickCount?, timeoutMs? }`
- `type`: `{ selector, text, delayMs?, timeoutMs? }`
- `fill`: `{ selector, value, timeoutMs? }`
- `clear`: `{ selector, timeoutMs? }`
- `press`: `{ selector?, key, timeoutMs? }`
- `select`: `{ selector, value? | label?, timeoutMs? }` (native `<select>`)
- `check` / `uncheck`: `{ selector, timeoutMs? }`
- `upload`: `{ selector, path, timeoutMs? }`
- `scrollIntoView`: `{ selector }`
- `hover`: `{ selector }`

### Assertions
- `expectVisible|Hidden`: `{ selector, timeoutMs? }`
- `expectTextContains`: `{ selector, text, timeoutMs? }`
- `expectURLContains`: `{ text, timeoutMs? }`
- `expectCount`: `{ selector, count, timeoutMs? }`
- `expectAttributeContains`: `{ selector, attr, text, timeoutMs? }`
- `expectNoConsoleErrors`: `{ allowPatterns?, mode?: "fail"|"warn" }`

### Extraction (for chaining + reporting)
- `extractText`: `{ selector, saveAs, timeoutMs? }`
- `extractAttribute`: `{ selector, attr, saveAs, timeoutMs? }`
- `extractURL`: `{ saveAs }`

### Evidence / checkpoints
- `checkpoint`: `{ id, screenshot?: true|string, saveCookies?: boolean, flushDataLayer?: boolean }`
- `screenshot`: `{ path, fullPage?: boolean }`

### Control flow (minimal)
- `try`: `{ steps: Step[], onError: "continue"|"fail", note? }`
- `if`: `{ when: Predicate, then: Step[], else?: Step[] }`
  - predicates: `selectorVisible`, `selectorExists`, `urlIncludes`, `varEquals`

### Escape hatch
- `custom`: `{ hook: string, input?: object }`

---

## Variable Templating (simple interpolation)

### Built-ins (always available)
- `{RUN_ID}`, `{RUNSET_ID}`, `{ENV}`, `{BASE_URL}`, `{BROWSER}`, `{SYSTEM}`, `{TS}`

### Journey variables
- `journey.variables.foo` becomes `{foo}`

### Persona variables
- Persona object available as `{persona.email}`, `{persona.first_name}`, etc.

### Extracted variables
- Extraction map available as `{extract.order_id}`, etc.

### Rules
- Only string replacement (no expressions).
- Resolve with max depth (e.g. 3 passes).
- Unknown variables: default fail fast; optional dev flag to allow during scaffolding.

---

## Hooks (safe escape hatch)

### Hook resolution order
1) Journey-local hooks (defined inside `defineJourney({ hooks })`)
2) Project hooks (`project/hooks/index.ts`)
3) Built-in hooks (runner-shipped, e.g. cookie banner dismissals)

### Hook signature
Hook receives a controlled context:
- `ctx.page`, `ctx.context`
- `ctx.vars`, `ctx.persona`, `ctx.extract`
- `ctx.evidence` (screenshot/event writers)
- `ctx.log`, `ctx.sleep`, `ctx.expect` helpers

Return:
- `void` or structured `HookResult` for logging.

### Constraints (recommended)
- Hooks should avoid writing files directly; use `ctx.evidence`.
- Hooks should not silently swallow errors unless invoked inside `try` or explicitly configured.

---

## Collectors / Evidence Artifacts (run output)
Each run produces a consistent folder structure under `runs/<run_id>/`:
- `evidence/steps.jsonl` (every step start/end, success/failure, duration)
- `evidence/console.events.jsonl` + `console.errors.summary.md`
- `evidence/navigation.timeline.jsonl`
- `cookies/<checkpoint>.cookies.json`
- `evidence/screenshots/*` (or flat screenshot paths)
- `network/network.summary.jsonl` (HAR-lite summary)
- `evidence/datalayer.events.jsonl` + summary (optional)
- `derived/run.summary.json` + `run.summary.md`

---

## CLI (Roadmap)

> **Note**: The journey-based CLI described below is a future design direction. The current framework CLI supports testcase-based runs. See `framework/docs/LOCAL_SETUP.md` for current CLI usage.

Suggested future commands:
- `scaffold --journey <name>`: prints the right prompt(s), creates empty placeholders if desired
- `run --journey <name|path> --runset <id> --env <A-logged_out|B-logged_in|C-incognito>`
- `run --print_plan`: prints normalized steps + resolved variables (no browser run)
- `report --runset <id>`: summarize/diff A/B/C artifacts

---

## Adapters (future concept)
Adapters are reusable "complex steps" implemented once and referenced by journeys.
Examples:
- `multipage_form_from_locator_map` (wraps current locator-map style)
- widget adapters: `choices_js`, `select2`, `react_select`, `intl_tel_input`
- interstitial adapters: cookie banners, marketing popups, geo/age gates
- auth adapters: record/load storage state, login helper

Journeys reference adapters via:
- `{ type: "adapter", adapter: "<name>", input: {...} }`
(or treat adapters as named hooks, depending on implementation preference)

---

## Claude MCP Walkthrough (optional stage)
Purpose: validate real behavior and produce findings that static scaffolding misses:
- conditional fields
- async transitions
- interstitials/popups
- widget quirks
- hidden honeypots
- value formats for selects/dates

Output: `WALKTHROUGH_FINDINGS.md` + optionally `findings.json` for automation later.

### Findings naming convention (required)
Each walkthrough run must create a *new* findings document (never overwrite prior runs).

Store under the testcase (suggested): `playwright_phased_runner/testcases/<testcase_id>/walkthrough_findings/`

Filename format (sortable, deterministic, no secrets):
`WALKTHROUGH_FINDINGS__<journey_id>__<env>__iter<NN>__<YYYY-MM-DDThhmmssZ>.md`

Example:
`WALKTHROUGH_FINDINGS__checkout_guest__A__iter01__2026-01-24T204701Z.md`

---

## Open Questions (to decide as you iterate)
- Do we want YAML support or JSON-only for maximum determinism?
- How strict should selector best practices be (e.g. require `data-test` when possible)?
- How to handle authentication generically (storageState recording, SSO flows)?
- What's the minimum adapter set for "day 1 usefulness"?
- Do we want CI outputs (JUnit) as default?
