#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/dashboard.js — a local, live-updating dashboard for
// resources/territory/metrics per colony. Operator (2026-07-16): "can we get
// a dashboard of resources and metrics of how much of the world each colony
// has etc?" This satisfies G-LIVE-VIEW today, independent of the Unreal
// render side (which remains deferred to attended Orwell -- see
// ant-hive-world__plan.json S2 status).
//
// Reads ONLY from the shared world-state file + each hive's own sandbox
// directory (auto-discovered) -- no dependency on any other lane's code.
// Serves plain HTML + inline JS that polls a local JSON endpoint; nothing
// leaves localhost.
//
// Usage: node dashboard.js --sandbox-root <dir> --world-state <path> [--port 4173]

const fs = require('fs');
const path = require('path');
const http = require('http');
const { readWorldState } = require('./world-state.js');
const { DEFAULT_CONFIG, readLiveConfig, writeLiveConfig } = require('./live-config.js');

function argVal(flag, def) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const SANDBOX_ROOT = argVal('--sandbox-root', path.join(process.cwd(), '.ant-hive-sandbox'));
const WORLD_STATE_PATH = argVal('--world-state', path.join(SANDBOX_ROOT, 'shared', 'world-state.json'));
const CONFIG_PATH = argVal('--config', path.join(SANDBOX_ROOT, 'live-config.json'));
const PORT = parseInt(argVal('--port', '4173'), 10);

