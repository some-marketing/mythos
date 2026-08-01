#!/usr/bin/env node
'use strict';

/**
 * Contextual sweep — Tier 0 of the contextual-mind tiered attention layer.
 *
 * Concept: _dev/concepts/contextual-mind-tiered-attention.md (4612a04c)
 *
 * Reads all fresh active-session JSON files, extracts each session's working
 * context (branch, working_surface, recent commits), scores candidate items
 * (memory ledger entries, live coordination signals, auto-memory files) by
 * dumb token/path/anchor overlap with TF-IDF-style boilerplate suppression,
 * applies per-session deduplication and score decay, writes a glanceable
 * scored hit list per session.
 *
 * No LLM. No reasoning. No interpretation. Pure score-and-rank.
 *
 * Tier 0 day-one constraints (from three-lobe convene 30c1b1b0):
 *   1. Per-session suppression: dedupe against last-N seen hits per session
 *   2. Boilerplate filter: TF-IDF style weighting; common tokens score zero
 *   3. Score decay: older candidates score lower
 *   4. Glanceable output: one line per hit, scored, sorted
 *   5. Global single process iterating all sessions, not per-session daemons
 *   6. Hot cadence: meant to be invoked every 1-2 min via cron/launchd
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const { parseArgs } = require('../workspace/lib/args');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const ACTIVE_SESSIONS_DIR = path.join(PROJECT_ROOT, '_dev/state/active-sessions');
const TTL_POLICY_PATH = path.join(ACTIVE_SESSIONS_DIR, '_ttl-policy.json');
const LEDGER_PATH = path.join(PROJECT_ROOT, '_dev/state/memory-ledger.jsonl');
const SIGNALS_DIR = path.join(PROJECT_ROOT, '_dev/reports/signals');
const HINTS_DIR = path.join(PROJECT_ROOT, '_dev/state/contextual-hints');
const MEMORY_DIR = path.resolve(
  process.env.HOME,
  '.claude/projects/{PROJECT_SLUG}/memory'
);

const HIT_HISTORY_KEEP = 200;        // last-N hits per session for dedupe
const LEDGER_TAIL = 200;             // last-N ledger entries to consider
const COMMIT_TAIL = 50;              // recent commits per branch
const DECAY_HALFLIFE_HOURS = 24;     // candidate score halves every 24h
const MIN_TOKEN_LENGTH = 3;          // ignore tokens shorter than this
const TOP_K_OUTPUT = 20;             // per-session glanceable list size

// Boilerplate stop list — common code/prose tokens that should score zero.
// Kept short and conservative; expand based on soak data.
const BOILERPLATE = new Set([
  'the','and','for','with','from','that','this','have','has','had','was','are',
  'were','will','can','should','would','could','must','may','might','need',
  'function','const','let','var','class','async','await','return','import',
  'export','require','module','default','true','false','null','undefined',
  'log','console','error','info','debug','warn','catch','throw','then','else',
  'session','sessions','memory','memories','file','files','path','data','json',
  'commit','commits','branch','branches','main','master','feature','feat','fix',
  'chore','add','update','remove','delete','create','test','tests','test-','readme',
  'package','lock','yaml','yml','txt','jsonl','sha','hash','time','date','utc',
  'note','notes','todo','tbd','wip','draft','active','closed','open','new'
]);

function help() {
  console.log(`
Tier 0 contextual sweep — pure-code pattern match across active sessions.

Usage:
  node tools/memory/contextual-sweep.js [options]

Options:
  --session-id <sid>   Sweep only this session (default: all fresh sessions)
  --dry-run            Print results to stdout, do not write hint files
  --json               Print machine-readable JSON to stdout
  --no-decay           Skip score decay (useful during calibration)
  --no-suppress        Skip per-session suppression (useful during calibration)
  --help               Show this help
`.trim());
}

function nowMs() { return Date.now(); }

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(t => t.length >= MIN_TOKEN_LENGTH && !BOILERPLATE.has(t));
}

function loadTTLPolicy() {
  const p = readJSON(TTL_POLICY_PATH);
  return p || { default_ttl_ms: 1800000, policies: {} };
}

function loadFreshSessions(filterId) {
  const policy = loadTTLPolicy();
  const now = nowMs();
  const out = [];
  let entries;
  try { entries = fs.readdirSync(ACTIVE_SESSIONS_DIR); }
  catch { return out; }
  for (const f of entries) {
    if (!/^[0-9a-f-]{36}\.json$/.test(f)) continue;
    const sid = f.replace(/\.json$/, '');
    if (filterId && sid !== filterId) continue;
    const session = readJSON(path.join(ACTIVE_SESSIONS_DIR, f));
    if (!session) continue;
    const ttl = (policy.policies?.[session.actor_type]?.ttl_ms) || policy.default_ttl_ms;
    const hbAge = now - new Date(session.last_heartbeat || 0).getTime();
    if (hbAge > ttl) continue;
    out.push(session);
  }
  return out;
}

function recentCommits(branch) {
  try {
    const raw = execSync(
      `git log -n ${COMMIT_TAIL} --pretty=format:%H%x09%s ${branch} -- 2>/dev/null`,
      { cwd: PROJECT_ROOT, encoding: 'utf8' }
    );
    return raw.split('\n').filter(Boolean).map(l => {
      const [sha, ...rest] = l.split('\t');
      return { sha: sha.slice(0, 12), subject: rest.join('\t') };
    });
  } catch { return []; }
}

function loadLedgerTail() {
  if (!fs.existsSync(LEDGER_PATH)) return [];
  const lines = fs.readFileSync(LEDGER_PATH, 'utf8').trim().split('\n');
  const tail = lines.slice(-LEDGER_TAIL);
  return tail.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function loadLiveSignals() {
  const out = [];
  try {
    for (const f of fs.readdirSync(SIGNALS_DIR)) {
      if (!f.endsWith('.json')) continue;
      const s = readJSON(path.join(SIGNALS_DIR, f));
      if (s && s.lifecycle_state === 'live') out.push({ file: f, signal: s });
    }
  } catch { /* signals dir may not exist */ }
  return out;
}

