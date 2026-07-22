# Transcripts — session-note distillation pattern

Three tools around one idea: a raw Claude Code session JSONL is too
unstructured to be a durable memory surface, but a distilled note with a
fixed schema is. This is the pattern for turning the former into the latter.

## What's here

- **`snapshot-current-session.cjs`** — wire this as a `Stop` hook and it
  copies the current session's transcript JSONL into a durable location on
  every turn, append-only with timestamped filenames. If anything later
  rewrites or truncates the live transcript, prior snapshots are unaffected.
  Best-effort and non-blocking — a failed snapshot never fails the turn.
  Resolves the current project's transcript directory from `cwd` (Claude
  Code names it after the absolute path with separators replaced by dashes)
  rather than a hardcoded path, so it works in any repo.

- **`distill-session-note.cjs`** — turns one session JSONL into a
  schema-conforming Markdown note: YAML frontmatter (session id, model,
  timestamps, scope, source path) plus a body built from **mechanically
  extracted** structure (turn count, files touched) and **judgment fields
  supplied by the invoking operator/agent** (summary, decisions, outcome) —
  never inferred automatically from the transcript. This is a genericized
  stub, not the full port — see "What's stubbed" below.

- **`lint-session-notes.cjs`** — a read-only conformance lint over a
  directory of notes, classifying each as `CONFORMING`, `NONCONFORMING`
  (has `type: llm_session` frontmatter but fails schema checks), or
  `NOT-A-SESSION-NOTE` (no session-note frontmatter at all — the
  heterogeneous surface this schema exists to converge). Depends on
  `tools/memory/schemas/session-note.schema.json` — if your guild hasn't
  ported the `memory/` scaffold, this fails with a clear "cannot load
  schema" message rather than crashing silently.

## What's stubbed in `distill-session-note.cjs`

The source this was extracted from wrapped every read of a session
transcript in an elaborate operator-ratification-receipt system: a
task-specific approval receipt naming the bounded source and retention
target, a privacy-classification step (SYSTEM / PERSONAL / CLIENT-scoped)
with different default postures per class, and a credential-lint pass
through a private sentinel-pattern library before any write. None of that
machinery ships here — it was built for one guild's specific governance
model and hardcoded that guild's operator name and brand tag into the note
template.

What's kept is the load-bearing shape:

1. **Reading session JSONL should be a deliberate act.** This stub requires
   an explicit `--i-understand` flag before it reads anything. If your
   guild needs a real consent/ratification gate, build it as a wrapper that
   calls this stub only after its own approval step passes.
2. **Extract mechanically, judge manually.** `session_id`, timestamps,
   model, cwd, turn count, and files touched are pulled straight from the
   JSONL structure. Summary, outcome, decisions, and context are supplied
   via flags by whoever is doing the classifying — never derived
   automatically from reading the prose.
3. **Lint before write.** `lintNote()` is a no-op placeholder — wire in your
   own secret/credential-pattern scan there before you rely on this in a
   real workflow.

## Usage

```bash
node tools/transcripts/snapshot-current-session.cjs   # wire as a Stop hook

node tools/transcripts/distill-session-note.cjs --jsonl <path> --i-understand --preview

node tools/transcripts/distill-session-note.cjs --jsonl <path> --i-understand \
  --summary "..." --outcome "..." --decision "..." --dry-run

node tools/transcripts/lint-session-notes.cjs [path...] [--json] [--allow-foreign]
```
