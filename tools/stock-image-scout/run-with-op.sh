#!/usr/bin/env bash
# Resolves the Depositphotos Partner API credentials via the shared
# tools/lib/resolve-credential.cjs 4-source chain (env -> macOS Keychain ->
# 1Password -> env-file) and execs the inner command with them set in the
# child process env only. Credential bytes never appear in argv, in this
# script's stdout, or in any persistent file.
#
# This is a thin delegating wrapper, not a second credential-resolution
# implementation — the field list (env var names, Keychain service/account,
# 1Password vault/item/field) lives in creds.config.json next to this script
# and is the single source of truth. See SETUP.md for the full setup story.
#
# Usage:
#   tools/stock-image-scout/run-with-op.sh node tools/stock-image-scout/download.cjs \
#     --manifest <path-to-approved-images-manifest.json> \
#     --dest <output-dir> \
#     --limit 1
#
# One-time prerequisite: DP_API_KEY / DP_LOGIN_USER / DP_LOGIN_PASSWORD must
# be resolvable via one of the four sources in creds.config.json. The
# operator owns provisioning them (Depositphotos API key from
# https://depositphotos.com/api-program.html, plus the All-In-One account's
# own login/password) — this script never mints or prompts for credentials.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CREDS_CONFIG="${DIR}/creds.config.json"
RESOLVER="${DIR}/../lib/resolve-credential.cjs"

if [[ ! -f "${CREDS_CONFIG}" ]]; then
  echo "[run-with-op] Missing ${CREDS_CONFIG}" >&2
  exit 1
fi

if [[ ! -f "${RESOLVER}" ]]; then
  echo "[run-with-op] Missing shared resolver at ${RESOLVER}" >&2
  exit 1
fi

EXPORT_LINES="$(node -e '
  const { resolveCredentialsFromFile, CredentialError } = require(process.argv[1]);
  try {
    const creds = resolveCredentialsFromFile(process.argv[2]);
    for (const [key, value] of Object.entries(creds)) {
      process.stdout.write(`export ${key}=${JSON.stringify(String(value))}\n`);
    }
  } catch (err) {
    if (err instanceof CredentialError) {
      process.stderr.write(`[run-with-op] ${err.message}\n`);
    } else {
      process.stderr.write(`[run-with-op] ${err.stack || err.message}\n`);
    }
    process.exit(1);
  }
' "${RESOLVER}" "${CREDS_CONFIG}")"

eval "${EXPORT_LINES}"

exec "$@"
