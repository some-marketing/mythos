# Meditation — 2026-08-18 — lost functionality after the sm_os-recovered port

> Focus: dreams database, memory vault + Obsidian, dreaming functionality, and mechanical handlers
> inherited from the sm_os-recovered port that are present in mythos but unwired.
> Mode: deep-dive evidence gather → reflect → outward lens → ranked repair candidates.

## 1. Observations (evidence, current session)

### 1.1 The dreaming DB and engine — WIRED and RUNNING
- `_dev/state/memory-db/memory.sqlite` (2.5 MB), `dream-report.md`, `dream-seen.json` (1 MB), `mocs/`
  all rebuilt **today 10:54** by the session-start hook. `dream-report.md` header: 83 memories + 103
  concepts = 186 nodes; 10,732 associations; deterministic scoring formula documented.
- Engine `tools/memory/build-memory-db.js` runs at session start via
  `tools/kernel/hooks/dispatch-session-start.cjs` (script list includes `build-memory-db.js` +
  `contextual-inject.cjs`, advisory). Verified this session: `node tools/memory/build-memory-db.js`
  → exit 0 in 0.42s.
- Launchd `ca.somemarketing.mythos.dream-rebuild` is LOADED (daily 3:00 AM via
  `tools/memory/rebuild-memory-and-mocs.sh` → build DB then MOCs). Last launchd stdout write
  `2026-08-16 03:00` — the calendar job has not fired since (machine asleep at 3:00 AM is the
  likely cause; the session hook covers daily rebuilds meanwhile).
- Entity persistence layer exists: `tools/memory/agent-state.js` + `schemas/agent-state.schema.json`
  (agent-state/1.0). Ant-sim dream lane (`tools/ant-hive-world/dream/*`) IS wired: `run-live.js`
  requires `dream-memory.js`, `train-tick.js` requires `dream-lane.js`; `dream-memory.jsonl` (3.9 MB)
  exists.

### 1.2 Tier-0 dream hints — THE DEAD SURFACE (lost functionality #1)
- `tools/memory/contextual-inject.cjs` emits `[dream]` entries ONLY when a `<sid>.tier0.txt` hint
  file exists; otherwise it prints `contextual-inject: no hints for this session` and returns BEFORE
  the dream section is emitted.
- The producer of those files, `tools/memory/contextual-sweep.js`, has **ZERO live callers**:
  - not in the session-start hook script list,
  - no launchd job installed (only an unrendered template `tools/memory/contextual-sweep.plist.template`
    with `__MYTHOS_ROOT__`/`__HOME__` placeholders; `StartInterval 120`, `RunAtLoad true`),
  - `_dev/state/contextual-hints/` contained **zero** `.tier0.txt` files before this session.
- **Proof the chain works when fed** (run this session):
  `node tools/sessions/session.js register --session-id 89244726... --branch fix/sim-foundation-repairs
  --actor codewhale` → wrote `<sid>.json` heartbeat; then
  `node tools/memory/contextual-sweep.js --session-id 89244726...` → wrote
  `_dev/state/contextual-hints/89244726...tier0.txt` (20 hits); then
  `node tools/memory/contextual-inject.cjs --session-id 89244726... --dry-run` → **10 `[dream]` entries**
  with shared rare terms. Dreams are computed and surfaceable; nothing feeds them to sessions.

### 1.3 Heartbeat / `_current-id` grounding — stale (lost functionality #2)
- `_dev/state/active-sessions/_current-id` points at `d48197d5...` (a previous session), not the
  current `89244726...`. `resolveSessionId()` best-effort rungs fall through when the sidecar target
  is not TTL-live, so the sweep's `loadFreshSessions()` finds "no fresh active sessions" by default.
- Only one `<sid>.json` heartbeat existed before this session (8d1a1d1b..., Aug 16).
- `new-session.cjs` grounds `_current-id` ONLY from an env-derived authoritative id; a codewhale
  session that registers but sets no env leaves the sidecar stale (documented in the handler comment).

### 1.4 Memory vault + Obsidian — WIRED and RUNNING
- Canonical `tools/memory/memory-vault.js` (rewired 2026-07-30 `8f5cf4b1`, TCC-fixed 2026-08-11
  `8e0a9242`): harness-project-dir resolver, shared token resolver, gated interactive `op` fallback.
  Called by `tools/memory/reconcile-vault-drift.js` (hygiene-sweep chain).
- Stale twin `memory/memory-vault.js` (root tree): 462 lines, hardcoded dead slug
  `-Users-admin-Documents-GitHub-SM-OS`, **zero live callers** (only inventory evidence lists it).
  The memory-vault-rewire concept declared consolidating root duplicate trees a NON-GOAL → deletion
  is operator-gated.
- `Mythos-memories/.obsidian/` is a valid vault (app.json, workspace.json, core-plugins incl.
  `"sync": true`). Registered in `~/Library/Application Support/obsidian/obsidian.json`.
- Sync job `ca.somemarketing.mythos.obsidian-vault-sync` LOADED, fires every 30 min, stdout log
  written **today 10:56** (7,550 vault files, 83 memory-leg files; stderr empty). RUNNING.
- NOT connected to Obsidian cloud Sync (app.json is `{}`; no sync session on disk) — plugin enabled
  but no session configured. Operator decision.

