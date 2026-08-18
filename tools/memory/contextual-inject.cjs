#!/usr/bin/env node
'use strict';

/**
 * contextual-inject.cjs — SessionStart hook companion to contextual-sweep.js.
 *
 * Reads _dev/state/contextual-hints/<sid>.tier0.txt and emits a glanceable
 * Tier 0 hint summary to stdout, where the Claude Code SessionStart hook
 * surface routes it into the conversation.
 *
 * Plan: _dev/reports/analysis/task-plans/auto-injection-hook-for-contextual-mind-tier0__plan.json
 *
 * Output contract (5 elements, in this exact order):
 *   1. Header line — partial-coverage notice
 *   2. Generation timestamp from hint file mtime, ISO 8601
 *   3. Top --max-hits hits with source tags
 *   4. Closing notice line — `-- end Tier 0 (partial coverage) --`
 *   5. Trailing blank line
 *
 * Clean-exit no-op: prints `contextual-inject: no hints for this session.`
 *
 * Idempotency: writes _dev/state/contextual-hints/<sid>.injected.txt with an
 * explicit-fields JSON object (output_template_version, source_hint_path,
 * source_hint_mtime_iso, source_hint_sha256, max_hits, generated_at_iso,
 * content_sha256). Skip re-emit only when ALL of {source_hint_sha256, max_hits,
 * output_template_version} match the previous emission. Dry-run is read-only.
 *
 * Stdlib-only (no npm install). Exit 0 always.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const ACTIVE_SESSIONS_DIR = path.join(PROJECT_ROOT, '_dev/state/active-sessions');
const HINTS_DIR = path.join(PROJECT_ROOT, '_dev/state/contextual-hints');
const DREAM_REPORT_PATH = path.join(PROJECT_ROOT, '_dev/state/memory-db/dream-report.md');
const OUTPUT_TEMPLATE_VERSION = '2';
const HEADER_LINE = 'Tier 0 (token-match only, partial coverage). Run /context-check for manual sweep.';
const CLOSING_LINE = '-- end Tier 0 (partial coverage) --';
const NO_OP_LINE = 'contextual-inject: no hints for this session.';
const DREAM_HEADER = 'Dreams (non-obvious associative connections — bridged purely by shared rare vocabulary):';

function parseFlags(argv) {
  const args = { max_hits: 10, max_dreams: 10, session_id: null, dry_run: false, verbose: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--max-hits') {
      args.max_hits = parseInt(argv[++i], 10);
      if (!Number.isFinite(args.max_hits) || args.max_hits < 0) args.max_hits = 10;
    } else if (a === '--max-dreams') {
      args.max_dreams = parseInt(argv[++i], 10);
      if (!Number.isFinite(args.max_dreams) || args.max_dreams < 0) args.max_dreams = 10;
    } else if (a === '--session-id') {
      args.session_id = argv[++i] || null;
    } else if (a === '--dry-run') {
      args.dry_run = true;
    } else if (a === '--verbose') {
      args.verbose = true;
    }
  }
  return args;
}

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function currentBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim();
  } catch { return null; }
}

/**
 * Resolve session_id mirroring /context-check + contextual-sweep.js logic:
 *   1. If --session-id flag passed, use it.
 *   2. Else read _dev/state/active-sessions/_current-id (set by /new-session).
 *   3. Else branch-match active-sessions/<sid>.json by current_branch, newest
 *      last_heartbeat wins.
 *   4. Else null (no-op).
 */
function resolveSessionId(override, verbose) {
  if (override) return override;

  // TTL-liveness check on the _current-id sidecar (repair R2, 2026-08-18):
  // mirror resolve-session-id.cjs, which only trusts a sidecar whose target is
  // a live registry session. A stale sidecar (env-less harness, e.g. codewhale,
  // leaves _current-id pointing at a previous session) must fall through to the
  // branch-match rung below, where the heartbeat registered at session open
  // (session-start-cross-session-consumer.cjs) wins. Without this check, dreams
  // resolve to a dead sid and the tier0 surface stays silent.
  const currentIdPath = path.join(ACTIVE_SESSIONS_DIR, '_current-id');
  if (fs.existsSync(currentIdPath)) {
    const sid = fs.readFileSync(currentIdPath, 'utf8').trim();
    if (sid && isLiveRegistrySession(sid)) {
      if (verbose) process.stderr.write(`contextual-inject: resolved sid via _current-id: ${sid}\n`);
      return sid;
    }
    if (verbose && sid) {
      process.stderr.write(`contextual-inject: _current-id ${sid} not TTL-live; falling through to branch match\n`);
    }
  }

  const branch = currentBranch();
  if (!branch) return null;

  let entries;
  try { entries = fs.readdirSync(ACTIVE_SESSIONS_DIR); } catch { return null; }
  let best = null;
  for (const f of entries) {
    if (!/^[0-9a-f-]{36}\.json$/.test(f)) continue;
    const s = readJSON(path.join(ACTIVE_SESSIONS_DIR, f));
    if (!s || s.current_branch !== branch) continue;
    const hb = new Date(s.last_heartbeat || 0).getTime();
    if (!best || hb > best.hb) best = { sid: s.session_id, hb };
  }
  if (verbose && best) process.stderr.write(`contextual-inject: resolved sid via branch-match: ${best.sid}\n`);
  return best ? best.sid : null;
}

