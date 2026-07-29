# Setting up `tools/backup`

`tools/backup` is an age-encrypted, rclone-shipped backup pipeline: encrypt
locally with [age](https://github.com/FiloSottile/age), upload the ciphertext
to any rclone-compatible cloud remote (the scripts were built against
[Internxt](https://internxt.com), but nothing here depends on Internxt-specific
storage — any remote `rclone config` can talk to works), then optionally
migrate to a new key later without ever putting plaintext or a private key on
the wire.

## DESTRUCTIVE — read this first

Several scripts in this directory upload, delete, or re-encrypt real remote
data:

- `internxt-full-cold.sh`, `internxt-mind-delta.sh`, `internxt-mind-full.sh` —
  upload an encrypted archive and delete the local temp copy. Support
  `--dry-run`; use it first.
- `internxt-prune.sh` — **permanently deletes** remote objects older than a
  retention window. Support `--dry-run`; use it first, read the output.
- `rotate-age-key.cjs` — re-encrypts and **permanently deletes** old-key
  ciphertext on the remote. Without `--execute` it only prints a plan (no
  network calls at all). `--execute` is the destructive path — treat it as
  something a human explicitly signs off on, every time, after reading the
  dry-run output.
- `internxt-restore.sh` — not destructive to the remote, but it writes
  **decrypted plaintext** to disk at the restore destination. Treat that
  output directory as sensitive for as long as it exists.

These scripts also assume macOS (they shell out to `security` for Keychain
access). Porting to Linux would mean swapping the Keychain calls for another
secret store.

## 1. Generate your own age keypair

```
age-keygen -o age-key.txt
```

This writes a private identity (`AGE-SECRET-KEY-1...`) to `age-key.txt` and
prints the matching public recipient (`age1...`) to stderr. Keep `age-key.txt`
out of version control — see step 3.

Replace the placeholder line in `age-recipient-v2.pub` with your own `age1...`
recipient. That file is meant to be tracked in git: age recipients are public
keys, safe to share by design. Only the matching private identity must stay
secret.

## 2. Configure your rclone remote

```
rclone config
```

Set up a remote for your Internxt account (or any other rclone-compatible
provider). Note the remote's name — you'll point these scripts at it via
`INTERNXT_REMOTE_NAME` (see below). If you're using Internxt specifically,
its CLI manages its own login state (`internxt login`) separately from this
repo's credential resolver — that's out of scope here; `rotate-age-key.cjs`
only checks `internxt whoami` before running and otherwise assumes you're
already authenticated with whatever CLI your remote needs (only relevant if
you use `rotate-age-key.cjs`, which drives the Internxt CLI directly for
uuid-based operations the plain rclone backend can't do safely).

## 3. Store your age private key in macOS Keychain

Never commit `age-key.txt`. Store it once, headless-friendly forever after:

```
tools/boot/keychain-store.sh backup-age-key-v2 backup-tool
```

(or your own service/account names — see `AGE_KEYCHAIN_SERVICE` /
`AGE_KEYCHAIN_ACCOUNT` below). Paste the full contents of `age-key.txt` when
prompted; it is read via `read -s` and never echoed.

## 4. This tool's fields

See `creds.config.json` for the authoritative field list. None of these are
secrets in the credential-resolver sense — they're configuration knobs the
scripts read as plain environment variables (with documented defaults),
except the age private key, which lives in Keychain only (there is no
env/1Password/env-file fallback for it — the scripts are deliberately
Keychain-only for the private key so it never ends up in shell history,
`.env` files, or process listings).

| Variable | Default | Used by |
|---|---|---|
| `INTERNXT_REMOTE_NAME` | `myremote` | all `internxt-*.sh` scripts |
| `BACKUP_BUCKET_PREFIX` | `backups` | all `internxt-*.sh` scripts |
| `BACKUP_SOURCE_DIR` | `backup-source` | `internxt-mind-delta.sh`, `internxt-mind-full.sh` |
| `AGE_KEYCHAIN_ACCOUNT` | `backup-tool` | `internxt-restore.sh`, `rotate-age-key.cjs` |
| `AGE_KEYCHAIN_SERVICE` | `backup-age-key-v2` | `internxt-restore.sh`, `rotate-age-key.cjs` |

Run this if you change `creds.config.json` and want `env.example` regenerated:

```
node tools/lib/generate-env-example.cjs tools/backup/creds.config.json --out tools/backup/env.example
```

## 5. Verify

```
tools/backup/internxt-mind-delta.sh --dry-run
```

A successful dry-run prints the resolved remote, source directory, and
recipient, and confirms no network calls or uploads happened. It should never
print your private key or any secret value.

For the rotation helper:

```
node tools/backup/rotate-age-key.cjs --inventory <your-inventory.json>
```

(no `--execute`) — strict dry-run: prints the per-object migration plan, makes
no network calls, writes no ledger. Run the test suite to confirm the helper's
core logic (SIGINT-safe vaporizing workspace, retry classification, plan
decision logic, single-instance lock) behaves correctly on your machine:

```
node tools/backup/__tests__/rotate-age-key.test.cjs
```

## What this pipeline assumes about "your own backup contents"

`replication-allowlist.json` in this directory is an **illustrative example**,
not a config any script here reads. It shows a pattern for gating what may
additionally leave the machine toward a less-controlled destination (a synced
docs folder, a notes app, etc.) on top of the age-encrypted backups the
`internxt-*.sh` scripts already produce. Adapt its include/exclude globs to
your own project, or delete it if you don't need that second gate.