### 1.5 Port-era mechanical handlers — mixed (lost functionality #3)
- Root `launchd/` tree = **stale smos duplicate family** (canonical is `tools/launchd/`):
  - 12 smos plists point at the DELETED `~/dev/SM_OS-recovered/` tree (moved to external
    storage per memory `sm-os-recovered-moved-to-general-storage`). All 12 targets MISSING.
  - `ca.somarketing.smos.delesign-poll` is **STILL LOADED** in launchctl (points into mythos, works,
    but wrong family; its mythos twin exists unloaded — identity confusion).
  - Root `launchd/install.sh` and `launchd/run-*.cjs` runners are stale duplicates of the
    `tools/launchd/` canonical set (different hashes).
- `org.mythos.portable.*` (6 jobs) are LOADED and point at
  `~/.mythos-worktrees/mythos-portable-main/` — a Jul 29 **frozen worktree snapshot**,
  not the live repo. They run old code. (Worktree dir still exists.)

### 1.6 Framework and verification contract
- `frameworks/meta/dreaming-system` promoted to production (candidate status: production,
  `promoted_to` set). 7 prompts, including `07_verify_e2e` whose contract expects a
  `verify-evidence.json` — **absent** for the current integration (no `reports/dreaming-system/`
  output tree; the framework's output_contract dirs don't match where artifacts actually live
  (`_dev/state/memory-db/`)).
- Perplexity outward lens: unavailable this session — `tools/ai-bridge/perplexity-api/` does not
  exist (only known-broken `query.js`); rewire evidence already recorded a Perplexity credential gap.

## 2. Reflections

- **The user's belief ("nothing is wired") is partially false and partially true.** The dreaming DB,
  vault sync, memory-vault, and framework are genuinely wired and live. What is genuinely dead is the
  **Tier-0 dream delivery chain** — the one surface that would make the dreaming functionality
  observable to a session — plus heartbeat grounding, plus the port-era launchd residue.
- **Recurring failure class**: "ported but not scheduled." The port copied files (scripts, plists,
  templates) but the *scheduling/registration* layer was not re-wired: the sweep template was never
  rendered/installed, `_current-id` grounding depends on env this harness doesn't set, and the smos
  plist family still references the deleted donor tree. Files are not wiring.
- **Design decisions reality contradicted**: the rewire made root-duplicate consolidation a
  non-goal and Perplexity cloud sync optional; both decisions left residual confusion (stale twin
  files, dead obsidian.json entry for `sm_os-memories` whose directory no longer exists).
- **Falsifier discipline**: every "wired" claim above is backed by an artifact mtime or exit code
  from this session (dream-report 10:54, sync log 10:56, smoke exit 0, sweep→inject 10 dreams).

## 3. Outward findings (research receipts)

- Query: (none executed) — outward research surface unreachable: `tools/ai-bridge/perplexity-api`
  missing, `query.js` known-broken. Receipt: `{path: unavailable, finding: gap named, per skill
  rule "unreachable research surface drops a rung with the gap named"}`. No world-calibration
  needed for repo-internal wiring facts; all claims verified against local artifacts.

## 4. Ranked repair candidates (meditate emit)

| # | Candidate | Benefit | Cost | Falsifier | Gate |
|---|---|---|---|---|---|
| R1 | Wire `contextual-sweep.js` as a launchd job (render template → tools/launchd → load); restore Tier-0 dream hints to sessions | Dreams surface at every session start (the lost dreaming surface) | Small; one plist + launchctl load | After install: fresh `<sid>.tier0.txt` exists and inject emits ≥1 `[dream]` | EXECUTE (safe, reversible) |
| R2 | Ground `_current-id`/heartbeat at session open for env-less harnesses | Sweep finds fresh sessions without manual registration | Small; handler/registry change | resolveSessionId returns current sid without env | EXECUTE or operator |
| R3 | Unload `ca.somemarketing.smos.delesign-poll`; retire root `launchd/` smos family (12 dead plists + duplicate install.sh/runners) | No stale-family confusion; single canonical `tools/launchd/` tree | Deleting tracked files; launchctl unload | launchctl list shows only mythos family; repo has one launchd tree | OPERATOR (deletion) |
| R4 | Repoint or tombstone `org.mythos.portable.*` jobs (frozen worktree) | Jobs stop running Jul 29 code | Operator decision on intent | Job target is live repo or removed | OPERATOR |
| R5 | Clean obsidian.json: remove dead `sm_os-memories` registration; decide Obsidian Sync cloud | No broken vault entry; sync decision explicit | User-config edit | obsidian.json has one live vault | OPERATOR |
| R6 | Delete/archive stale `memory/memory-vault.js` twin | No dead-slug twin confusion | Was rewire non-goal | grep shows zero live refs (already true) | OPERATOR (deletion) |
| R7 | Produce `verify-evidence.json` for the dreaming framework (07_verify_e2e contract) | Framework e2e contract fulfilled; regression baseline | Small report write | File exists with pass/fail per gate | EXECUTE (report) |

## 5. Verdict

Executed this session (safe, reversible, verified): R1 (sweep job wiring) and R7 (verify evidence).
Surfaced to operator: R2 (heartbeat grounding design), R3 (stale smos family retirement — deletion),
R4 (portable worktree policy), R5 (obsidian registration/cloud sync), R6 (stale twin deletion).
The dreaming engine and vault sync themselves needed no repair — they were never the broken part.
