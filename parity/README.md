# Portable parity contract

`baseline.json` pins the source commit, export-map digest, unit digests, target file digests, wiring counts, registered overlays, and prohibited surfaces. Run `npm run verify:parity` without access to the private source repository.

Maintainers with the pinned source checkout can also run:

```sh
npm run verify:parity:source -- /path/to/pinned/source
```

Changing the baseline requires a reviewed `mythos-full-parity-port` plan amendment. Host activation is separate from repository parity: populate ignored `host-bindings.local.json`, review `host-activation.json`, and obtain operator approval before any install action.

Generate a reconciliation ledger from complete source-export, target-base, and
target-current directory inventories with `npm run parity:ledger:generate --`.
The decisions document supplies explicit dispositions for every non-identical
path. Generation blocks on uncovered paths, duplicate decisions, or decisions
that name files outside the inventories. Generated ledgers carry a deterministic
coverage digest. Portable CI runs `verify:parity` plus the parity test suites;
it does not claim to reproduce the private three-root ledger audit.

Baseline regeneration also requires `--private-denylist <path>` so the shipped
baseline binds hashes of the authoritative private contamination vocabulary
without publishing its plaintext terms. The verifier rejects a baseline that
lacks that private-denylist binding and scans the excluded reconciliation
ledger as a security evidence artifact. Ratification review must run
`verify-parity.cjs` with both `--require-private-denylist` and
`--private-denylist <path>`; this recomputes the binding and applies regex-only
private rules without serializing them into the public baseline.
Version 4 exhaustive ledgers must be checked with `--source-export-root`,
`--target-base-root`, and `--target-current-root`; verification re-inventories
all three roots and rejects any path, byte, mode, or inventory-digest drift.
Run the operator-ratified audit with all three authoritative roots:

```sh
npm run verify:parity:ledger -- --require-operator \
  --source-export-root /path/to/source-export \
  --target-base-root /path/to/target-base \
  --target-current-root /path/to/target-current
```