function loadMemoryIndex() {
  // Lightweight index: filename + frontmatter name/description only.
  // Bodies stay on disk; we only score against names + descriptions for cheapness.
  const out = [];
  try {
    for (const f of fs.readdirSync(MEMORY_DIR)) {
      if (f === 'MEMORY.md' || !f.endsWith('.md')) continue;
      const head = fs.readFileSync(path.join(MEMORY_DIR, f), 'utf8').slice(0, 1000);
      const nameMatch = head.match(/\nname:\s*(.+)/);
      const descMatch = head.match(/\ndescription:\s*(.+)/);
      out.push({
        file: f,
        name: nameMatch ? nameMatch[1].trim() : f,
        description: descMatch ? descMatch[1].trim() : ''
      });
    }
  } catch { /* memory dir may not exist */ }
  return out;
}

function decayWeight(tsIso, noDecay) {
  if (noDecay) return 1.0;
  if (!tsIso) return 0.5;
  const ageHours = (nowMs() - new Date(tsIso).getTime()) / 3600000;
  if (ageHours < 0) return 1.0;
  return Math.pow(0.5, ageHours / DECAY_HALFLIFE_HOURS);
}

function overlapScore(sessionTokens, candidateTokens) {
  if (!candidateTokens.length) return 0;
  const sset = new Set(sessionTokens);
  let hits = 0;
  for (const t of candidateTokens) if (sset.has(t)) hits++;
  // Normalize by candidate length so short candidates aren't over-rewarded
  return hits / Math.sqrt(candidateTokens.length);
}

function buildSessionTokens(session) {
  const tokens = [];
  if (session.current_branch) tokens.push(...tokenize(session.current_branch));
  if (Array.isArray(session.working_surface)) {
    for (const s of session.working_surface) tokens.push(...tokenize(s));
  }
  for (const c of recentCommits(session.current_branch || 'HEAD')) {
    tokens.push(...tokenize(c.subject));
  }
  return tokens;
}

function loadHitHistory(sid) {
  const p = path.join(HINTS_DIR, `${sid}.history.jsonl`);
  if (!fs.existsSync(p)) return new Set();
  const lines = fs.readFileSync(p, 'utf8').trim().split('\n').slice(-HIT_HISTORY_KEEP);
  const ids = new Set();
  for (const l of lines) {
    try { ids.add(JSON.parse(l).hit_id); } catch { /* skip */ }
  }
  return ids;
}

function appendHistory(sid, hitIds) {
  if (!hitIds.length) return;
  const p = path.join(HINTS_DIR, `${sid}.history.jsonl`);
  const lines = hitIds.map(id => JSON.stringify({ hit_id: id, ts: new Date().toISOString() }) + '\n').join('');
  fs.appendFileSync(p, lines);
}

