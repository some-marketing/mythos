# Cadence

This is **guildmaster-loop (the generic `orchestrate-loop`) on a clock.** It
does not introduce a new orchestration contract — it operationalizes a
standing check-in rhythm as durable, resumable state so the Guildmaster
(coordinator) doesn't re-brief each slice.

## The rhythm

The operator runs **three operator-initiated check-ins per day** —
morning / afternoon / night. At each slice, the Guildmaster advances **ONE
task (leaf) per active domain** — including the system level — via **one
familiar (subagent) each**, or records the leaf's honest state (blocked /
parked / done).

Domains are whatever you're actually running. A typical guild tracks a
handful of patron (client) domains, one build/homebrew domain for your own
tooling, one system domain, and one personal domain — for example
`patron-alpha`, `patron-beta`, `homebrew-grimoires`, `SYSTEM`, `PERSONAL`.
The names are yours; the renderer doesn't care what you call a domain, only
that it's registered.

## What lives here

- `_dev/state/cadence/domain-registry.json` — the domains: id, scope
  (client/system/personal), label, and status. (This state file isn't
  shipped with example data — see `_dev/state/cadence/README.md` if your
  guild ported the `_dev` skeleton, or create it fresh.)
- `_dev/state/cadence/current-leaf.json` — one active leaf per domain: the
  single task being advanced, its state, what it's blocked on, and the last
  artifact produced.
- `tools/cadence/check-in.js` — a **READ-ONLY renderer**. It reads the two
  JSONs and prints the per-slice grid. It does **not** dispatch agents and
  does **not** mutate state. Dispatch stays native.

## Running a check-in

```
node tools/cadence/check-in.js          # grid
node tools/cadence/check-in.js --json   # structured
npm run cadence                         # alias, if wired in your package.json
```

This renders state only. To actually advance work, dispatch stays native:
run `/guildmaster-loop` (short form `/gm`; compatibility alias `/owl`) per
domain — one familiar per leaf — exactly as before. The renderer tells you
where each domain stands so you can pick up each slice without re-briefing.

## Hand-updating a leaf between slices

`check-in.js` never writes state. When a leaf advances, is blocked, parks, or
completes, edit `_dev/state/cadence/current-leaf.json` directly (or via
whatever native command produces the change) and update that domain's entry:

- `leaf` — the new single task being advanced for that domain.
- `state` — one of `active`, `blocked`, `parked`, `done`, `unset`.
- `blocked_on` — the named dependency when `state` is `blocked`, else `null`.
- `last_artifact` — repo-relative path to the most recent durable artifact, or
  `null`.
- `updated_at` — leave as-is or set to the current ISO timestamp. The renderer
  does not generate timestamps; seeded values are `null` and get stamped by
  the update path later.

To add or retire a domain, edit `domain-registry.json` and mirror the
`domain_id` in `current-leaf.json`. The renderer keys leaves to domains by
`domain_id`; a domain with no matching leaf renders as `unset`.

## Example `domain-registry.json`

```json
{
  "schema": "CadenceDomainRegistry/1.0",
  "description": "Domains advanced one task at a time per cadence slice (morning/afternoon/night). Pure state; rendered by tools/cadence/check-in.js. Dispatch stays native (guildmaster-loop / gm / owl).",
  "domains": [
    { "id": "patron-alpha", "scope": "client", "label": "Patron Alpha Engagement", "status": "active" },
    { "id": "patron-beta", "scope": "client", "label": "Patron Beta Engagement", "status": "active" },
    { "id": "homebrew-grimoires", "scope": "client", "label": "Internal tooling and homebrew builds", "status": "active" },
    { "id": "SYSTEM", "scope": "system", "label": "Mythos system maintenance", "status": "active" },
    { "id": "PERSONAL", "scope": "personal", "label": "Operator personal", "status": "unset" }
  ]
}
```