function discoverHives(sandboxRoot) {
  let entries = [];
  try {
    entries = fs.readdirSync(sandboxRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && e.name !== 'shared')
    .map((e) => {
      const hiveStatePath = path.join(sandboxRoot, e.name, 'hive-state.json');
      const auditLogPath = path.join(sandboxRoot, e.name, 'audit-log.jsonl');
      let hiveState = null;
      try {
        hiveState = JSON.parse(fs.readFileSync(hiveStatePath, 'utf8'));
      } catch {
        return null; // torn/missing -- skip this poll, dashboard just won't show it this tick
      }
      let lastAuditLine = null;
      try {
        const lines = fs.readFileSync(auditLogPath, 'utf8').trim().split('\n');
        lastAuditLine = lines.length ? JSON.parse(lines[lines.length - 1]) : null;
      } catch {
        // no audit log yet
      }
      return { identity: e.name, hiveState, lastAudit: lastAuditLine };
    })
    .filter(Boolean);
}

// Wiki view (plan ant-hive-world-lore-wiki-layer, S3) -- reads ONLY the
// lore-engine's own output files (wiki-log.jsonl, pending-milestone-
// narration.jsonl), written by tools/ant-hive-world/lore-engine/watch.js.
// This module never runs the watcher or generates entries itself; it is a
// pure read/render surface, same relationship as computeSnapshot() has to
// harness.js/run-live.js.
function readJsonlEntries(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.split('\n').filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

// Groups a hive's wiki-log entries by subject (S0 axis 4: linked entity/
// event pages, not a flat feed) plus a chronological index across subjects.
function computeWikiSnapshot(hiveId) {
  const hiveDir = path.join(SANDBOX_ROOT, hiveId);
  const entries = readJsonlEntries(path.join(hiveDir, 'wiki-log.jsonl'));
  const pendingMilestones = readJsonlEntries(path.join(hiveDir, 'pending-milestone-narration.jsonl'));

  const pages = {};
  for (const entry of entries) {
    if (!pages[entry.subject]) pages[entry.subject] = { subject: entry.subject, entry_type: entry.entry_type, entries: [] };
    pages[entry.subject].entries.push(entry);
  }

  const chronological = [...entries].sort((a, b) => new Date(a.ts) - new Date(b.ts));

  return {
    hive: hiveId,
    subject_count: Object.keys(pages).length,
    pages,
    chronological,
    pending_milestones: pendingMilestones
  };
}

function computeSnapshot() {
  const worldState = readWorldState(WORLD_STATE_PATH);
  const hives = discoverHives(SANDBOX_ROOT);

  const territoryCounts = {};
  if (worldState && worldState.territory) {
    for (const owner of Object.values(worldState.territory)) {
      territoryCounts[owner] = (territoryCounts[owner] || 0) + 1;
    }
  }
  const totalTiles = worldState ? Object.keys(worldState.territory || {}).length : 0;

  const geometryCounts = {};
  if (worldState && Array.isArray(worldState.geometry_log)) {
    for (const entry of worldState.geometry_log) {
      geometryCounts[entry.hive] = (geometryCounts[entry.hive] || 0) + 1;
    }
  }

  // Discovery-gated resources display (plan ant-hive-world-richer-resource-model,
  // S2 -- operator, 2026-07-16: "only show the resources ... that they're
  // aware of. as they discover more ... add those"). world-state.js's
  // discovered_types is the single source of truth for what's been found;
  // this is a cosmetic display filter only -- the full resources pool still
  // exists and accumulates underneath regardless of what's shown.
  const discoveredTypes = new Set((worldState && worldState.discovered_types) || []);
  const allResources = worldState ? worldState.resources || {} : {};
  const sharedResources = {};
  for (const [key, value] of Object.entries(allResources)) {
    if (discoveredTypes.has(key)) sharedResources[key] = value;
  }

  return {
    generated_at: new Date().toISOString(),
    world_state_present: Boolean(worldState),
    world_seq: worldState ? worldState.seq : null,
    world_written_at: worldState ? worldState.written_at : null,
    discovered_types: Array.from(discoveredTypes),
    shared_resources: sharedResources,
    food_source_count: worldState ? Object.keys(worldState.food_sources || {}).length : 0,
    prey_population: worldState ? worldState.prey_population : null,
    predator_population: worldState ? worldState.predator_population : null,
    total_territory_tiles: totalTiles,
    colonies: hives.map((h) => ({
      identity: h.identity,
      territory_tiles_held: territoryCounts[h.identity] || 0,
      territory_share: totalTiles > 0 ? (territoryCounts[h.identity] || 0) / totalTiles : 0,
      structures_built: geometryCounts[h.identity] || 0,
      last_action: h.hiveState && h.hiveState.hive_state && h.hiveState.hive_state.worker_dispatch_state
        ? h.hiveState.hive_state.worker_dispatch_state.last_action
        : null,
      last_audit_event: h.lastAudit
    }))
  };
}

// Field metadata for the live-config form -- operator (2026-07-16): "i need
// to be able to modify variables in this dashboard." label/step/min are
// display-only hints; the actual bounds enforcement (never negative, etc.)
// lives in world-state.js/untrained-network.js, not here.
const CONFIG_FIELDS = [
  { key: 'tick_interval_ms', label: 'Tick interval (ms)', step: 10, min: 0 },
  { key: 'build_cost_wood', label: 'Build cost (wood)', step: 1, min: 0 },
  { key: 'pheromone_deposit', label: 'Pheromone deposit', step: 0.1, min: 0 },
  { key: 'pheromone_decay', label: 'Pheromone decay factor', step: 0.01, min: 0, max: 1 },
  { key: 'trail_follow_prob', label: 'Trail-follow probability', step: 0.05, min: 0, max: 1 },
  { key: 'food_source_spawn_chance', label: 'Food-source spawn chance/tick', step: 0.01, min: 0, max: 1 },
  { key: 'food_source_spawn_amount', label: 'Food-source spawn amount', step: 1, min: 0 },
  { key: 'max_food_sources', label: 'Max food sources', step: 1, min: 0 },
  { key: 'prey_growth_rate', label: 'Prey growth rate', step: 0.01, min: 0 },
  { key: 'prey_graze_rate', label: 'Prey graze rate (food/tick)', step: 0.05, min: 0 },
  { key: 'predation_rate', label: 'Predation rate', step: 0.005, min: 0 },
  { key: 'predator_growth_rate', label: 'Predator growth rate', step: 0.01, min: 0 },
  { key: 'predator_death_rate', label: 'Predator death rate', step: 0.01, min: 0 },
  { key: 'upkeep_cost_food', label: 'Hive food upkeep/tick', step: 0.5, min: 0 },
  { key: 'entropy_bonus_weight', label: 'Entropy bonus weight (standing value, 0=off)', step: 0.01, min: 0 },
  { key: 'forced_exploration_interval', label: 'Forced-exploration interval (0=off)', step: 1, min: 0 },
  { key: 'entropy_bonus_weight_initial', label: 'Entropy bonus weight (initial, decaying schedule)', step: 0.1, min: 0 },
  { key: 'entropy_bonus_decay_ticks', label: 'Entropy bonus decay length (ticks, 0=off)', step: 1, min: 0 },
  { key: 'update_clip', label: 'Update clip (max |dLogits| per trainStep, 0=off)', step: 0.1, min: 0 },
  { key: 'entropy_controller_enabled', label: 'Entropy controller (reactive boost, 1=on 0=off)', step: 1, min: 0, max: 1 },
  { key: 'entropy_controller_trigger', label: 'Entropy controller trigger (nats, engage below)', step: 0.05, min: 0 },
  { key: 'entropy_controller_release', label: 'Entropy controller release (nats, disengage at/above)', step: 0.05, min: 0 },
  { key: 'entropy_controller_boost_weight', label: 'Entropy controller boost weight (while engaged)', step: 0.1, min: 0 },
  { key: 'material_spawn_chance', label: 'Material spawn chance/tick', step: 0.01, min: 0, max: 1 },
  { key: 'material_harvest_rate', label: 'Material harvest rate', step: 0.01, min: 0, max: 1 },
  { key: 'mud_conversion_rate', label: 'Mud conversion rate (clay+water)', step: 0.01, min: 0, max: 1 }
];

const PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Ant-Hive-World — Live Dashboard</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #1c150d; color: #f3e9db; margin: 0; padding: 2rem; }
  h1 { font-size: 1.4rem; font-weight: 500; }
  h2.section { font-size: 1rem; color: #e0a949; margin: 0 0 0.5rem; }
  .meta { color: #c2ab8d; font-size: 0.85rem; margin-bottom: 1.5rem; }
  .colonies { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; }
  .colony { background: #261d13; border: 1px solid rgba(243,233,219,0.13); border-radius: 10px; padding: 1rem 1.2rem; }
  .colony h2 { font-size: 1.05rem; margin: 0 0 0.6rem; color: #e0a949; }
  .row { display: flex; justify-content: space-between; font-size: 0.9rem; padding: 0.2rem 0; color: #c2ab8d; }
  .row b { color: #f3e9db; font-weight: 500; }
  .resources, .ecosystem, .config { margin-top: 1.5rem; }
  .bar-bg { background: #2c2116; border-radius: 6px; height: 8px; overflow: hidden; margin-top: 0.3rem; }
  .bar-fill { background: #e0a949; height: 100%; }
  .config-form { background: #261d13; border: 1px solid rgba(243,233,219,0.13); border-radius: 10px; padding: 1rem 1.2rem; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.7rem 1rem; }
  .field { display: flex; flex-direction: column; gap: 0.25rem; }
  .field label { font-size: 0.78rem; color: #c2ab8d; }
  .field input { background: #1c150d; border: 1px solid rgba(243,233,219,0.2); color: #f3e9db; border-radius: 6px; padding: 0.35rem 0.5rem; font-size: 0.85rem; font-variant-numeric: tabular-nums; }
  .config-actions { grid-column: 1 / -1; display: flex; align-items: center; gap: 0.8rem; margin-top: 0.3rem; }
  button { background: #e0a949; color: #1c150d; border: none; border-radius: 6px; padding: 0.5rem 1rem; font-size: 0.85rem; font-weight: 600; cursor: pointer; }
  button:active { transform: translateY(1px); }
  #save-status { font-size: 0.8rem; color: #c2ab8d; }
  .wiki { margin-top: 1.5rem; }
  .wiki-tabs { display: flex; gap: 0.5rem; margin-bottom: 0.8rem; flex-wrap: wrap; }
  .wiki-tab { background: #261d13; border: 1px solid rgba(243,233,219,0.13); color: #c2ab8d; border-radius: 6px; padding: 0.35rem 0.7rem; font-size: 0.8rem; cursor: pointer; }
  .wiki-tab.active { color: #1c150d; background: #e0a949; }
  .wiki-body { display: grid; grid-template-columns: 220px 1fr; gap: 1rem; }
  .wiki-pages { background: #261d13; border: 1px solid rgba(243,233,219,0.13); border-radius: 10px; padding: 0.8rem; max-height: 420px; overflow-y: auto; }
  .wiki-page-link { display: block; padding: 0.3rem 0.4rem; border-radius: 6px; color: #c2ab8d; font-size: 0.85rem; cursor: pointer; }
  .wiki-page-link.active, .wiki-page-link:hover { background: #1c150d; color: #f3e9db; }
  .wiki-entries { background: #261d13; border: 1px solid rgba(243,233,219,0.13); border-radius: 10px; padding: 1rem; max-height: 420px; overflow-y: auto; }
  .wiki-entry { margin-bottom: 0.9rem; padding-bottom: 0.9rem; border-bottom: 1px solid rgba(243,233,219,0.08); }
  .wiki-entry:last-child { border-bottom: none; }
  .wiki-entry .wiki-entry-meta { font-size: 0.72rem; color: #8a7a63; margin-bottom: 0.25rem; }
  .wiki-entry .wiki-entry-text { font-size: 0.88rem; line-height: 1.4; }
  .wiki-empty { color: #8a7a63; font-size: 0.85rem; padding: 1rem; }
  .wiki-milestones { margin-top: 0.6rem; font-size: 0.78rem; color: #c2ab8d; }
</style>
</head>
<body>
<h1>Ant-Hive-World — Live Dashboard</h1>
<div class="meta" id="meta">loading…</div>

<div class="resources">
  <h2 class="section">Shared resources</h2>
  <div id="resources"></div>
</div>

<div class="ecosystem">
  <h2 class="section">Ecosystem</h2>
  <div id="ecosystem"></div>
</div>

<div class="colonies" id="colonies" style="margin-top:1.5rem;"></div>

<div class="wiki">
  <h2 class="section">Colony wiki (lore-engine)</h2>
  <div class="wiki-tabs" id="wiki-tabs"></div>
  <div class="wiki-body">
    <div class="wiki-pages" id="wiki-pages"></div>
    <div class="wiki-entries" id="wiki-entries"><div class="wiki-empty">Select a colony to browse its recorded history.</div></div>
  </div>
  <div class="wiki-milestones" id="wiki-milestones"></div>
</div>

<div class="config">
  <h2 class="section">Live-tunable variables</h2>
  <form class="config-form" id="config-form">
    ${CONFIG_FIELDS.map((f) => `
    <div class="field">
      <label for="cfg-${f.key}">${f.label}</label>
      <input id="cfg-${f.key}" name="${f.key}" type="number" step="${f.step}" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''}>
    </div>`).join('')}
    <div class="config-actions">
      <button type="submit">Save changes</button>
      <span id="save-status"></span>
    </div>
  </form>
</div>

<script>
const CONFIG_KEYS = ${JSON.stringify(CONFIG_FIELDS.map((f) => f.key))};
let editingConfig = false; // suppress overwriting fields the operator is actively typing into

async function refresh() {
  const res = await fetch('/snapshot.json');
  const data = await res.json();
  document.getElementById('meta').textContent =
    'World state: ' + (data.world_state_present ? 'seq ' + data.world_seq + ', written ' + data.world_written_at : 'not yet initialized')
    + ' · discovered: ' + (data.discovered_types || []).join(', ')
    + ' · dashboard refreshed ' + data.generated_at;

  const resourcesEl = document.getElementById('resources');
  resourcesEl.innerHTML = Object.entries(data.shared_resources || {}).map(([k, v]) =>
    '<div class="row"><span>' + k + '</span><b>' + (typeof v === 'number' ? v.toFixed(2) : v) + '</b></div>'
  ).join('') || '<div class="row">(none yet)</div>';

  const ecosystemEl = document.getElementById('ecosystem');
  ecosystemEl.innerHTML =
    '<div class="row"><span>Food sources (patches)</span><b>' + (data.food_source_count ?? 0) + '</b></div>' +
    '<div class="row"><span>Prey population</span><b>' + (data.prey_population != null ? data.prey_population.toFixed(1) : '—') + '</b></div>' +
    '<div class="row"><span>Predator population</span><b>' + (data.predator_population != null ? data.predator_population.toFixed(1) : '—') + '</b></div>';

  const colEl = document.getElementById('colonies');
  colEl.innerHTML = data.colonies.map((c) => \`
    <div class="colony">
      <h2>\${c.identity}</h2>
      <div class="row"><span>Territory held</span><b>\${c.territory_tiles_held} / \${data.total_territory_tiles || 0}</b></div>
      <div class="bar-bg"><div class="bar-fill" style="width:\${Math.round(c.territory_share * 100)}%"></div></div>
      <div class="row"><span>Structures built</span><b>\${c.structures_built}</b></div>
      <div class="row"><span>Last action</span><b>\${c.last_action || '—'}</b></div>
    </div>
  \`).join('');

  renderWikiTabs(data.colonies.map((c) => c.identity));
}

// --- Wiki view (plan ant-hive-world-lore-wiki-layer, S3) -----------------
let selectedHive = null;
let selectedSubject = null; // null = chronological index for the selected hive

function renderWikiTabs(hiveIds) {
  if (selectedHive === null && hiveIds.length) selectedHive = hiveIds[0];
  const tabsEl = document.getElementById('wiki-tabs');
  tabsEl.innerHTML = hiveIds.map((id) =>
    '<div class="wiki-tab' + (id === selectedHive ? ' active' : '') + '" data-hive="' + id + '">' + id + '</div>'
  ).join('');
  for (const el of tabsEl.querySelectorAll('.wiki-tab')) {
    el.addEventListener('click', () => { selectedHive = el.dataset.hive; selectedSubject = null; loadWiki(); });
  }
  if (selectedHive) loadWiki();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderWikiEntries(entries, emptyMessage) {
  const el = document.getElementById('wiki-entries');
  if (!entries.length) {
    el.innerHTML = '<div class="wiki-empty">' + emptyMessage + '</div>';
    return;
  }
  el.innerHTML = entries.map((e) => \`
    <div class="wiki-entry">
      <div class="wiki-entry-meta">\${escapeHtml(e.entry_type)} · \${escapeHtml(e.subject)} · \${escapeHtml(e.ts)}</div>
      <div class="wiki-entry-text">\${escapeHtml(e.narrative_text)}</div>
    </div>
  \`).join('');
}

async function loadWiki() {
  if (!selectedHive) return;
  const res = await fetch('/wiki.json?hive=' + encodeURIComponent(selectedHive));
  const data = await res.json();

  const pagesEl = document.getElementById('wiki-pages');
  const subjects = Object.keys(data.pages || {}).sort();
  const chronoLink = '<div class="wiki-page-link' + (selectedSubject === null ? ' active' : '') + '" data-subject="">Chronological (' + data.chronological.length + ')</div>';
  const subjectLinks = subjects.map((s) =>
    '<div class="wiki-page-link' + (s === selectedSubject ? ' active' : '') + '" data-subject="' + escapeHtml(s) + '">' + escapeHtml(s) + ' (' + data.pages[s].entries.length + ')</div>'
  ).join('');
  pagesEl.innerHTML = chronoLink + subjectLinks;
  for (const el of pagesEl.querySelectorAll('.wiki-page-link')) {
    el.addEventListener('click', () => { selectedSubject = el.dataset.subject || null; loadWiki(); });
  }

  if (selectedSubject === null) {
    renderWikiEntries(data.chronological, 'No wiki entries yet for this colony -- discoveries, structures, and territory claims will appear here as the lore-engine watcher processes them.');
  } else {
    renderWikiEntries((data.pages[selectedSubject] || { entries: [] }).entries, 'No entries for this subject.');
  }

  const milestonesEl = document.getElementById('wiki-milestones');
  milestonesEl.textContent = data.pending_milestones.length
    ? data.pending_milestones.length + ' milestone event(s) queued for attended narration (not auto-generated): ' + data.pending_milestones.map((m) => m.subject).join(', ')
    : '';
}

async function refreshConfig() {
  if (editingConfig) return;
  const res = await fetch('/config.json');
  const cfg = await res.json();
  for (const key of CONFIG_KEYS) {
    const el = document.getElementById('cfg-' + key);
    if (el && document.activeElement !== el) el.value = cfg[key];
  }
}

document.getElementById('config-form').addEventListener('focusin', () => { editingConfig = true; });
document.getElementById('config-form').addEventListener('focusout', () => { editingConfig = false; });

document.getElementById('config-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const updates = {};
  for (const key of CONFIG_KEYS) {
    const el = document.getElementById('cfg-' + key);
    if (el.value !== '') updates[key] = parseFloat(el.value);
  }
  const status = document.getElementById('save-status');
  status.textContent = 'saving…';
  const res = await fetch('/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });
  status.textContent = res.ok ? 'saved — takes effect next tick' : 'save failed';
  setTimeout(() => { status.textContent = ''; }, 3000);
});

refresh();
refreshConfig();
setInterval(refresh, 2000);
setInterval(refreshConfig, 5000);
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/snapshot.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(computeSnapshot()));
    return;
  }
  if (req.url && req.url.startsWith('/wiki.json')) {
    const parsed = new URL(req.url, 'http://localhost');
    const hiveId = parsed.searchParams.get('hive');
    if (!hiveId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'missing ?hive= query param' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(computeWikiSnapshot(hiveId)));
    return;
  }
  if (req.url === '/config.json' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(readLiveConfig(CONFIG_PATH)));
    return;
  }
  if (req.url === '/config' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const updates = JSON.parse(body || '{}');
        const validKeys = Object.keys(DEFAULT_CONFIG);
        // Enforce each field's own min/max (codex distinct review, 2026-07-17:
        // this endpoint previously accepted any finite number, relying only
        // on HTML input bounds -- trivially bypassed by POSTing directly).
        // world-state.js independently clamps the material rates it actually
        // consumes; this is defense-in-depth at the config boundary itself.
        const fieldBounds = Object.fromEntries(CONFIG_FIELDS.map((f) => [f.key, f]));
        const sanitized = {};
        for (const [key, value] of Object.entries(updates)) {
          if (validKeys.includes(key) && typeof value === 'number' && Number.isFinite(value)) {
            const bounds = fieldBounds[key];
            let clamped = value;
            if (bounds && bounds.min !== undefined) clamped = Math.max(bounds.min, clamped);
            if (bounds && bounds.max !== undefined) clamped = Math.min(bounds.max, clamped);
            sanitized[key] = clamped;
          }
        }
        const next = writeLiveConfig(CONFIG_PATH, sanitized);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(next));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(PAGE);
});

module.exports = { computeSnapshot, computeWikiSnapshot, discoverHives, server, CONFIG_FIELDS };

if (require.main === module) {
  server.listen(PORT, () => {
    process.stdout.write(`ant-hive-world dashboard: http://localhost:${PORT} (sandbox: ${SANDBOX_ROOT})\n`);
  });
}
