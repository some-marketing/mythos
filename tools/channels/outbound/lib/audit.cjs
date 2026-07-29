'use strict';

/**
 * Append-only audit log for the outbound iMessage gate.
 * Every state transition (draft, approve, reject, send, send-failure, allowlist-mutation)
 * appends one JSON line. The file is intentionally write-append-only — never edited or
 * truncated by code in this module. If you need to rotate, do it manually.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT_ROOT = path.resolve(__dirname, '../../../..');
const AUDIT_LOG = path.join(PROJECT_ROOT, '_dev/state/outbound/audit.log.jsonl');

function append(event) {
  const entry = {
    ts: new Date().toISOString(),
    event_id: crypto.randomUUID(),
    ...event
  };
  fs.mkdirSync(path.dirname(AUDIT_LOG), { recursive: true });
  fs.appendFileSync(AUDIT_LOG, JSON.stringify(entry) + '\n', { flag: 'a' });
  return entry;
}

function readAll() {
  if (!fs.existsSync(AUDIT_LOG)) return [];
  return fs.readFileSync(AUDIT_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

module.exports = { append, readAll, AUDIT_LOG };
