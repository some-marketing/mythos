# Custody grants — an ownership-ledger pattern

## The problem

When more than one bounded worker (a subagent, a background job, a second
session) can touch the same repository, you need a way to answer one
question cheaply and mechanically: *is this actor currently allowed to
write to this path?*

A convention ("only the owning agent edits its own files") is not
enforceable — it is just an expectation. A **custody ledger** makes it
enforceable: write-custody over a scope (a file, a directory, an artifact)
is recorded as data, and anything that wants to mutate that scope can be
checked against the ledger before the write happens, not after.

## The pattern

1. **Default-deny.** Absent a grant, a worker only has custody over paths
   it created or was explicitly assigned in its own task scope. Writing
   outside that scope is blocked by default.
2. **Grants are explicit and scoped.** An operator (or a coordinator acting
   with operator authority) can issue a grant: "session `X` may write to
   path `P`, because `reason`." The grant is a small JSON record, not a
   standing permission — see `mythos-custody-grant.js` for the shape:

   ```json
   {
     "schema": "CustodyGrant/1.0",
     "path": "tools/some-file.js",
     "to_session": "session-abc",
     "reason": "test run",
     "granted_at": "2026-07-22T00:00:00.000Z",
     "granted_by": "operator",
     "consumed": false,
     "consumed_at": null
   }
   ```

3. **Grants are content-addressed.** The grant file's name is
   `sha256(path:session)` — this makes "does a grant exist for this exact
   path+session pair" an O(1) filesystem lookup for a gate, with no index
   to maintain and no risk of a stale grant silently matching the wrong
   session.
4. **Grants are one-use.** The gate that *checks* a grant (not shipped in
   this scaffold — see below) is expected to flip `consumed` to `true` the
   first time it allows a write under that grant. A second write attempt
   under the same grant is then blocked again: the grant authorized one
   crossing of the boundary, not standing access.
5. **Revocation is deletion.** Because a grant is just a file, revoking it
   before it's consumed is as simple as removing the file (or an operator
   tool could add a `revoked: true` flag and check for it) — there is no
   separate revocation-list to keep in sync.

## What's shipped here

`mythos-custody-grant.js` is the write-side of the pattern: a small CLI
and library that issues a grant.

```
node mythos-custody-grant.js <path> --to-session <session_id> [--reason "..."]
```

It resolves `<path>` to a path relative to a repo root (rejecting any path
that escapes that root), hashes `path:session` into a filename, and writes
the grant record to `_dev/state/custody-gate/grants/<hash>.json`.

`__tests__/mythos-custody-grant.test.cjs` exercises the grant shape, hash
stability/sensitivity, overwrite idempotency, and the repo-root escape
check.

## What's deliberately not shipped

The *read side* — a hook that intercepts a write attempt, computes the
same hash, checks `consumed`, applies the grant if found, and flips
`consumed` to `true` — lives in this codebase's private hook machinery
(coupled to session-log format, harness-specific tool-call interception,
and other private surfaces) and is out of scope for this export target.
The pattern above is what to reimplement against your own harness's
pre-write hook point; the grant-writer here is a complete, working
reference for the write side.
