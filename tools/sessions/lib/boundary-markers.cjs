'use strict';

// Per-scope session-boundary marker contract.
//
// Problem this solves: the original implementation used ONE shared file
// (_dev/state/session-boundary-pending.json) carrying a single scope. Two
// client sessions crossing concurrently clobbered each other's marker, and the
// SessionStart consumer auto-consumed whatever single marker existed regardless
// of which scope the new session intended to resume. That made "resume any
// client scope" impossible.
//
// Fix: one marker file PER SCOPE under _dev/state/session-boundary/pending/.
// Multiple crossings coexist. The consumer LISTS all pending scopes
// (non-destructive); consumption is explicit and per-scope, so the operator
// resumes exactly the scope they want. The legacy single-file marker is
// migrated in on first read for backward compatibility.
//
// Concept: _dev/concepts/cross-session-substrate-crossing.md (scope-validated,
// non-colliding markers were always the intended design).

const fs = require('fs');
const path = require('path');
const { resolveCanonicalRoot } = require('../../lib/canonical-root.cjs');

const SCHEMA = 'SessionBoundary/1.0';
const REQUIRED_FIELDS = ['schema', 'scope', 'handoff_path', 'recommended_next_command'];

function paths(rootOpts) {
  // Tests (and other callers that already know the root) may inject it via
  // { root: '/abs/path' }; production callers pass { mode: 'hard' } and the
  // canonical resolver is the single source of truth.
  const opts = rootOpts || { mode: 'hard' };
  const PROJECT_ROOT = opts.root ? opts.root : resolveCanonicalRoot(opts);
  const STATE_DIR = path.join(PROJECT_ROOT, '_dev', 'state');
  return {
    PROJECT_ROOT,
    STATE_DIR,
    PENDING_DIR: path.join(STATE_DIR, 'session-boundary', 'pending'),
    CONSUMED_DIR: path.join(STATE_DIR, 'session-boundary-consumed'),
    LEGACY_MARKER: path.join(STATE_DIR, 'session-boundary-pending.json'),
  };
}

function tryParse(s) { try { return JSON.parse(s); } catch { return null; } }

function isValid(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.schema !== SCHEMA) return false;
  return REQUIRED_FIELDS.every((f) => typeof payload[f] === 'string' && payload[f].length > 0);
}

// Stable, filesystem-safe slug for a scope. Preserves case + client code:
//   "client:ACME" -> "client-ACME", "--system" -> "system", "system" -> "system".
function slugForScope(scope) {
  const raw = String(scope || '').trim().replace(/^--/, '');
  const slug = raw.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'unknown';
}

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }

// Atomic per-scope write (temp + JSON.parse-validate + rename). Returns the
// marker path. Throws on invalid payload — callers must pass a complete marker.
function writeMarker(payload, rootOpts) {
  if (!isValid(payload)) {
    throw new Error(`boundary marker invalid: needs ${REQUIRED_FIELDS.join(', ')} and schema=${SCHEMA}`);
  }
  const P = paths(rootOpts);
  ensureDir(P.PENDING_DIR);
  const slug = slugForScope(payload.scope);
  const finalPath = path.join(P.PENDING_DIR, `${slug}.json`);
  const tmpPath = path.join(P.PENDING_DIR, `.${slug}.${process.pid}.tmp`);
  const body = JSON.stringify({ ...payload, written_at: payload.written_at || new Date().toISOString() }, null, 2);
  fs.writeFileSync(tmpPath, body);
  // Validate what we just wrote before swapping it into place.
  const roundtrip = tryParse(fs.readFileSync(tmpPath, 'utf8'));
  if (!isValid(roundtrip)) { fs.unlinkSync(tmpPath); throw new Error('boundary marker failed roundtrip validation'); }
  fs.renameSync(tmpPath, finalPath);
  return finalPath;
}

// Migrate a legacy single-file marker into the per-scope dir. If a per-scope
// marker already exists for that scope, the legacy one is archived as superseded
// rather than clobbering. Returns the action taken (for logging/tests).
function migrateLegacy(rootOpts) {
  const P = paths(rootOpts);
  if (!fs.existsSync(P.LEGACY_MARKER)) return { migrated: false };
  const payload = tryParse(fs.readFileSync(P.LEGACY_MARKER, 'utf8'));
  if (!isValid(payload)) return { migrated: false, reason: 'legacy-malformed' };
  ensureDir(P.PENDING_DIR);
  const slug = slugForScope(payload.scope);
  const finalPath = path.join(P.PENDING_DIR, `${slug}.json`);
  if (fs.existsSync(finalPath)) {
    // Don't clobber a newer per-scope marker; archive the legacy one.
    ensureDir(P.CONSUMED_DIR);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    fs.renameSync(P.LEGACY_MARKER, path.join(P.CONSUMED_DIR, `${ts}__legacy-superseded__${slug}.json`));
    return { migrated: false, reason: 'superseded', scope: payload.scope };
  }
  fs.renameSync(P.LEGACY_MARKER, finalPath);
  return { migrated: true, scope: payload.scope, path: finalPath };
}

