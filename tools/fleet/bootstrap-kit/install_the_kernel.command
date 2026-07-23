#!/usr/bin/env bash
# =============================================================================
# PROVENANCE: copied verbatim from thumbdrive /Volumes/BIOS/install_the_kernel.command
# Canonical repo home: tools/fleet/bootstrap-kit/install_the_kernel.command
# Date imported: 2026-06-22
#
# KNOWN BUG (do NOT fix here — gated in a separate step):
#   No equivalent macOS bug; the passphrase pipe via `op read ... | gpg` is
#   correct on bash. The Windows counterpart (install_the_kernel.ps1) has a
#   UTF-16 pipe bug on Windows PowerShell 5 — see that file's header.
#
# Do NOT alter the decrypt/GPG logic below. Changes to executable logic must
# go through the dedicated gated fix step.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUNDLE_NAME="${SMOS_KERNEL_BUNDLE_NAME:-the_kernel.tar.gz.gpg}"
BUNDLE_PATH="${SCRIPT_DIR}/${BUNDLE_NAME}"
CHECKSUM_PATH="${SCRIPT_DIR}/${BUNDLE_NAME}.sha256"
PASSPHRASE_REF="${SMOS_KERNEL_PASSPHRASE_REF:-op://Personal/the_kernel/password}"
DEFAULT_SMOS_PATH="${SMOS_KERNEL_TARGET:-/Users/admin/Documents/GitHub/SM_OS}"
WORK_DIR=""

cleanup() {
  if [[ -n "${WORK_DIR}" && -d "${WORK_DIR}" ]]; then
    rm -rf "${WORK_DIR}"
  fi
}
trap cleanup EXIT

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

printf '\nSM_OS Kernel Installer\n'
printf '======================\n\n'
printf 'This installs the encrypted SM_OS kernel bundle onto this machine.\n'
printf 'This shell installer is for macOS/Linux. On Windows, use install_the_kernel.ps1.\n'
printf 'It will not store the passphrase on this flash drive.\n\n'

[[ -f "${BUNDLE_PATH}" ]] || fail "Encrypted bundle not found: ${BUNDLE_PATH}"
[[ -f "${CHECKSUM_PATH}" ]] || fail "Checksum file not found: ${CHECKSUM_PATH}"

require_command shasum
require_command gpg
require_command tar
require_command rsync
require_command op

printf 'Bundle:   %s\n' "${BUNDLE_PATH}"
printf 'Checksum: %s\n' "${CHECKSUM_PATH}"
printf 'Password: %s\n\n' "${PASSPHRASE_REF}"

read -r -p "Install the SM_OS kernel on this machine? [y/N] " CONFIRM
case "${CONFIRM}" in
  y|Y|yes|YES) ;;
  *) printf 'Install cancelled.\n'; exit 0 ;;
esac

if ! op whoami >/dev/null 2>&1; then
  fail "1Password CLI is not signed in. This installer needs the 1Password desktop app installed, signed in, and configured for CLI integration. It needs your 1Password account login for my.1password.com, not your Mac password and not a flash-drive password. Run 'eval \$(op signin --force)' in Terminal, confirm 'op whoami' works, then run this installer again."
fi

EXPECTED_HASH="$(awk '{print $1; exit}' "${CHECKSUM_PATH}")"
ACTUAL_HASH="$(shasum -a 256 "${BUNDLE_PATH}" | awk '{print $1; exit}')"
if [[ -z "${EXPECTED_HASH}" || "${EXPECTED_HASH}" != "${ACTUAL_HASH}" ]]; then
  fail "Checksum verification failed."
fi
printf 'Checksum verification passed.\n\n'

read -r -p "SM_OS repo path [${DEFAULT_SMOS_PATH}]: " TARGET_SMOS
TARGET_SMOS="${TARGET_SMOS:-${DEFAULT_SMOS_PATH}}"
TARGET_SMOS="${TARGET_SMOS%/}"

[[ -d "${TARGET_SMOS}" ]] || fail "Target SM_OS directory does not exist: ${TARGET_SMOS}"

DEFAULT_MEMORY_PATH="${HOME}/.claude/projects/-Users-admin-Documents-GitHub-SM-OS/memory/MEMORY.md"
read -r -p "Claude memory file path [${DEFAULT_MEMORY_PATH}]: " TARGET_MEMORY
TARGET_MEMORY="${TARGET_MEMORY:-${DEFAULT_MEMORY_PATH}}"

printf '\nInstall target:\n'
printf '- Kernel directory: %s/_dev/research/taylor-philosophy/\n' "${TARGET_SMOS}"
printf '- Memory file:      %s\n\n' "${TARGET_MEMORY}"

read -r -p "Proceed with install to these paths? [y/N] " FINAL_CONFIRM
case "${FINAL_CONFIRM}" in
  y|Y|yes|YES) ;;
  *) printf 'Install cancelled.\n'; exit 0 ;;
esac

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/smos-kernel-install.XXXXXX")"
ARCHIVE_PATH="${WORK_DIR}/the_kernel.tar.gz"
EXTRACT_DIR="${WORK_DIR}/extract"
mkdir -p "${EXTRACT_DIR}"

op read "${PASSPHRASE_REF}" | \
  gpg --batch --yes --pinentry-mode loopback \
    --passphrase-fd 0 \
    --decrypt \
    --output "${ARCHIVE_PATH}" \
    "${BUNDLE_PATH}"

tar -xzf "${ARCHIVE_PATH}" -C "${EXTRACT_DIR}"

[[ -d "${EXTRACT_DIR}/SM_OS/_dev/research/taylor-philosophy" ]] || \
  fail "Extracted bundle is missing SM_OS/_dev/research/taylor-philosophy"
[[ -f "${EXTRACT_DIR}/claude-memory/MEMORY.md" ]] || \
  fail "Extracted bundle is missing claude-memory/MEMORY.md"

mkdir -p "${TARGET_SMOS}/_dev/research"
rsync -a \
  "${EXTRACT_DIR}/SM_OS/_dev/research/taylor-philosophy/" \
  "${TARGET_SMOS}/_dev/research/taylor-philosophy/"

mkdir -p "$(dirname "${TARGET_MEMORY}")"
rsync -a "${EXTRACT_DIR}/claude-memory/MEMORY.md" "${TARGET_MEMORY}"

printf '\nInstall complete.\n'
printf 'Plaintext temporary files were removed from the temp directory.\n'
printf 'You can now start an SM_OS session from: %s\n' "${TARGET_SMOS}"
