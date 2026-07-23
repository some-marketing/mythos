# worldforge

A small, dependency-free (Node stdlib only) toolkit for building a human-gated
pipeline around a `world-spec/1.0` JSON document: a proposal generator, a
schema validator, a content-addressed approval mechanism, and a set of
mechanical safety detectors for a renderer that turns the spec into a live
scene.

Nothing here activates, launches, or writes anything on its own initiative.
Every writer (`import-approved-world-spec.js`, `launch-worldforge-render.js`)
defaults to dry-run and requires an explicit flag plus an operator-signed
approval to do anything real.

## Pipeline

1. **`generate-world-spec-proposal.js`** — asks a local model (e.g. Ollama)
   to propose exactly one new entity, sanitizes and appends it to a base
   spec, and writes an unapproved `vNext` proposal.
2. **`validate-world-spec.js`** — deterministic schema + safety-pattern
   validator for `world-spec/1.0`. No external dependencies.
3. **`closure-hash.js`** — computes a hash over the spec bytes *and* every
   payload file the spec references (not just the spec file itself), closing
   the classic TOCTOU hole where a benign spec is approved and a referenced
   asset is swapped afterward.
4. **`approval-sign.js`** — HMAC-signs a closure hash with an operator-held
   key (never checked into the repo; supplied via the
   `WORLDFORGE_APPROVAL_HMAC_KEY` environment variable at sign/verify time).
   v2 signatures additionally bind the destination directory, so an approval
   cannot be replayed into a different project.
5. **`approve-world-spec-hash.js`** / **`check-world-spec-approval.js`** —
   write and check exact-hash approval manifest entries; the checker
   dispatches signature verification to `approval-sign.js` and never
   re-implements the crypto.
6. **`preflight-worldforge-import.js`** / **`import-approved-world-spec.js`**
   / **`launch-worldforge-render.js`** — the fail-closed chain that lands
   approved bytes at `<ProjectDir>/world-spec.json` and stages (or, with
   `--launch`, executes) the renderer launch command.

## Safety detectors (for a renderer you bring)

These tools assume a renderer that reads a `world-spec/1.0` file and
materializes it into a live, observable scene, and they gate *changes* to
that pipeline against reclassification: an edit that changes what an
observer perceives should never pass review just because its prose calls it
"copyediting" or "cleanup."

- **`reachability-diff.js`** — computes the reachability/passability graph
  delta between an approved and a proposed spec and trips on any reduction,
  disconnection, or one-way funnel — decided from geometry, never from
  proposal prose.
- **`field-consumption.js`** — classifies a diff's changed field paths
  against a manifest of which fields a renderer actually reads and presents
  (`field-consumption-manifest.example.json` is a worked example; regenerate
  your own from your renderer). An unmapped field fails closed.
- **`four-power-ledger.js`** — a capability-acquisition tripwire over four
  "powers" a renderer/pipeline can hold over an observer (existence,
  continuity, perception, freedom): any diff that adds a *new* writer to one
  of these powers halts for review; removing or narrowing a writer is always
  fine.
- **`verifier-hash-pin.js`** — hash-pins your own safety-critical verifier
  scripts and enforces that a verifier's report enumerates every required
  check section; a drifted/tampered verifier's output is refused outright.

`*.example.json` files are worked examples, not live configuration — a real
deployment should regenerate or author its own manifests/ledgers from its
own renderer and pipeline.

## Tests

Every module has a matching test in `__tests__/`, runnable individually or
as a whole:

```
node --test __tests__/*.test.cjs
```
