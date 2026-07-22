#!/usr/bin/env node
'use strict';

/**
 * post-write-note.cjs — minimal working demonstration of a post-write hook.
 *
 * This is a STUB, not a port of the private post-write-concept.cjs. It shows
 * only the generic shape of the pattern described in README.md: a session
 * lifecycle hook fires after a file write, checks the written path against a
 * glob-like pattern, and — if it matches — logs a short note about the event
 * to a local pending directory. No dispatch to any external actor, no
 * signal-matching, no suppression channels: just detect-and-note.
 *
 * Usage (mirrors how a harness would invoke a PostToolUse hook):
 *   echo '{"tool_input":{"file_path":"/abs/path/to/notes/idea.md"}}' \
 *     | node post-write-note.cjs
 *
 * Env:
 *   MYTHOS_PROJECT_DIR   - project root (default: process.cwd())
 *   MYTHOS_NOTE_PATTERN  - glob-ish pattern the written path must match,
 *                          relative to the project root
 *                          (default: 'notes/*.md' — top-level only, no
 *                          subdirectories, mirroring the source hook's
 *                          top-level-only concept match)
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.env.MYTHOS_PROJECT_DIR || process.cwd();
const NOTE_PATTERN = process.env.MYTHOS_NOTE_PATTERN || 'notes/*.md';
const PENDING_DIR = path.join(PROJECT_ROOT, '_dev', 'state', 'post-write-pending');

function readStdinSync() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function tryParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function extractFilePath(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (payload.tool_input && payload.tool_input.file_path) {
    return String(payload.tool_input.file_path);
  }
  if (payload.file_path) return String(payload.file_path);
  return '';
}

function resolveFilePath(payload) {
  const f = extractFilePath(payload || tryParse(readStdinSync()));
  if (!f) return '';
  return path.isAbsolute(f) ? f : path.resolve(PROJECT_ROOT, f);
}

/**
 * Compile a simple glob (only `*` as "any characters except /" is
 * supported) into a RegExp anchored to the whole string. Deliberately
 * minimal — swap in a real glob library for production use.
 */
function globToRegExp(glob) {
  const escaped = glob
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*');
  return new RegExp(`^${escaped}$`);
}

function matchesPattern(absPath, pattern) {
  const rel = path.relative(PROJECT_ROOT, absPath);
  return globToRegExp(pattern).test(rel);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Write a small JSON note recording that a matching write happened.
 * This is the entire "follow-up action" in this stub — a real hook would
 * dispatch to some external process instead.
 */
function writeNote(relPath) {
  ensureDir(PENDING_DIR);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = path.basename(relPath).replace(/[^a-zA-Z0-9._-]/g, '_');
  const notePath = path.join(PENDING_DIR, `${ts}__${slug}.json`);
  const note = {
    schema: 'PostWriteNote/1.0',
    timestamp: new Date().toISOString(),
    path: relPath,
    pattern: NOTE_PATTERN
  };
  const tmp = notePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(note, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, notePath);
  return notePath;
}

function main(payload) {
  const filePath = resolveFilePath(payload);
  if (!filePath) return;
  if (!fs.existsSync(filePath)) return;
  if (!matchesPattern(filePath, NOTE_PATTERN)) return;

  const relPath = path.relative(PROJECT_ROOT, filePath);
  const notePath = writeNote(relPath);
  process.stdout.write(
    `post-write-note: matched ${relPath} (pattern "${NOTE_PATTERN}"), wrote ${path.relative(PROJECT_ROOT, notePath)}\n`
  );
}

module.exports = {
  extractFilePath,
  globToRegExp,
  main,
  matchesPattern,
  resolveFilePath,
  tryParse,
  writeNote
};

if (require.main === module) {
  main();
}
