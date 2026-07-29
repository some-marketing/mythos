#!/usr/bin/env bash
# Falsifiable smoke test for tools/memory/write-canonical-entry.js
# Tests:
#   a) happy path — entry exists with expected content_hash, ledger has matching create event
#   b) canonical-unreachable — entries dir missing/blocked -> CANONICAL_UNREACHABLE, no writes
#   c) blocked ledger -> entry unlinked, no orphan
# Exits non-zero on any failure.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

WRITER="node tools/memory/write-canonical-entry.js"
ENTRIES_DIR="_dev/state/kernel-memory/entries"
LEDGER="_dev/state/memory-ledger.jsonl"

PASS=0
FAIL=0

ok()   { echo "  ok   $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL $1"; FAIL=$((FAIL+1)); }

# --- a) Happy path ------------------------------------------------------------
echo "[a] happy path"
TEST_BODY="canonical-writer-smoke-test body @ $(date -u +%FT%TZ)"
RECEIPT=$($WRITER \
  --type feedback \
  --title "smoke-test-entry" \
  --anchor-ref "concept:topological-sovereignty-memory" \
  --source-artifact "test:smoke-$(date -u +%FT%TZ)" \
  --body "$TEST_BODY" \
  --tags "smoke,test" \
  --actor claude 2>&1)
RC=$?
if [ $RC -ne 0 ]; then
  bad "writer exited $RC: $RECEIPT"
else
  ok "writer exit 0"
fi
ENTRY_ID=$(echo "$RECEIPT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d.trim().split('\n').pop()).id)}catch(e){process.exit(1)}})" <<< "$RECEIPT")
if [ -z "$ENTRY_ID" ]; then
  bad "could not parse receipt id"
else
  ok "receipt parsed: $ENTRY_ID"
fi
ENTRY_PATH="$ENTRIES_DIR/$ENTRY_ID.json"
if [ -f "$ENTRY_PATH" ]; then
  ok "entry file exists"
else
  bad "entry file missing: $ENTRY_PATH"
fi
EXPECTED_HASH=$(printf '%s' "$TEST_BODY" | shasum -a 256 | awk '{print $1}')
ACTUAL_HASH=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$ENTRY_PATH','utf8')).content_hash)")
if [ "$EXPECTED_HASH" = "$ACTUAL_HASH" ]; then
  ok "content_hash matches sha256(body)"
else
  bad "content_hash mismatch: expected $EXPECTED_HASH got $ACTUAL_HASH"
fi
if tail -5 "$LEDGER" | grep -q "$ENTRY_ID"; then
  ok "ledger has create event referencing entry id"
else
  bad "ledger missing entry id reference"
fi
LEDGER_EVENT_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$ENTRY_PATH','utf8')).ledger_event_id || '')")
if [ -n "$LEDGER_EVENT_ID" ]; then
  ok "entry has ledger_event_id receipt: $LEDGER_EVENT_ID"
else
  bad "entry missing ledger_event_id receipt"
fi
# Clean up
rm -f "$ENTRY_PATH"
# Trim ledger of test row to keep substrate clean
node -e "
const fs=require('fs');const p='$LEDGER';
const lines=fs.readFileSync(p,'utf8').split('\n').filter(l=>l && !l.includes('$ENTRY_ID'));
fs.writeFileSync(p,lines.join('\n')+'\n');
"

# --- b) Canonical unreachable -------------------------------------------------
echo "[b] canonical unreachable"
TMPDIR_BAK=$(mktemp -d)
mv "$ENTRIES_DIR" "$TMPDIR_BAK/entries"
set +e
OUT=$($WRITER \
  --type feedback \
  --title "should-not-write" \
  --anchor-ref "path:/dev/null" \
  --source-artifact "test:unreachable" \
  --body "this must never land" 2>&1)
RC=$?
set -e
mv "$TMPDIR_BAK/entries" "$ENTRIES_DIR"
rmdir "$TMPDIR_BAK"
if [ $RC -eq 3 ]; then
  ok "writer refused with exit 3"
else
  bad "expected exit 3, got $RC; output: $OUT"
fi
if echo "$OUT" | grep -q "CANONICAL_UNREACHABLE"; then
  ok "error names CANONICAL_UNREACHABLE"
else
  bad "error did not name CANONICAL_UNREACHABLE: $OUT"
fi
UNEXPECTED=$( { ls "$ENTRIES_DIR" 2>/dev/null | grep -v "^\.gitkeep$" || true; } | wc -l | tr -d ' ')
if [ "$UNEXPECTED" = "0" ]; then
  ok "no orphan files in entries dir"
else
  bad "entries dir gained $UNEXPECTED unexpected file(s)"
fi

# --- c) Blocked ledger -------------------------------------------------------
echo "[c] blocked ledger"
LEDGER_BAK=$(mktemp)
cp "$LEDGER" "$LEDGER_BAK"
chmod 0444 "$LEDGER"
set +e
OUT=$($WRITER \
  --type feedback \
  --title "ledger-blocked-test" \
  --anchor-ref "concept:topological-sovereignty-memory" \
  --source-artifact "test:ledger-blocked" \
  --body "this must not orphan" 2>&1)
RC=$?
set -e
chmod 0644 "$LEDGER"
cp "$LEDGER_BAK" "$LEDGER"
rm -f "$LEDGER_BAK"
if [ $RC -eq 5 ] || [ $RC -eq 3 ]; then
  ok "writer refused (exit $RC) when ledger blocked"
else
  bad "expected exit 5 or 3, got $RC; output: $OUT"
fi
# Verify no orphan entry survived
ORPHAN_COUNT=$( { ls "$ENTRIES_DIR" 2>/dev/null | grep -v "^\.gitkeep$" || true; } | wc -l | tr -d ' ')
if [ "$ORPHAN_COUNT" = "0" ]; then
  ok "no orphan entry after blocked ledger"
else
  bad "$ORPHAN_COUNT orphan entry/entries found"
fi

# --- Summary ------------------------------------------------------------------
echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ] || exit 1
exit 0
