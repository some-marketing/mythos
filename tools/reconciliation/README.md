# Reconciliation — content-hash identity library

A small, dependency-free library for answering one question durably:
"is this content still the same content I bound evidence to earlier?"

## What's here

- `lib/normalized-content-hash.cjs` — hashes a value two ways: a raw
  `byte_sha256` (hash of the exact bytes) and, when the content is JSON, a
  `sha256` computed over a **canonicalized** form (keys sorted, no
  whitespace-dependent differences) so semantically-identical JSON hashes
  identically even if formatting drifted. Falls back to `state: 'unsupported'`
  rather than throwing when a value can't be normalized (e.g. malformed JSON
  passed with `format: 'json'`), so a caller always gets a hash back, never
  an exception mid-reconciliation.

- `lib/evidence-binding.cjs` — binds a list of repo-relative paths to their
  current content hashes, refusing to escape the project root (rejects
  absolute paths, `..` segments, null bytes, and symlink escapes via
  `fs.realpathSync` containment checks). Produces an `EvidenceBindingReceipt/1.0`
  with a state of `bound` (every path resolved and hashed), `ambiguous` (at
  least one path tried to escape the root), or `missing_source` (a path
  didn't resolve to a real file). Its own `binding_sha256` is a hash of the
  whole binding set, so two reconciliation runs can compare "did the *set* of
  evidence change" in one comparison instead of walking every entry.

## Design shape

Neither module writes anything or reaches outside the paths it's given —
this is a pure identity/verification layer. A caller (a maintenance
reconciler, a plan-review gate, a debrief tool) is responsible for deciding
*what* to bind and *what to do* when a binding comes back `ambiguous` or
`missing_source`.

## What isn't here

The source repo this was extracted from had a test suite
(`__tests__/shared-reconciliation.test.js`) exercising this library through
a generated-surface reconciler in a `maintenance/` module. That reconciler
is a separate architecture scaffold (see `tools/maintenance/` if your guild
ports it) — this library doesn't depend on it, and the test wasn't ported
since it only makes sense wired to that specific reconciler. Both modules
here are otherwise complete and usable standalone.
