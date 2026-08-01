#!/usr/bin/env bash
#
# Stabilize the macOS identity used for the local Node runtime.
#
# Why: Homebrew Node is often ad-hoc signed with an identifier that changes
# across upgrades. macOS privacy prompts can then treat each Node binary as a
# new app. This script signs the current Node binary with a stable identifier
# and can add it to the Application Firewall allow list when the firewall is on.
#
# Usage:
#   tools/local/macos-approve-node.sh            # report only
#   tools/local/macos-approve-node.sh --create-identity
#   tools/local/macos-approve-node.sh --apply --identity "Mythos Local Code Signing"
#   tools/local/macos-approve-node.sh --apply --firewall
#
# Notes:
# - A real code-signing identity is required for durable macOS identity.
# - Local Network privacy still requires one manual approval in System Settings.
# - Re-run this after `brew upgrade node`, because Homebrew replaces the binary.

set -euo pipefail

APPLY=0
FIREWALL=0
CREATE_IDENTITY=0
IDENTIFIER="${MYTHOS_NODE_CODESIGN_IDENTIFIER:-dev.mythos.local.node}"
IDENTITY="${MYTHOS_NODE_CODESIGN_IDENTITY:-Mythos Local Code Signing}"
KEYCHAIN="${MYTHOS_NODE_CODESIGN_KEYCHAIN:-${HOME}/Library/Keychains/login.keychain-db}"

usage() {
  sed -n '3,22p' "$0"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply)
      APPLY=1
      ;;
    --create-identity)
      CREATE_IDENTITY=1
      ;;
    --firewall)
      FIREWALL=1
      ;;
    --identifier)
      shift
      IDENTIFIER="${1:?missing value for --identifier}"
      ;;
    --identity)
      shift
      IDENTITY="${1:?missing value for --identity}"
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if ! command -v node >/dev/null 2>&1; then
  echo "node was not found on PATH" >&2
  exit 1
fi

NODE_PATH="$(node -p 'process.execPath')"
SOCKETFILTERFW="/usr/libexec/ApplicationFirewall/socketfilterfw"

echo "Node executable: ${NODE_PATH}"
echo "Target identifier: ${IDENTIFIER}"
echo "Signing identity: ${IDENTITY}"
echo "Keychain: ${KEYCHAIN}"
echo

echo "Current codesign state:"
codesign -dv "${NODE_PATH}" 2>&1 || true
echo

echo "Available code-signing identities:"
security find-identity -v -p codesigning || true
echo

create_identity() {
  if security find-identity -v -p codesigning | grep -Fq "\"${IDENTITY}\""; then
    echo "Code-signing identity already exists: ${IDENTITY}"
    return 0
  fi

  if ! command -v openssl >/dev/null 2>&1; then
    echo "openssl was not found on PATH" >&2
    return 1
  fi

  local workdir
  workdir="$(mktemp -d "${TMPDIR:-/tmp}/smos-node-codesign.XXXXXX")"
  MYTHOS_CODESIGN_WORKDIR="${workdir}"
  trap 'rm -rf "${MYTHOS_CODESIGN_WORKDIR:-}"' EXIT
  local p12_password
  p12_password="$(openssl rand -hex 24)"

  cat >"${workdir}/openssl.cnf" <<EOF
[ req ]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_codesign

[ dn ]
CN = ${IDENTITY}
O = Some Marketing
OU = Mythos Local Runtime

[ v3_codesign ]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
EOF

  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "${workdir}/codesign.key" \
    -out "${workdir}/codesign.crt" \
    -days 3650 \
    -config "${workdir}/openssl.cnf"

  openssl pkcs12 -export \
    -legacy \
    -inkey "${workdir}/codesign.key" \
    -in "${workdir}/codesign.crt" \
    -name "${IDENTITY}" \
    -out "${workdir}/codesign.p12" \
    -passout "pass:${p12_password}"

  security import "${workdir}/codesign.p12" \
    -k "${KEYCHAIN}" \
    -P "${p12_password}" \
    -A \
    -T /usr/bin/codesign

  security add-trusted-cert \
    -d \
    -r trustRoot \
    -p codeSign \
    -k "${KEYCHAIN}" \
    "${workdir}/codesign.crt"

  echo
  echo "Identity created. Updated identities:"
  security find-identity -v -p codesigning
}

if [ "${CREATE_IDENTITY}" -eq 1 ]; then
  create_identity
  echo
fi

if [ "${APPLY}" -ne 1 ]; then
  echo "Report-only. Re-run with --apply to sign the current Node binary."
  echo "After signing, approve Node once under System Settings > Privacy & Security > Local Network if macOS prompts again."
  exit 0
fi

if [ -z "${IDENTITY}" ] || [ "${IDENTITY}" = "-" ] || ! security find-identity -v -p codesigning | grep -Fq "\"${IDENTITY}\""; then
  cat >&2 <<EOF
Refusing to apply without a real code-signing identity named:
  ${IDENTITY}

Ad-hoc signing identifies one exact code instance, which is the unstable state
we are trying to get away from.

Then run:
  tools/local/macos-approve-node.sh --create-identity
  tools/local/macos-approve-node.sh --apply
EOF
  exit 1
fi

echo "Signing Node with stable identifier..."
codesign --force --sign "${IDENTITY}" -i "${IDENTIFIER}" --timestamp=none "${NODE_PATH}"
echo "Signed."
echo

echo "Updated codesign state:"
codesign -dv "${NODE_PATH}" 2>&1 || true
echo

if [ "${FIREWALL}" -eq 1 ]; then
  if [ ! -x "${SOCKETFILTERFW}" ]; then
    echo "Application Firewall tool not found at ${SOCKETFILTERFW}; skipping firewall allow list." >&2
  else
    FIREWALL_STATE="$("${SOCKETFILTERFW}" --getglobalstate 2>&1 || true)"
    echo "${FIREWALL_STATE}"
    if echo "${FIREWALL_STATE}" | grep -q "State = 0"; then
      echo "Application Firewall is disabled; no firewall allow-list change needed."
    else
      echo "Adding Node to Application Firewall allow list..."
      "${SOCKETFILTERFW}" --add "${NODE_PATH}"
      "${SOCKETFILTERFW}" --unblockapp "${NODE_PATH}"
      echo "Firewall allow-list updated."
    fi
  fi
fi

cat <<EOF

Next manual step:
  Open System Settings > Privacy & Security > Local Network.
  Ensure the app that launches Node is enabled. Depending on launch path, this
  may appear as Node, Terminal, iTerm, Cursor, Codex, or the launcher app.

Important:
  Re-run this script after Homebrew replaces Node, for example after:
    brew upgrade node
EOF