/**
 * True when the session id names a TTL-live active-session registry entry
 * (_dev/state/active-sessions/<sid>.json with a fresh last_heartbeat). Mirrors
 * resolve-session-id.cjs's isRegistryLive(). Fail-closed: any read error means
 * "not live", so a stale sidecar can never win over the branch-match rung.
 */
function isLiveRegistrySession(sessionId) {
  if (!sessionId) return false;
  try {
    const registry = require(path.join(PROJECT_ROOT, 'tools/sessions/lib/active-session-registry.js'));
    const active = registry.listActive({});
    return active.some((s) => String(s.session_id) === String(sessionId));
  } catch (_) {
    return false;
  }
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function readPriorIdempotency(injectedPath) {
  if (!fs.existsSync(injectedPath)) return null;
  try { return JSON.parse(fs.readFileSync(injectedPath, 'utf8')); } catch { return null; }
}

/**
 * Parse the persisted .tier0.txt summary into hit lines. Format produced by
 * contextual-sweep.js writeHints():
 *   # tier0 contextual hints — <sid>
 *   # swept <ts> — N hits, top K
 *   <blank>
 *   <score>  <source>  <ref-padded>  <label>
 *   ...
 */
function parseHintFile(text) {
  const lines = text.split('\n');
  const hits = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.startsWith('#')) continue;
    // score is leading float; rest is score|source|ref|label, all padded
    const m = line.match(/^(\d+\.\d+)\s+(\S+)\s+(.+)$/);
    if (!m) continue;
    const score = m[1];
    const source = m[2];
    // Rest is "<ref-padded-50>  <label>" — split on 2+ spaces after the ref's
    // significant content. The padded ref is exactly 50 chars then 2 spaces.
    const tail = m[3];
    let ref, label;
    if (tail.length > 52) {
      ref = tail.slice(0, 50).trim();
      label = tail.slice(52).trim();
    } else {
      ref = tail.trim();
      label = '';
    }
    hits.push({ score, source, ref, label });
  }
  return hits;
}

function formatHitLine(h) {
  const tag = `[${h.source}]`;
  const ref = h.ref;
  const label = h.label ? `  ${h.label}` : '';
  return `  ${h.score}  ${tag.padEnd(9)} ${ref}${label}`;
}

/**
 * Parse dream-report.md and extract non-obvious dream pairs.
 * Returns array of {left, right, shared_terms, score} or empty.
 */
function parseDreamReport() {
  if (!fs.existsSync(DREAM_REPORT_PATH)) return [];
  const text = fs.readFileSync(DREAM_REPORT_PATH, 'utf8');
  const dreams = [];

  // Find the "Most non-obvious" section
  const nonObviousIdx = text.indexOf('## Most non-obvious');
  if (nonObviousIdx === -1) return [];

  // Find the next top-level heading after this section to bound it
  const nextHeadingIdx = text.indexOf('\n## ', nonObviousIdx + 1);
  const section = nextHeadingIdx !== -1
    ? text.slice(nonObviousIdx, nextHeadingIdx)
    : text.slice(nonObviousIdx);

  // Parse entries like:
  // 1. **[11.1]** memory *Foo* ⟷ concept *Bar*
  //    - basis: shared rare terms 'a'+'b'+'c'
  const entryRe = /^(\d+)\.\s+\*\*\[([\d.]+)\]\*\*\s+(memory|concept)\s+\*([^*]+)\*\s+⟷\s+(memory|concept)\s+\*([^*]+)\*/gm;
  let m;
  while ((m = entryRe.exec(section)) !== null) {
    const score = m[2];
    const leftType = m[3];
    const leftName = m[4].trim();
    const rightType = m[5];
    const rightName = m[6].trim();

    // Find the basis line after this entry
    const afterEntry = section.indexOf('\n', m.index + m[0].length);
    const nextLine = section.slice(afterEntry);
    const basisMatch = nextLine.match(/^\s*-\s*basis:\s*shared rare terms\s+(.+)$/m);
    const sharedTerms = basisMatch ? basisMatch[1].trim() : '';

    dreams.push({
      score,
      left: `${leftType} ${leftName}`,
      right: `${rightType} ${rightName}`,
      shared_terms: sharedTerms.replace(/^'|'$/g, '').replace(/'\+'/g, ', ')
    });
  }

  return dreams;
}