function hitId(source, ref) {
  return crypto.createHash('sha1').update(`${source}|${ref}`).digest('hex').slice(0, 12);
}

function scoreSession(session, ledger, signals, memories, args) {
  const sessionTokens = buildSessionTokens(session);
  if (!sessionTokens.length) return [];

  const seen = args.no_suppress ? new Set() : loadHitHistory(session.session_id);
  const hits = [];

  for (const e of ledger) {
    const candText = [e.memory_file, e.notes, e.source_artifact, e.anchor_ref].filter(Boolean).join(' ');
    const ctok = tokenize(candText);
    const raw = overlapScore(sessionTokens, ctok);
    if (raw === 0) continue;
    const score = raw * decayWeight(e.ts, args.no_decay);
    const id = hitId('ledger', e.event_id);
    if (seen.has(id)) continue;
    hits.push({ hit_id: id, source: 'ledger', ref: e.memory_file, score, label: e.notes ? `${e.event}: ${e.notes.slice(0, 80)}` : e.event });
  }

  for (const { file, signal } of signals) {
    const candText = [signal.scope, signal.request].filter(Boolean).join(' ');
    const ctok = tokenize(candText);
    const raw = overlapScore(sessionTokens, ctok);
    if (raw === 0) continue;
    const score = raw * decayWeight(signal.timestamp, args.no_decay) * 1.5; // live-signal bonus
    const id = hitId('signal', file);
    if (seen.has(id)) continue;
    hits.push({ hit_id: id, source: 'signal', ref: file, score, label: (signal.scope || '').slice(0, 80) });
  }

  for (const m of memories) {
    const candText = [m.name, m.description].filter(Boolean).join(' ');
    const ctok = tokenize(candText);
    const raw = overlapScore(sessionTokens, ctok);
    if (raw === 0) continue;
    const score = raw * 0.7; // memories are stable; modest weight, no decay
    const id = hitId('memory', m.file);
    if (seen.has(id)) continue;
    hits.push({ hit_id: id, source: 'memory', ref: m.file, score, label: m.description.slice(0, 80) });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, TOP_K_OUTPUT);
}

function writeHints(sid, hits) {
  if (!fs.existsSync(HINTS_DIR)) fs.mkdirSync(HINTS_DIR, { recursive: true });
  const tier0Path = path.join(HINTS_DIR, `${sid}.tier0.jsonl`);
  const ts = new Date().toISOString();
  const lines = hits.map(h => JSON.stringify({ ts, ...h }) + '\n').join('');
  if (lines) fs.appendFileSync(tier0Path, lines);

  // Glanceable summary file (last-write-wins)
  const summaryPath = path.join(HINTS_DIR, `${sid}.tier0.txt`);
  const summary = [
    `# tier0 contextual hints — ${sid}`,
    `# swept ${ts} — ${hits.length} hits, top ${Math.min(hits.length, TOP_K_OUTPUT)}`,
    '',
    ...hits.map(h => `${h.score.toFixed(3)}  ${h.source.padEnd(7)}  ${h.ref.padEnd(50).slice(0, 50)}  ${h.label || ''}`)
  ].join('\n') + '\n';
  fs.writeFileSync(summaryPath, summary);

  appendHistory(sid, hits.map(h => h.hit_id));
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { help(); return; }

  const sessions = loadFreshSessions(args.session_id);
  if (!sessions.length) {
    if (args.json) console.log(JSON.stringify({ swept: 0, sessions: [] }));
    else console.log('no fresh active sessions');
    return;
  }

  const ledger = loadLedgerTail();
  const signals = loadLiveSignals();
  const memories = loadMemoryIndex();

  const report = { swept_at: new Date().toISOString(), sessions: [] };
  for (const s of sessions) {
    const hits = scoreSession(s, ledger, signals, memories, args);
    report.sessions.push({ session_id: s.session_id, branch: s.current_branch, actor_type: s.actor_type, hits });
    if (!args.dry_run) writeHints(s.session_id, hits);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const s of report.sessions) {
      console.log(`\n=== ${s.session_id} (${s.actor_type}) on ${s.branch} — ${s.hits.length} hits ===`);
      for (const h of s.hits) {
        console.log(`  ${h.score.toFixed(3)}  ${h.source.padEnd(7)}  ${h.ref.padEnd(50).slice(0, 50)}  ${(h.label || '').slice(0, 60)}`);
      }
    }
  }
}

main();