// Read the per-scope pending dir (no migration, no writes). Internal helper.
function readPendingDir(rootOpts) {
  const P = paths(rootOpts);
  if (!fs.existsSync(P.PENDING_DIR)) return [];
  const out = [];
  for (const name of fs.readdirSync(P.PENDING_DIR)) {
    if (!name.endsWith('.json') || name.startsWith('.')) continue;
    const full = path.join(P.PENDING_DIR, name);
    const payload = tryParse(fs.readFileSync(full, 'utf8'));
    if (!isValid(payload)) continue;
    out.push({ scope: payload.scope, path: full, payload, mtimeMs: fs.statSync(full).mtimeMs });
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

// All pending markers (per-scope dir), newest first. Migrates legacy first by
// default. Pass { migrateLegacy: false } for a strictly read-only listing (no
// legacy rename) — used by advisory-only callers like the boot reaper.
function listPending(rootOpts, opts) {
  if (!opts || opts.migrateLegacy !== false) migrateLegacy(rootOpts);
  return readPendingDir(rootOpts);
}

// Strictly READ-ONLY view of the pending surface. NEVER migrates or moves the
// legacy single-file marker — if one exists it is surfaced in place as a
// read-only entry (legacy: true) at its current path, so advisory callers can
// SEE it without absorbing it. Use this from any scan that must not mutate.
function peekPending(rootOpts) {
  const P = paths(rootOpts);
  const out = readPendingDir(rootOpts);
  if (fs.existsSync(P.LEGACY_MARKER)) {
    const payload = tryParse(fs.readFileSync(P.LEGACY_MARKER, 'utf8'));
    if (isValid(payload)) {
      out.push({ scope: payload.scope, path: P.LEGACY_MARKER, payload, mtimeMs: fs.statSync(P.LEGACY_MARKER).mtimeMs, legacy: true });
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

// Normalize a scope string for fuzzy comparison: lowercase, collapse the
// separator variants (':' '_' '-') to a single canonical separator.
function normalizeScope(scope) {
  return String(scope || '').trim().toLowerCase().replace(/[:_-]+/g, '-').replace(/^-+|-+$/g, '');
}

// Read-only scope resolution. NEVER consumes. Returns:
//   { status: 'exact', marker } — requested scope (or its slug) matches a
//     pending marker's scope exactly (current writeMarker/consume behavior).
//   { status: 'not_found', candidates } — no exact match; candidates are the
//     pending markers ranked by similarity to the request, each carrying the
//     exact consume command an operator/caller would need to run.
function resolveScope(requestedScope, rootOpts) {
  const pending = listPending(rootOpts);
  const requestedSlug = slugForScope(requestedScope);
  const exact = pending.find((m) => (
    m.scope === requestedScope || slugForScope(m.scope) === requestedSlug
  ));
  if (exact) return { status: 'exact', marker: exact };

  const normRequested = normalizeScope(requestedScope);
  const candidates = pending
    .map((m) => {
      const normCandidate = normalizeScope(m.scope);
      let rank;
      let score_reason;
      if (normCandidate === normRequested) {
        rank = 0;
        score_reason = 'normalized-equal (separator variant only)';
      } else if (normCandidate.startsWith(normRequested) || normRequested.startsWith(normCandidate)) {
        rank = 1;
        score_reason = 'prefix match';
      } else if (
        normCandidate.includes(normRequested) ||
        normRequested.includes(normCandidate) ||
        normCandidate.split('-').some((tok) => tok && normRequested.split('-').includes(tok))
      ) {
        rank = 2;
        score_reason = 'substring/token overlap';
      } else {
        rank = 3;
        score_reason = 'no overlap';
      }
      return {
        scope: m.scope,
        score_reason,
        consume_command: `node tools/sessions/consume-boundary.cjs ${m.scope}`,
        _rank: rank,
      };
    })
    .sort((a, b) => a._rank - b._rank)
    .map(({ _rank, ...rest }) => rest);

  return { status: 'not_found', candidates };
}

// Consume (archive) exactly the marker for one scope. Other scopes untouched.
function consume(scope, rootOpts) {
  const P = paths(rootOpts);
  const slug = slugForScope(scope);
  const markerPath = path.join(P.PENDING_DIR, `${slug}.json`);
  if (!fs.existsSync(markerPath)) return null;
  const payload = tryParse(fs.readFileSync(markerPath, 'utf8'));
  ensureDir(P.CONSUMED_DIR);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const consumedPath = path.join(P.CONSUMED_DIR, `${ts}__${slug}.json`);
  fs.writeFileSync(consumedPath, JSON.stringify({ ...(payload || {}), consumed_at: new Date().toISOString() }, null, 2));
  fs.unlinkSync(markerPath);
  return consumedPath;
}

module.exports = {
  SCHEMA, REQUIRED_FIELDS, paths, isValid, slugForScope,
  writeMarker, migrateLegacy, listPending, peekPending, consume, resolveScope,
};
