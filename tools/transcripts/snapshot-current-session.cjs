#!/usr/bin/env node
/**
 * snapshot-current-session.cjs — Save the current Claude Code session JSONL
 * into _dev/desktop/work/personal/turns/ on every invocation.
 *
 * Wired as a Stop hook so each turn produces a snapshot. Per-turn snapshots
 * are append-only with timestamped filenames; if any actor rewrites the
 * source JSONL after the fact, prior snapshots remain intact (erasure
 * resistance).
 *
 * Hook input format (from Claude Code):
 *   stdin contains JSON with `session_id`, `transcript_path`, `cwd`, etc.
 *
 * Output: writes a snapshot at:
 *   _dev/desktop/work/personal/turns/<session-id>__<ts>.jsonl
 *
 * Exit codes:
 *   0 — snapshot written or non-applicable (no session JSONL found)
 *   never blocks the turn (best-effort capture)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SNAPSHOT_DIR = path.join(REPO_ROOT, '_dev', 'desktop', 'work', 'personal', 'turns');

function readHookPayload() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

// Claude Code names each project's transcript directory after the absolute
// cwd path with path separators (and underscores/dots) replaced by dashes.
// Derive it from cwd instead of hardcoding one operator's path.
function projectTranscriptDir(cwd = process.cwd()) {
  return path.join(require('os').homedir(), '.claude', 'projects', cwd.replace(/[\/_.]/g, '-'));
}

function findSessionJsonl(payload) {
  // Prefer hook-provided transcript_path
  if (payload && payload.transcript_path && fs.existsSync(payload.transcript_path)) {
    return payload.transcript_path;
  }
  // Fall back: most recently modified JSONL under this project's claude session dir
  const projectsDir = (payload && payload.cwd) ? projectTranscriptDir(payload.cwd) : projectTranscriptDir();
  if (!fs.existsSync(projectsDir)) return null;
  const candidates = fs.readdirSync(projectsDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => {
      const full = path.join(projectsDir, f);
      return { full, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return candidates.length ? candidates[0].full : null;
}

function isoStamp() {
  const d = new Date();
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function snapshotCurrentSession(payload) {
  try {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  } catch (err) {
    return null;
  }

  const src = findSessionJsonl(payload);
  if (!src) {
    return null; // best-effort; don't block turn
  }

  const sessionId = (payload && payload.session_id) || path.basename(src, '.jsonl');
  const ts = isoStamp();
  const dest = path.join(SNAPSHOT_DIR, `${sessionId}__${ts}.jsonl`);

  try {
    fs.copyFileSync(src, dest);
  } catch (err) {
    // Best effort. Do not block.
    return null;
  }

  return dest;
}

function main() {
  snapshotCurrentSession(readHookPayload());
}

module.exports = {
  SNAPSHOT_DIR,
  findSessionJsonl,
  isoStamp,
  readHookPayload,
  snapshotCurrentSession
};

if (require.main === module) {
  main();
}
