# Setting up `tools/security` (ElevenLabs keys + vault hygiene)

This directory holds two manifest-driven, "bring your own 1Password vault"
tools. Both operate on 1Password **metadata** (item titles, vault names,
scopes) and emit or run tightly allow-listed `op` commands -- neither tool
ever puts a raw secret value into an argv, a log line, or a committed file.

## Why these tools don't go through `tools/lib/resolve-credential.cjs`

`resolve-credential.cjs` is for a tool that needs to *read one secret* to do
its job (an API key, a token). These tools' job **is** managing 1Password
itself -- provisioning ElevenLabs keys into it, auditing vault placement,
moving items between vaults. That's a level below "read a credential," so
they talk to the `op` CLI directly, each behind its own strict subcommand
allow-list (see `ALLOWED_OP_PREFIXES` / `FORBIDDEN_OP_TOKENS` /
`FORBIDDEN_READ_TOKENS` in each tool's `lib.cjs`) rather than through the
shared resolver.

The one piece of bootstrapping these tools share with the rest of the repo:
**how `op` itself authenticates in a headless/CI shell.** That's the same
`OP_SERVICE_ACCOUNT_TOKEN` convention `tools/lib/resolve-credential.cjs`
already uses for its own 1Password source -- see `creds.config.json` /
`env.example` in this directory. If you already have `op` signed in
interactively, you don't need this at all.

## Prerequisites (both tools)

1. Install the 1Password CLI (`op`) and either:
   - run `op signin` in the shell you'll use these tools from, or
   - export `OP_SERVICE_ACCOUNT_TOKEN` (a service account scoped to your
     `Automation` vault is strongly recommended -- see `tools/security/vault-hygiene`
     below for why identity scope matters).
2. Have (or create) a 1Password vault to hold automation credentials. These
   tools default to a vault named `Automation`; override with `--vault` /
   the manifest's `vault` field where each tool supports it.

## `elevenlabs-keys/` -- ElevenLabs workload-key provisioning

Manifest-driven "one key per trust boundary" pattern for ElevenLabs API keys.
Key **creation** is a human dashboard action (requires admin scope) -- this
tool operates on already-created raw keys: storing them safely into 1Password
and validating their live scopes.

1. Read `tools/security/elevenlabs-keys/elevenlabs-key-manifest.yaml` and
   adapt the profiles to your own ElevenLabs workspace's actual workload
   boundaries (narration, transcription, voice-identity management,
   conversational agent, etc.). Keep the shape; change the profile names,
   `vault_path`s, and scope lists to match your real workloads.
2. Validate the manifest against its own security invariants (no admin
   scopes on a workload key, isolated capabilities stay isolated, etc.):
   ```sh
   node tools/security/elevenlabs-keys/provision-key.js check-manifest
   ```
3. Mint the real key in the ElevenLabs dashboard for a `provisioned` profile,
   then store it (read only from stdin, never argv):
   ```sh
   node tools/security/elevenlabs-keys/provision-key.js store --profile <profile-name>
   ```
   If `op` is not authenticated, this prints the exact command to run once it
   is -- it never reads or stores anything in that case.
4. Optionally validate a stored key's live scopes against the profile:
   ```sh
   node tools/security/elevenlabs-keys/provision-key.js validate --profile <profile-name> [--deep]
   ```
5. Emit the profile -> vault-path map for app config to consume (no secrets):
   ```sh
   node tools/security/elevenlabs-keys/provision-key.js map --out <path>
   ```

See `tools/security/elevenlabs-key-manager/design.md` for the design
rationale carried forward from an earlier (superseded) iteration of this
tool -- read-only, no direct `op` integration. It's kept for context, not for
use.

## `vault-hygiene/` -- 1Password vault-boundary enforcement

Enforces that automation credentials live in one scoped vault (default
`Automation`) and that operator-only trust anchors never do.

1. Read `tools/security/vault-hygiene/vault-manifest.json` and replace every
   entry with your own vault's real item titles, derived from `op://`
   references in your own codebase. **Verify every title against live
   1Password before running `--apply`** -- a wrong title is a silent no-op
   or a wrong move.
2. Audit the current boundary (dry, metadata-only):
   ```sh
   node tools/security/vault-hygiene/check-vault-boundary.js
   ```
   This checks: (A) every class-1 item resolves in `Automation`, (B) no
   class-2 trust anchor is present in `Automation`, (C) if
   `OP_SERVICE_ACCOUNT_TOKEN` is set, the automation identity sees ONLY
   `Automation`, (D) code references point at the right vault.
3. Preview the moves (dry-run by default, nothing moves without `--apply`):
   ```sh
   node tools/security/vault-hygiene/move-to-automation.js
   ```
4. Once you've reviewed the plan, actually perform it:
   ```sh
   node tools/security/vault-hygiene/move-to-automation.js --apply
   ```

## Verify

```sh
node --test tools/security/elevenlabs-keys/__tests__/*.test.cjs
node --test tools/security/vault-hygiene/__tests__/*.test.cjs
```

Both suites run fully offline against fake `op`/HTTP adapters -- no real
1Password, no real ElevenLabs, no network. A clean run confirms the tools'
logic is intact before you point them at your real vault/workspace.
