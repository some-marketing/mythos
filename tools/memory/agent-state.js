#!/usr/bin/env node
'use strict';

/**
 * agent-state.js — Agent persistence writer for simulated minds.
 *
 * Companion to build-memory-db.js. Writes agent state incrementally (upsert/append)
 * into the same memory.sqlite database, in separate tables from the concept dreaming
 * engine. No coupling between agent and concept tables.
 *
 * Schema: tools/memory/schemas/agent-state.schema.json (agent-state/1.0)
 *
 * Operations:
 *   register-agent   — Create new agent record
 *   write-state      — Upsert current agent state snapshot
 *   log-event        — Append event to agent history
 *   read-state       — Read current state for an agent
 *   list-agents      — List all agents, optionally filtered by world_id
 *
 * Usage:
 *   node tools/memory/agent-state.js register-agent <agent-id> <world-id> <entity-type> <name>
 *   node tools/memory/agent-state.js write-state <agent-id> <state-json> [tick]
 *   node tools/memory/agent-state.js log-event <agent-id> <event-type> <event-json> [tick]
 *   node tools/memory/agent-state.js read-state <agent-id>
 *   node tools/memory/agent-state.js list-agents [--world <world-id>]
 *
 * Determinisic: same input → same output. Node stdlib only. No randomness, no external API.
 * Privacy floor enforced: state_json and event_json are validated for PII markers before write.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveSqlite3 } = require('./lib/resolve-sqlite3.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DB_PATH = path.join(PROJECT_ROOT, '_dev/state/memory-db/memory.sqlite');
const SCHEMA_PATH = path.join(__dirname, 'schemas', 'agent-state.schema.json');

// Privacy floor: refuse to write state/event JSON containing these markers
const PII_MARKERS = [
  'email', 'password', 'api_key', 'secret', 'token', 'credential',
  'ssn', 'credit_card', 'phone', 'address', 'location', 'gps',
  'client_code', 'client_name', '.env'
];

function sqlite(cmd) {
  // Cross-platform: resolve the sqlite3 binary (win32/macOS/Linux/override) and
  // pass DB path + SQL as positional args — no shell, so no per-OS quoting.
  const bin = resolveSqlite3();
  if (!bin) {
    throw new Error(
      'sqlite3 CLI not found. Install sqlite3 or set SMOS_SQLITE3 to its path '
      + '(agent-state requires the sqlite store).'
    );
  }
  try {
    return execFileSync(bin, [DB_PATH, cmd], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    }).trim();
  } catch (e) {
    if (e.stderr && e.stderr.includes('no such table')) {
      return null;
    }
    throw new Error(`sqlite error: ${e.message}`);
  }
}

function ensureTables() {
  if (!fs.existsSync(SCHEMA_PATH)) {
    throw new Error(`Schema not found: ${SCHEMA_PATH}`);
  }

  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const tables = schema.tables;

  for (const [name, def] of Object.entries(tables)) {
    sqlite(def.sql);
    if (def.indexes) {
      for (const col of def.indexes) {
        const idxName = `idx_${name}_${col}`;
        sqlite(`CREATE INDEX IF NOT EXISTS ${idxName} ON ${name}(${col})`);
      }
    }
  }
}

function validatePrivacy(jsonStr, label) {
  const lower = jsonStr.toLowerCase();
  for (const marker of PII_MARKERS) {
    if (lower.includes(marker)) {
      throw new Error(`Privacy floor: ${label} contains prohibited marker "${marker}". Refusing write.`);
    }
  }
  // Validate it's parseable JSON
  try { JSON.parse(jsonStr); } catch (e) {
    throw new Error(`Invalid JSON in ${label}: ${e.message}`);
  }
}

function nowISO() {
  return new Date().toISOString();
}

function registerAgent(agentId, worldId, entityType, name) {
  ensureTables();

  // Check if already exists
  const existing = sqlite(`SELECT id FROM agents WHERE id = '${agentId}'`);
  if (existing) {
    sqlite(`UPDATE agents SET name = '${name}', entity_type = '${entityType}', last_updated = '${nowISO()}' WHERE id = '${agentId}'`);
    console.log(JSON.stringify({ status: 'updated', agent_id: agentId }));
    return;
  }

  const ts = nowISO();
  sqlite(`INSERT INTO agents (id, world_id, entity_type, name, created, last_updated) VALUES ('${agentId}', '${worldId}', '${entityType}', '${name}', '${ts}', '${ts}')`);
  console.log(JSON.stringify({ status: 'created', agent_id: agentId }));
}

function writeState(agentId, stateJson, tick) {
  ensureTables();
  validatePrivacy(stateJson, 'state_json');

  const tickNum = tick !== undefined ? parseInt(tick, 10) : 0;
  const ts = nowISO();

  // Verify agent exists
  const agent = sqlite(`SELECT id FROM agents WHERE id = '${agentId}'`);
  if (!agent) {
    throw new Error(`Agent '${agentId}' not registered. Run register-agent first.`);
  }

  // Upsert
  sqlite(`INSERT INTO agent_state (agent_id, state_json, tick, written_at) VALUES ('${agentId}', '${stateJson.replace(/'/g, "''")}', ${tickNum}, '${ts}') ON CONFLICT(agent_id) DO UPDATE SET state_json = excluded.state_json, tick = excluded.tick, written_at = excluded.written_at`);

  // Update agent last_updated
  sqlite(`UPDATE agents SET last_updated = '${ts}' WHERE id = '${agentId}'`);

  console.log(JSON.stringify({ status: 'written', agent_id: agentId, tick: tickNum }));
}

function logEvent(agentId, eventType, eventJson, tick) {
  ensureTables();
  validatePrivacy(eventJson, 'event_json');

  const tickNum = tick !== undefined ? parseInt(tick, 10) : 0;
  const ts = nowISO();

  // Verify agent exists
  const agent = sqlite(`SELECT id FROM agents WHERE id = '${agentId}'`);
  if (!agent) {
    throw new Error(`Agent '${agentId}' not registered. Run register-agent first.`);
  }

  sqlite(`INSERT INTO agent_history (agent_id, event_type, event_json, tick, written_at) VALUES ('${agentId}', '${eventType}', '${eventJson.replace(/'/g, "''")}', ${tickNum}, '${ts}')`);

  console.log(JSON.stringify({ status: 'logged', agent_id: agentId, event_type: eventType, tick: tickNum }));
}

function readState(agentId) {
  ensureTables();

  const row = sqlite(`SELECT state_json, tick, written_at FROM agent_state WHERE agent_id = '${agentId}'`);
  if (!row) {
    console.log(JSON.stringify({ status: 'not_found', agent_id: agentId }));
    return;
  }

  const parts = row.split('|');
  if (parts.length < 3) {
    console.log(JSON.stringify({ status: 'not_found', agent_id: agentId }));
    return;
  }

  console.log(JSON.stringify({
    status: 'found',
    agent_id: agentId,
    tick: parseInt(parts[1], 10),
    written_at: parts[2],
    state: JSON.parse(parts[0])
  }));
}

function listAgents(worldId) {
  ensureTables();

  let rows;
  if (worldId) {
    rows = sqlite(`SELECT id, world_id, entity_type, name, created, last_updated FROM agents WHERE world_id = '${worldId}' ORDER BY name`);
  } else {
    rows = sqlite(`SELECT id, world_id, entity_type, name, created, last_updated FROM agents ORDER BY world_id, name`);
  }

  if (!rows) {
    console.log(JSON.stringify({ agents: [] }));
    return;
  }

  const agents = rows.split('\n').filter(Boolean).map(line => {
    const [id, worldId, entityType, name, created, lastUpdated] = line.split('|');
    return { id, world_id: worldId, entity_type: entityType, name, created, last_updated: lastUpdated };
  });

  console.log(JSON.stringify({ agents }));
}

function usage() {
  process.stderr.write(`agent-state.js — Agent persistence writer (agent-state/1.0)

Usage:
  node tools/memory/agent-state.js register-agent <agent-id> <world-id> <entity-type> <name>
  node tools/memory/agent-state.js write-state <agent-id> <state-json> [tick]
  node tools/memory/agent-state.js log-event <agent-id> <event-type> <event-json> [tick]
  node tools/memory/agent-state.js read-state <agent-id>
  node tools/memory/agent-state.js list-agents [--world <world-id>]

Examples:
  node tools/memory/agent-state.js register-agent agent-001 world-a NPC "Forest Guardian"
  node tools/memory/agent-state.js write-state agent-001 '{"pos":[10,20],"hp":100}' 42
  node tools/memory/agent-state.js log-event agent-001 move '{"from":[0,0],"to":[10,20]}' 42
  node tools/memory/agent-state.js read-state agent-001
  node tools/memory/agent-state.js list-agents --world world-a
`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    usage();
    process.exit(1);
  }

  const cmd = args[0];

  try {
    switch (cmd) {
      case 'register-agent': {
        if (args.length < 5) { usage(); process.exit(1); }
        registerAgent(args[1], args[2], args[3], args[4]);
        break;
      }
      case 'write-state': {
        if (args.length < 3) { usage(); process.exit(1); }
        writeState(args[1], args[2], args[3]);
        break;
      }
      case 'log-event': {
        if (args.length < 4) { usage(); process.exit(1); }
        logEvent(args[1], args[2], args[3], args[4]);
        break;
      }
      case 'read-state': {
        if (args.length < 2) { usage(); process.exit(1); }
        readState(args[1]);
        break;
      }
      case 'list-agents': {
        let worldId = null;
        if (args[2] === '--world' && args[3]) {
          worldId = args[3];
        }
        listAgents(worldId);
        break;
      }
      default: {
        process.stderr.write(`Unknown command: ${cmd}\n\n`);
        usage();
        process.exit(1);
      }
    }
  } catch (e) {
    process.stderr.write(`agent-state error: ${e.message}\n`);
    process.exit(1);
  }
}

main();
