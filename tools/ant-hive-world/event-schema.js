'use strict';

const crypto = require('node:crypto');

const EVENT_SCHEMA_VERSION = '1.0.0';
// Only these versions satisfy the contract predicate. A recognized name
// with an unsupported or garbage version is still pre-contract (codex
// PR #8 P2, carried onto PR #12).
const SUPPORTED_SCHEMA_VERSIONS = Object.freeze([EVENT_SCHEMA_VERSION]);
const SCHEMA_NAMES = Object.freeze({
  audit: 'ant-hive-world.audit-event',
  geometry: 'ant-hive-world.geometry-event',
  run: 'ant-hive-world.run-event'
});

// Identity uses the operating system's cryptographic random source, never the
// simulation RNG. An episode currently spans one run-live process because the
// engine has no reset/reseed boundary inside a process.
function createEventContext({ armId = 'uninstructed', runId, episodeId } = {}) {
  return Object.freeze({
    run_id: runId || crypto.randomUUID(),
    episode_id: episodeId || crypto.randomUUID(),
    arm_id: armId || 'uninstructed'
  });
}

const processEventContext = createEventContext();

function tickKey(context, tick, hive) {
  return `${context.episode_id}:${tick}:${hive || 'world'}`;
}

function decorateEvent(kind, context, tick, row) {
  if (!Number.isInteger(tick) || tick < 0) {
    throw new TypeError(`event tick must be a non-negative integer; received ${tick}`);
  }
  const schemaName = SCHEMA_NAMES[kind];
  if (!schemaName) throw new TypeError(`unknown event schema kind: ${kind}`);
  const hive = row.hive || null;
  return {
    ...row,
    schema_name: schemaName,
    schema_version: EVENT_SCHEMA_VERSION,
    run_id: context.run_id,
    episode_id: context.episode_id,
    arm_id: context.arm_id,
    tick,
    tick_key: tickKey(context, tick, hive)
  };
}

// Readers must keep accepting historical JSONL rows. Unknown or missing
// schema metadata -- including an unsupported or garbage schema_version --
// is data, not an exception: it marks a pre-contract row.
function identifyEventRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return { contract_status: 'pre-contract', row };
  }
  const contracted = Object.values(SCHEMA_NAMES).includes(row.schema_name) &&
    SUPPORTED_SCHEMA_VERSIONS.includes(row.schema_version);
  return { contract_status: contracted ? 'contract' : 'pre-contract', row };
}

module.exports = {
  EVENT_SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  SCHEMA_NAMES,
  createEventContext,
  processEventContext,
  tickKey,
  decorateEvent,
  identifyEventRow
};