function formatDreamLine(d, idx) {
  const tag = '[dream]';
  const desc = `${d.left} ⟷ ${d.right}`;
  const basis = d.shared_terms ? ` — shared: ${d.shared_terms}` : '';
  return `  ${tag.padEnd(9)} ${desc}${basis}`;
}

function buildOutput(hits, maxHits, hintMtimeIso, dreams, maxDreams) {
  const top = hits.slice(0, maxHits);
  const out = [];
  out.push(HEADER_LINE);
  out.push(`Generated: ${hintMtimeIso} (hint file mtime; ${top.length} of ${hits.length} hits shown)`);
  for (const h of top) out.push(formatHitLine(h));

  // Dream section
  if (dreams && dreams.length > 0) {
    out.push('');
    out.push(DREAM_HEADER);
    const topDreams = dreams.slice(0, maxDreams);
    for (let i = 0; i < topDreams.length; i++) {
      out.push(formatDreamLine(topDreams[i], i + 1));
    }
  }

  out.push(CLOSING_LINE);
  out.push(''); // trailing blank line
  return out.join('\n');
}

function main() {
  const args = parseFlags(process.argv);

  const sid = resolveSessionId(args.session_id, args.verbose);
  if (!sid) {
    process.stdout.write(NO_OP_LINE + '\n');
    return;
  }

  const hintPath = path.join(HINTS_DIR, `${sid}.tier0.txt`);
  if (!fs.existsSync(hintPath)) {
    process.stdout.write(NO_OP_LINE + '\n');
    return;
  }

  const hintBuf = fs.readFileSync(hintPath);
  const hintText = hintBuf.toString('utf8');
  const hintStat = fs.statSync(hintPath);
  const hintMtimeIso = hintStat.mtime.toISOString();
  const sourceHintSha256 = sha256(hintBuf);

  const hits = parseHintFile(hintText);

  // Parse dreams (always attempt; no-op if dream report is missing).
  const dreams = parseDreamReport();

  if (!hits.length && !dreams.length) {
    process.stdout.write(NO_OP_LINE + '\n');
    return;
  }

  // Idempotency check (per plan S2): when {source_hint_sha256, max_hits,
  // max_dreams, output_template_version} all unchanged, do NOT re-emit.
  // Print a visible already-injected no-op line instead so the SessionStart
  // hook output is still observable but doesn't duplicate hints into context.
  const injectedPath = path.join(HINTS_DIR, `${sid}.injected.txt`);
  if (!args.dry_run) {
    const prior = readPriorIdempotency(injectedPath);
    if (
      prior &&
      prior.output_template_version === OUTPUT_TEMPLATE_VERSION &&
      prior.source_hint_sha256 === sourceHintSha256 &&
      prior.max_hits === args.max_hits &&
      prior.max_dreams === args.max_dreams
    ) {
      process.stdout.write('contextual-inject: hints already injected for this session.\n');
      return;
    }
  }

  const output = buildOutput(hits, args.max_hits, hintMtimeIso, dreams, args.max_dreams);
  process.stdout.write(output);

  if (!args.dry_run) {
    const record = {
      output_template_version: OUTPUT_TEMPLATE_VERSION,
      source_hint_path: path.relative(PROJECT_ROOT, hintPath),
      source_hint_mtime_iso: hintMtimeIso,
      source_hint_sha256: sourceHintSha256,
      max_hits: args.max_hits,
      max_dreams: args.max_dreams,
      generated_at_iso: new Date().toISOString(),
      content_sha256: sha256(Buffer.from(output, 'utf8'))
    };
    try {
      if (!fs.existsSync(HINTS_DIR)) fs.mkdirSync(HINTS_DIR, { recursive: true });
      fs.writeFileSync(injectedPath, JSON.stringify(record, null, 2) + '\n');
    } catch (e) {
      if (args.verbose) process.stderr.write(`contextual-inject: idempotency-write failed: ${e.message}\n`);
    }
  }
}

try {
  main();
} catch (e) {
  // Never break SessionStart. Print a single visible diagnostic.
  process.stdout.write(`contextual-inject: error (${e.message})\n`);
}
