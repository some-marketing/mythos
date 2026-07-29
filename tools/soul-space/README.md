# soul-space

A content-addressed identity/provenance validator: a schema plus a small
amount of logic JSON Schema alone can't express — content-hash
recomputation and immutability, hash-binding between a record and anything
that claims to derive from it, a version history that must be
provenance-backed, and rejection of self-claimed verification.

## What's here

- `schema/subject-record.schema.json` — shape of the core record: a
  `subject_id`, a freeform `attributes` object (the extension point for
  your own domain vocabulary), a `version`, a `content_hash`, and a
  `provenance_chain`.
- `schema/binding.schema.json` — shape of a derived document that claims to
  bind to a subject-record by content hash (a view, a copy, a reference —
  `kind` is a domain-defined label).
- `validate-soul-space.js` — the validator. Recomputes `content_hash` over
  every field except `content_hash`/`provenance_chain` themselves and
  rejects a mismatch; checks a binding's `bound_hash` against the record's
  current recomputed hash; requires every `version` to have a matching
  `provenance_chain` entry; and, when a record carries an `attestation`,
  requires a `verifier_provenance` whose `verifier_id` differs from the
  record's own `subject_id` (a subject cannot attest its own record).
- `generate-blank-seed.js` — generates a blank example subject-record (no
  pre-loaded `attributes`, no `attestation`) as a starting point.
- `example/` — a worked example: one valid record, one valid binding, and
  one rejected self-verification case.

## Usage

```
node validate-soul-space.js <subject-record.json> [binding.json]
node generate-blank-seed.js <subject_id> [authored_by]
```

Exits 0 if valid, 1 if not, and prints a JSON report of per-invariant
errors either way.

## The pattern, not the vocabulary

The mechanism here — content-addressed immutability, hash-bound
derivations, a provenance chain that must justify every version bump, and
non-self-verification — is domain-agnostic. `attributes` on the
subject-record and binding is deliberately freeform: a concrete deployment
defines its own required fields there without touching the validator or
the invariant logic.
