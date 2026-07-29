#!/usr/bin/env bash
# DEPRECATED — kept as a thin shim that delegates to the multi-provider
# resolver. Hard-coded "1Password only" logic is gone; the new resolver respects
# the operator's preference from ~/.Mythos/credentials.config.json and tries
# Keychain, 1Password, env-file in order (or operator-configured order).
#
# New canonical invocation:
#   python3 tools/credentials/seed_env_from_resolver.py --set google-ads
set -euo pipefail
exec python3 "$(dirname "$0")/seed_env_from_resolver.py" --set google-ads "$@"
