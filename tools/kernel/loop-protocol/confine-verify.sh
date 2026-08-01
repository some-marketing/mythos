#!/usr/bin/env bash
# confine-verify.sh — falsifiable proof that a restricted loop-runner user CANNOT
# write the operator-owned canonical surfaces. Run this AS the loop-runner user:
#
#   sudo -u smos-loop bash tools/kernel/loop-protocol/confine-verify.sh
#
# It ATTEMPTS the four exploit classes against the real repo and asserts every one
# is denied by the OS. It is non-destructive: it only tries to CREATE probe files
# (removed if they ever succeed) and tries a rm that fails atomically on an
# unwritable dir. If any attempt SUCCEEDS, confinement is broken and it says so.
set -uo pipefail

REPO="${1:-{MYTHOS_ROOT}}"
WHO="$(whoami)"
PROBE=".confine-probe-$$"
FAILS=0   # count of exploits that WRONGLY succeeded (i.e. confinement holes)

echo "== confine-verify as user: $WHO  against: $REPO =="
[ "$WHO" = "admin" ] && echo "!! WARNING: running as 'admin' (the owner) — this proves nothing. Run via: sudo -u smos-loop bash $0"

# helper: expect an operation to FAIL (be denied). arg1=label, then the command.
expect_denied() {
  local label="$1"; shift
  if "$@" 2>/dev/null; then
    echo "  LEAK   $label -> SUCCEEDED (confinement BROKEN)"
    FAILS=$((FAILS+1))
    return 1
  else
    echo "  ok     $label -> denied"
    return 0
  fi
}

# 1) direct write / create in a protected dir
expect_denied "create in instructions/canonical" touch "$REPO/instructions/canonical/$PROBE"
[ -e "$REPO/instructions/canonical/$PROBE" ] && rm -f "$REPO/instructions/canonical/$PROBE"

# 2) create in a hooks dir (Bash-path escalation surface)
expect_denied "create in tools/kernel/hooks" touch "$REPO/tools/kernel/hooks/$PROBE"
[ -e "$REPO/tools/kernel/hooks/$PROBE" ] && rm -f "$REPO/tools/kernel/hooks/$PROBE"

# 3) SYMLINK traversal: link from a writable /tmp dir into canonical, write THROUGH it.
TMPD="$(mktemp -d 2>/dev/null || echo /tmp/cv$$)"; mkdir -p "$TMPD"
ln -sfn "$REPO/instructions/canonical" "$TMPD/link" 2>/dev/null
expect_denied "write THROUGH symlink to canonical" touch "$TMPD/link/$PROBE"
[ -e "$REPO/instructions/canonical/$PROBE" ] && rm -f "$REPO/instructions/canonical/$PROBE"
rm -rf "$TMPD" 2>/dev/null

# 4) RENAME-HIDE: try to move a governance file OUT of its protected dir (needs write on the source dir)
GOV="$REPO/instructions/canonical/system.yaml"
if [ -e "$GOV" ]; then
  expect_denied "rename-hide a governance file" mv "$GOV" "/tmp/stolen-$$.yaml"
  # if it wrongly moved, put it back
  [ -e "/tmp/stolen-$$.yaml" ] && mv "/tmp/stolen-$$.yaml" "$GOV"
fi

# 5) tamper the manifest itself (the policy) and a guardrails file
expect_denied "overwrite the manifest" bash -c ": > '$REPO/tools/kernel/loop-protocol/protected-path-manifest.json'"

echo
if [ "$FAILS" -eq 0 ]; then
  echo "RESULT: CONFINED ✅  — every exploit was denied by the OS. The loop-runner cannot reach protected surfaces."
  exit 0
else
  echo "RESULT: NOT CONFINED ❌  — $FAILS exploit(s) succeeded. Fix ownership/permissions before running loops as this user."
  exit 1
fi
