# Auto-bridge — the post-write hook pattern

## What triggers it

A session-lifecycle harness (an editor extension, a CLI agent runtime, a
CI job) typically exposes a hook point that fires right after a tool call
mutates a file — "PostToolUse" in Claude Code's naming, an `on:write` event
in others. A post-write hook receives that event, inspects the path that
was just written, and decides whether to act.

## What it's for

The general shape: certain writes are structurally significant enough that
they should trigger a follow-up action automatically, without the operator
having to remember to ask for it. The source implementation in this
codebase fires when a document landing in a specific top-level directory
matches content-shape heuristics (specific section headers, a declared
"form" marker, a minimum count of cross-reference lines) that mark it as
an architecture-level claim rather than routine notes — and, when it
matches, dispatches an asynchronous review to an external reviewing actor.

Generically, a post-write hook is useful whenever you want:

1. **A cheap, deterministic gate** — pattern-match the path and/or content
   before doing anything expensive. Most writes should be silently
   ignored; only ones matching the pattern should proceed.
2. **A non-blocking follow-up** — the hook should never make the operator
   wait on whatever it triggers. Record intent to a small marker/log file
   (or spawn a detached child process) and return immediately.
3. **Suppression escapes** — an environment variable, a sentinel file, or
   per-file frontmatter that lets a specific write opt out of the
   follow-up action, for cases where the pattern match is a false positive
   or the follow-up has already happened through another path.
4. **Idempotence against duplicate triggers** — if the follow-up action
   creates its own durable record, check for an existing one before
   creating another (the private implementation checks a signal directory
   for a dispatch already matching the same file before firing again).

## How to wire it into a session-lifecycle hook

Any harness that exposes a PostToolUse-shaped hook can drive this: register
the hook script against `Write`/`Edit` tool calls, have the harness pipe the
tool-call payload (containing the written file's path) to the script over
stdin (or an environment variable, as a fallback channel), and let the
script's own exit path decide silently-ignore vs. act. Because the hook
only ever reads the one file it was told about and writes to its own
scratch directory, it is safe to fire on every write — the cost of a
non-matching write is one `fs.existsSync` and one glob test.

## What's shipped: `post-write-note.cjs`

A minimal, fully working, self-contained demonstration of the detect step
of the pattern:

- Reads a tool-call-shaped payload from stdin (falling back to reading a
  JSON blob from an environment variable), extracting `tool_input.file_path`.
- Resolves that path against a project root (`MYTHOS_PROJECT_DIR`, default
  `process.cwd()`).
- Matches the relative path against a configurable glob-ish pattern
  (`MYTHOS_NOTE_PATTERN`, default `notes/*.md` — top-level only, no
  subdirectories, mirroring the source hook's top-level-only match).
- On a match, writes a small JSON note (`{ schema, timestamp, path, pattern }`)
  to `_dev/state/post-write-pending/` and prints a one-line confirmation.
- On a non-match (wrong path, wrong directory depth, file doesn't exist),
  it is completely silent — no output, no marker.

## What's deliberately not shipped

The real trigger logic in `post-write-concept.cjs` is coupled to private
machinery this export target does not include:

- **A private canonical-root resolver** (`tools/lib/canonical-root.cjs`)
  used to hard-anchor the project root against a stale/foreign working
  directory.
- **A private dispatch-bridge runner** (`tools/signals/dispatch-bridge.js`)
  that the hook spawns as a detached child process to route the matched
  document to an external reviewing actor (Codex or Gemini, chosen by a
  content heuristic).
- **A private handoff-signal surface** (a directory of JSON records this
  codebase calls its coordination-signal store) that the hook scans to
  avoid firing a second dispatch for a document that already has one
  in flight.
- **Content-shape heuristics specific to this codebase's own concept-doc
  schema** (a "triadic form" marker, a "Falsifiable" section header, an
  "Epistemic mode" declaration, a minimum count of "Composes with" lines) —
  these encode judgment calls about this codebase's own architecture-claim
  taxonomy and aren't generically reusable as-is.

`post-write-note.cjs` demonstrates the reusable shape — detect, gate,
record, return fast — without any of the above. Swap in your own dispatch
target and your own content heuristics to adapt it.
