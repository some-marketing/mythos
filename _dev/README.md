# `_dev` — the workshop behind the guild hall

Everything the guild ships in `.claude/`, `instructions/`, `frameworks/`, and `tools/`
is the finished storefront: commands, doctrine, grimoires, aliases. `_dev/` is the
workshop behind it — where a session actually plans, drafts, reviews, and logs its own
work before (or instead of) anything reaches the shopfront.

In plain software terms: `_dev/` is your project's scratch-and-record surface. It is
not shipped to patrons, not part of any grimoire's runtime, and never a dependency of
the System kernel. Delete it and the guild hall still stands — you just lose your own
working history.

## What lives here

- **`policies/`** — the operating contracts that govern how this workshop runs: how
  artifacts age and archive, what a quest charter (task plan) must contain, how loop
  charters are drafted, and more. Read these once; they rarely change.
- **`concepts/`** — durable design decisions and their reasoning, one file (or bundle)
  per decision. See `concepts/_README.md` and `concepts/_policy.md`.
- **`config/`** — schemas for configuration this workshop expects you to populate
  yourself (nothing here ships pre-filled with real values).
- **`loops/`** — charters for self-improving work loops: doctrine, a template, and one
  fully worked fictional example. See `loops/README.md`.
- **`reports/`, `state/`, `research/`, `logs/`, `drafts/`, `plans/inbox/`, `archive/`**
  — the working surfaces themselves, shipped empty (skeleton only) with a short README
  in each explaining what belongs there. You populate these as you actually work.

## The lifecycle

Every artifact this workshop produces moves through the same four states:

1. **Active** — currently in use; stays in its hot surface (e.g. `reports/analysis/`).
2. **Finished** — the work that produced it is done; eligible for archiving.
3. **Archived** — moved to `archive/{year}-{month}/{surface}/`, logged to
   `logs/archive.jsonl`, still readable.
4. **Pinned** — evidence-critical; never auto-archived or auto-deleted.

The full contract for this lifecycle — including the exact archive-log schema — is in
`policies/data-handling.md`.
