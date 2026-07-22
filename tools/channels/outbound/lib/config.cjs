'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../../../..');
const CONFIG_PATH = path.join(PROJECT_ROOT, '_dev/config/outbound-imessage.json');
const SCHEMA = 'OutboundIMessage/1.0';

const DRAFTS_DIR    = path.join(PROJECT_ROOT, '_dev/state/outbound/drafts');
const APPROVED_DIR  = path.join(PROJECT_ROOT, '_dev/state/outbound/approved');
const SENT_DIR      = path.join(PROJECT_ROOT, '_dev/state/outbound/sent');
const REJECTED_DIR  = path.join(PROJECT_ROOT, '_dev/state/outbound/rejected');

function load() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Outbound config not found: ${CONFIG_PATH}`);
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const cfg = JSON.parse(raw);
  if (cfg.schema !== SCHEMA) throw new Error(`Bad schema: ${cfg.schema}, expected ${SCHEMA}`);
  if (cfg.safety.ai_can_approve !== false) throw new Error('Safety violation: ai_can_approve must be false.');
  if (cfg.safety.ai_can_send !== false) throw new Error('Safety violation: ai_can_send must be false.');
  return cfg;
}

function isAllowedRecipient(cfg, handle) {
  return (cfg.recipient_allowlist || []).some((r) => r.handle === handle);
}

module.exports = {
  load, isAllowedRecipient,
  PROJECT_ROOT, CONFIG_PATH, SCHEMA,
  DRAFTS_DIR, APPROVED_DIR, SENT_DIR, REJECTED_DIR
};
