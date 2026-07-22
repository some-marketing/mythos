# Session-lifecycle hooks — pattern and templates

Claude Code's `SessionStart` and `SessionEnd` hooks let a repo run mechanical,
no-LLM code at the edges of every session, without spending a model turn on
it. This directory is the pattern doc for that idea, plus two worked
templates.

## The live example already shipped

Mythos already wires a real `SessionStart` hook: `.claude/settings.json` runs
`tools/user/inject-mirror.cjs`, which reads `$MYTHOS_HOME` (default
`~/.mythos/`) and hands the session a labeled, advisory-only summary of your
Mirror — identity, working principles, a small allowlisted preference set,
and your alias overlay. Read that file first; it demonstrates the load-bearing
safety properties any hook in this position needs:

- **Silent on absence.** No `$MYTHOS_HOME`, or an unreadable one, means exit 0
  with no stdout and no stderr — a session with no Mirror runs exactly as one
  with no Mirror support at all.
- **Fixed allowlist.** Only a named set of preference keys are read; anything
  else is skipped, and the warning (stderr only) names the key, never the
  value.
- **Size-capped.** Every file it reads has a hard byte cap; oversize files are
  skipped entirely.
- **Labeled and bounded authority.** The emitted payload opens with a header
  that says, explicitly, that it's untrusted, advisory, and incapable of
  granting authority, choosing commands, mutating files, or overriding the
  Core.
- **Never fails loud.** Nothing about a hook malfunctioning should ever block
  a session from starting or ending.

## The two templates in `session-lifecycle/`

These go further than a personal-preference brief — they surface **working
state**: pending cross-session handoffs, dirty-tree size, and a crash floor
that guarantees a durable trace even if a session ends without running its
full close-out ritual.

They ship as **templates**, not wired-in hooks, because the full
session-lifecycle command surface (a session-open ritual, a session-close
ritual, a daily brief, a repo-hygiene sweep) is reserved vocabulary in Mythos
— see `docs/LEXICON.md`'s "Reserved Vocabulary" section — and hasn't shipped
publicly. Build your own equivalents, then plug them into the marked
extension points.

- **`session-start-brief.template.cjs`** — runs as-is against the ported
  `_dev` skeleton (`_dev/state/session-boundary/pending/`,
  `_dev/reports/analysis/next-session-handoff.md`). No private dependencies.
  Reads pending boundary markers and the standing handoff file, checks
  `git status` for dirty-tree size, and emits it all as `additionalContext`
  in under a second.

- **`session-end-close.template.cjs`** — the crash-floor pattern: if no
  per-scope boundary marker was touched in the last 6 hours, write an
  enriched stub marker so the next session always has a thread to pick up.
  The three private library functions the original implementation depended
  on (an atomic marker writer, a path-redaction filter shared with a
  shutdown command, and a closeout-view builder) are stubbed inline with
  minimal, self-contained equivalents — replace them with your own guild's
  real implementations once you have session-lifecycle commands of your own.
  Look for the comment block marked `Stubs standing in for your own guild's
  session-lifecycle libraries`.

## Wiring a template in

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node ${CLAUDE_PROJECT_DIR}/tools/user/inject-mirror.cjs", "timeout": 5 }] },
      { "hooks": [{ "type": "command", "command": "node ${CLAUDE_PROJECT_DIR}/tools/hooks/session-lifecycle/session-start-brief.template.cjs", "timeout": 5 }] }
    ],
    "SessionEnd": [
      { "hooks": [{ "type": "command", "command": "node ${CLAUDE_PROJECT_DIR}/tools/hooks/session-lifecycle/session-end-close.template.cjs", "timeout": 45 }] }
    ]
  }
}
```

Multiple hooks on the same event run in the order listed. Keep every hook
fast, silent-on-failure, and side-effect-bounded — a hook is not the place
for judgment calls or destructive operations.
