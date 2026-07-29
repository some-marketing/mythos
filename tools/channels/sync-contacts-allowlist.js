#!/usr/bin/env node
'use strict';

/**
 * sync-contacts-allowlist.js
 *
 * Source of truth: members of the "Dart Inbox" group in macOS Contacts.app.
 *
 * Effects (idempotent):
 *   - ~/.claude/channels/imessage/access.json: keeps non-managed allowFrom
 *     entries untouched; replaces only the entries this script owns.
 *   - _dev/config/text-ingestion.json: keeps non-sourced contacts
 *     untouched; replaces only entries with source == "contacts-sync".
 *
 * Refuses to run when the Contacts group is empty (anti-wipe guard).
 *
 * Usage:
 *   node tools/channels/sync-contacts-allowlist.js
 *   node tools/channels/sync-contacts-allowlist.js --dry-run
 *   node tools/channels/sync-contacts-allowlist.js --json
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const { readGroup, DEFAULT_GROUP } = require('./lib/contacts-reader');
const { normalize } = require('./lib/nanp-normalize');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const INGESTION_CONFIG = path.join(PROJECT_ROOT, '_dev/config/text-ingestion.json');
const ACCESS_FILE = path.join(os.homedir(), '.claude/channels/imessage/access.json');
const CLIENTS_DIR = path.join(PROJECT_ROOT, 'clients');
const INBOX_DARTBOARD = process.env.INBOX_DARTBOARD || '<your-dartboard-name>/Tasks';
const MANAGED_MARKER = 'contacts-sync';

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    json: argv.includes('--json'),
    group: ((idx) => idx >= 0 ? argv[idx + 1] : DEFAULT_GROUP)(argv.indexOf('--group'))
  };
}

function loadClientCompanyMap() {
  const map = new Map();
  let entries = [];
  try {
    entries = fs.readdirSync(CLIENTS_DIR, { withFileTypes: true });
  } catch {
    return map;
  }
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith('_') || ent.name.startsWith('.')) continue;
    const code = ent.name;
    const clientJson = path.join(CLIENTS_DIR, code, 'client.json');
    if (!fs.existsSync(clientJson)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(clientJson, 'utf8'));
      if (data.name) map.set(String(data.name).trim().toLowerCase(), code);
      if (Array.isArray(data.aliases)) {
        for (const a of data.aliases) map.set(String(a).trim().toLowerCase(), code);
      }
    } catch {
      // ignore malformed client.json
    }
  }
  return map;
}

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse ${file}: ${err.message}`);
  }
}

function writeJsonAtomic(file, obj) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function buildSyncedContacts(people, companyMap) {
  const contacts = [];
  const handles = new Set();
  for (const person of people) {
    const clientCode = companyMap.get((person.company || '').toLowerCase()) || null;
    const rawHandles = [...person.phones, ...person.emails];
    const normalized = Array.from(new Set(
      rawHandles.map(normalize).filter(Boolean)
    ));
    for (const h of normalized) {
      handles.add(h);
      contacts.push({
        name: person.name || h,
        handle: h,
        client_code: clientCode,
        enabled: true,
        forward_to_dart_board: INBOX_DARTBOARD,
        source: MANAGED_MARKER,
        company: person.company || null,
        notes: `Synced from macOS Contacts group "${DEFAULT_GROUP}" on ${new Date().toISOString()}`
      });
    }
  }
  return { contacts, handles };
}

function mergeIngestionConfig(existing, syncedContacts) {
  const config = existing || {
    schema: 'TextIngestionBridge/1.1',
    description: 'One-way text ingestion bridge. Verbatim forwarding only, no LLM in loop.',
    mode: 'live',
    safety: {
      outbound_messaging: 'NEVER',
      auto_claiming: false,
      auto_execution: false,
      dart_mutation: 'forward_only'
    },
    contacts: [],
    ingestion: { scan_interval_minutes: 1, max_messages_per_scan: 50, dedup_window_hours: 24 },
    routing: { use_client_routing: true, client_routing_path: 'tools/dart-integration/client-routing.json', default_action: 'draft_artifact' }
  };
  const kept = (config.contacts || []).filter((c) => c.source !== MANAGED_MARKER);
  config.contacts = [...kept, ...syncedContacts];
  return config;
}

function mergeAccessConfig(existing, syncedHandles, prevManagedHandles) {
  const access = existing || {
    dmPolicy: 'allowlist',
    allowFrom: [],
    groups: {},
    pending: {},
    mentionPatterns: []
  };
  const allowSet = new Set(access.allowFrom || []);
  // Remove previously-managed handles that are no longer in the sync.
  for (const h of prevManagedHandles) {
    if (!syncedHandles.has(h)) allowSet.delete(h);
  }
  // Add all current synced handles.
  for (const h of syncedHandles) allowSet.add(h);
  access.allowFrom = Array.from(allowSet).sort();
  access._managed_handles = Array.from(syncedHandles).sort();
  return access;
}

function diffSummary(before, after, key) {
  const a = new Set(before || []);
  const b = new Set(after || []);
  const added = [...b].filter((x) => !a.has(x));
  const removed = [...a].filter((x) => !b.has(x));
  return { key, added, removed, total_before: a.size, total_after: b.size };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const people = readGroup({ group: args.group });

  if (people.length === 0) {
    const msg = `Refusing to sync: Contacts group "${args.group}" is empty. Add members before running.`;
    if (args.json) {
      console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
    } else {
      console.error(msg);
    }
    process.exit(2);
  }

  const companyMap = loadClientCompanyMap();
  const { contacts: syncedContacts, handles: syncedHandles } = buildSyncedContacts(people, companyMap);

  if (syncedHandles.size === 0) {
    const msg = `Refusing to sync: group "${args.group}" has ${people.length} member(s) but no normalizable phone/email handles.`;
    if (args.json) {
      console.log(JSON.stringify({ ok: false, error: msg, people }, null, 2));
    } else {
      console.error(msg);
    }
    process.exit(2);
  }

  const ingestionBefore = loadJson(INGESTION_CONFIG, null);
  const accessBefore = loadJson(ACCESS_FILE, null);
  const prevManaged = new Set((accessBefore && accessBefore._managed_handles) || []);

  const ingestionAfter = mergeIngestionConfig(ingestionBefore, syncedContacts);
  const accessAfter = mergeAccessConfig(accessBefore, syncedHandles, prevManaged);

  const result = {
    ok: true,
    dry_run: args.dryRun,
    group: args.group,
    people_count: people.length,
    handles_synced: syncedHandles.size,
    contacts: syncedContacts.map(({ name, handle, client_code, company }) => ({ name, handle, client_code, company })),
    diffs: {
      allow_from: diffSummary(accessBefore && accessBefore.allowFrom, accessAfter.allowFrom),
      managed_handles: diffSummary([...prevManaged], accessAfter._managed_handles)
    },
    paths: { ingestion_config: INGESTION_CONFIG, access_file: ACCESS_FILE }
  };

  if (!args.dryRun) {
    writeJsonAtomic(INGESTION_CONFIG, ingestionAfter);
    writeJsonAtomic(ACCESS_FILE, accessAfter);
    result.wrote = [INGESTION_CONFIG, ACCESS_FILE];
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`${args.dryRun ? '[DRY-RUN] ' : ''}Synced ${syncedHandles.size} handle(s) from ${people.length} contact(s) in "${args.group}".`);
    for (const c of syncedContacts) {
      const tag = c.client_code ? ` [${c.client_code}]` : '';
      console.log(`  • ${c.name}${tag} → ${c.handle}`);
    }
    const af = result.diffs.allow_from;
    if (af.added.length) console.log(`  + allowFrom added: ${af.added.join(', ')}`);
    if (af.removed.length) console.log(`  - allowFrom removed: ${af.removed.join(', ')}`);
    if (!args.dryRun) console.log(`Wrote: ${INGESTION_CONFIG}\n       ${ACCESS_FILE}`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify({ ok: false, error: err.message }, null, 2));
    } else {
      console.error(`Error: ${err.message}`);
    }
    process.exit(1);
  }
}

module.exports = { buildSyncedContacts, mergeIngestionConfig, mergeAccessConfig };
