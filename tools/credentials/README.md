# tools/credentials/

Pluggable credential resolver that supports any password manager the operator has. Follows the kernel rule [[plan-for-any-ecosystem]] — never hard-code a single vendor.

## What's here

| File | Purpose |
|---|---|
| `audit_credentials.py` | Read-only audit of 1Password + macOS Keychain + env files + repo references. Catalogs credential surfaces; never captures values. |
| `audit-credentials.sh` | Thin wrapper for `audit_credentials.py`. |
| `resolver.py` | Multi-provider resolver. Reads `~/.Mythos/credentials.config.json` for operator preference. |
| `seed_env_from_resolver.py` | Resolves a named set of secrets and writes them to an env file (default `<repo>/.env.local`). |
| `providers/base.py` | `CredentialProvider` ABC. |
| `providers/onepassword.py` | 1Password `op` CLI provider. |
| `providers/keychain.py` | macOS Keychain `security` CLI provider. |
| `providers/env_file.py` | `.env.local` / `.env` / `~/.Mythos/.env` provider. |
| `providers/registry.py` | Provider registration + default fallback order. |
| `seed-google-ads-creds.sh` | **DEPRECATED**. Use `seed_env_from_resolver.py --set google-ads`. |

## Quick start

```bash
# 1. Audit current state (read-only)
bash tools/credentials/audit-credentials.sh

# 2. Configure operator preference (optional — defaults work)
cat > ~/.Mythos/credentials.config.json <<'JSON'
{
  "provider_order": ["keychain", "onepassword", "env_file"],
  "sets": {
    "google-ads": [
      "GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET",
      "GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_REFRESH_TOKEN",
      "GOOGLE_ADS_CUSTOMER_ID", "GOOGLE_ADS_LOGIN_CUSTOMER_ID"
    ]
  }
}
JSON
chmod 0600 ~/.Mythos/credentials.config.json

# 3. Seed env from preferred provider
python3 tools/credentials/seed_env_from_resolver.py --set google-ads

# 4. Resolve ad-hoc
python3 tools/credentials/resolver.py SOME_SECRET_NAME
```

## Adding a new provider

Implement `providers/<name>.py` subclassing `CredentialProvider`. Add to `ALL_PROVIDERS` in `registry.py`. Done — the resolver picks it up automatically.

Stubs documented in `providers/registry.py` for:
- Bitwarden (`bw` CLI)
- Vaultwarden (compatible with `bw`)
- KeePassXC (`keepassxc-cli`)
- GNU pass (Unix password store)
- Apple Passwords (newer macOS, `security` CLI subset)
- LastPass (`lpass`)
- Dashlane (`dcli`)
- AWS Secrets Manager (`aws`)
- GCP Secret Manager (`gcloud`)

## Config schema

```json
{
  "provider_order": ["keychain", "onepassword", "env_file"],
  "sets": {
    "<set-name>": ["SECRET_KEY_1", "SECRET_KEY_2"]
  },
  "secrets": {
    "GOOGLE_ADS_DEVELOPER_TOKEN": {
      "keychain": "GOOGLE_ADS_DEVELOPER_TOKEN",
      "onepassword": {
        "item": "mythos-google-ads-mcp",
        "field": "Developer Token"
      },
      "env_file": "GOOGLE_ADS_DEVELOPER_TOKEN"
    }
  }
}
```

- `provider_order`: which providers to try, in order. Unlisted providers still get tried last in default order.
- `sets`: named groups of secrets for `--set NAME` invocations.
- `secrets[NAME][provider]`: per-secret mapping — explicit item id / field label for that provider. If a secret isn't mapped, the resolver falls back to title-match (try `item_id = secret_name`).

## Trace, no values

The resolver never logs secret values. Trace records:
- `provider`: which provider was tried
- `hit`/`miss`: did it return a value
- `reason`: human-readable why (config mapping, title match, not available, error)
- `served_by` / `served_via`: which provider returned the final value and through what mechanism

Secrets land in the target env file only.

## Related memory rules

- [[plan-for-any-ecosystem]] — kernel rule this package implements
- [[always-build-tools]] — every credential operation is a reusable tool, not a one-off
