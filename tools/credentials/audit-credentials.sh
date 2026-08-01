#!/usr/bin/env bash
# Thin wrapper. Real logic in audit_credentials.py.
set -euo pipefail
exec python3 "$(dirname "$0")/audit_credentials.py" "$@"
