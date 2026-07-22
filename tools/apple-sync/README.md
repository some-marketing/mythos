# apple-sync — Dart ↔ Apple Reminders + Notes mirror

Two-way mirror between the Dart task workspace and the operator's Apple
Reminders and Notes.

## What it does

- **Reminders (two-way).** Every active Dart task becomes a Reminder in a
  per-board list named `Dart: <Board>` (e.g. `Dart: Example Board`).
  - Dart → Apple: new tasks create reminders; title/due edits update them;
    completed tasks complete their reminder.
  - Apple → Dart: completing a reminder writes the completion **back** to Dart
    (sets the task to `Done`).
- **Notes (one-way digest).** A single note `Dart Tasks — Active` is rebuilt
  each run with per-board sections, counts, and due dates — a readable index.

## Run

```bash
node tools/apple-sync/sync.js              # full two-way sync
node tools/apple-sync/sync.js --dry-run    # compute + print plan, write nothing
node tools/apple-sync/sync.js --no-writeback  # Dart→Apple only, never write back to Dart
node tools/apple-sync/sync.js --force      # bypass the write-back safety cap
node tools/apple-sync/sync.js --verbose    # print every reminder op
```

## Scheduled poller

A user LaunchAgent runs the sync every 30 minutes. It **must** run in the GUI
(Aqua) session because Apple Events to Reminders/Notes require the TCC
automation grant tied to that session.

```bash
cp tools/launchd/dev.mythos.apple-sync.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.mythos.apple-sync.plist
```

(`tools/launchd/` itself is a separate architecture-scaffold port, out of scope for this batch — write your own plist pointing `ProgramArguments` at `node tools/apple-sync/sync.js` on your own schedule if you don't have one yet.)

## Config — `config.json`

| key | meaning |
|-----|---------|
| `listPrefix` | prefix for managed Reminders lists (`"Dart: "`) |
| `digestNoteTitle` | title of the digest note |
| `digestNoteFolder` | Notes folder to write the digest into |
| `excludeBoards` | Dart boards to skip (default excludes `Personal/Tutorial tasks`) |
| `includeBoards` | if set, ONLY these boards sync (allow-list); `null` = all but excludes |
| `activeLimitPerBoard` | max tasks pulled per board |
| `writeBack.enabled` | master switch for Apple→Dart completion write-back |
| `writeBack.maxPerRun` | safety cap — if a run would write back more completions than this, **all** are withheld and a warning is logged (override with `--force`) |
| `doneStatus` | Dart status applied on write-back (`"Done"`) |

## Safety model

- **First run is pure population.** With an empty mapping store no write-backs
  are possible, so the first sync only creates reminders + the note.
- **Completion-only write-back.** The only thing ever written back to Dart is
  completion. Tasks are never deleted and arbitrary Apple-side field edits are
  never pushed to Dart.
- **Write-back cap.** A reconciliation bug can't mass-close real Dart tasks: if
  one run would complete more than `maxPerRun` tasks, every write-back is
  withheld until you re-run with `--force`.
- **Reminders-resilient.** If the Reminders scripting bridge is unavailable
  (it can hang/timeout on cold access), the Notes digest still updates and the
  mapping store is left untouched so the next poll retries cleanly.
- **Conflict policy.** Dart wins on field edits; completion propagates in
  whichever direction it newly occurred.

## State & logs

- Mapping store: `_dev/state/apple-sync/mapping.json` (Dart id ↔ reminder id +
  last-synced snapshots; drives change detection).
- Run log: `_dev/state/apple-sync/sync-log.jsonl`.
- LaunchAgent logs: `_dev/state/apple-sync/launchd.{stdout,stderr}.log`.

## Layout

```
tools/apple-sync/
  config.json            included/excluded boards, write-back policy
  sync.js                CLI entrypoint + orchestration
  lib/
    apple-bridge.js      node→JXA wrapper (chunked, retry-safe writes)
    reconcile.js         pure two-way reconciliation (unit-tested)
    mapping-store.js     persistent id mapping + snapshots
  jxa/
    reminders-read.js    bulk read managed reminders
    reminders-apply.js   batch create/update/complete
    note-upsert.js       upsert the digest note
  __tests__/reconcile.test.js
```

Run tests: `node tools/apple-sync/__tests__/reconcile.test.js`
