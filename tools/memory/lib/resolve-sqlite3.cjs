'use strict';

/**
 * resolve-sqlite3.cjs — cross-platform sqlite3 CLI binary resolver.
 *
 * The memory tooling (build-memory-db, build-entity-mocs, agent-state) shells out
 * to the `sqlite3` CLI. macOS/Linux find it via `which`; Windows uses `where` and
 * never ships it at /usr/bin. This resolver finds the binary on any platform, or
 * returns null so callers can use their JSONL fallback.
 *
 * Resolution order:
 *   1. env override MYTHOS_SQLITE3 (absolute path to the binary)
 *   2. platform lookup: `where sqlite3` on win32, else `which sqlite3`
 *   3. common absolute install locations per platform
 *   4. null  → caller should degrade to the JSONL store
 *
 * Result is memoized per process. Node stdlib only.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const isWin = process.platform === 'win32';
const EXE = isWin ? 'sqlite3.exe' : 'sqlite3';

const COMMON_PATHS = isWin
  ? [
      // scoop, choco, winget, manual installs
      path.join(process.env.USERPROFILE || '', 'scoop', 'shims', 'sqlite3.exe'),
      'C\\:\\ProgramData\\chocolatey\\bin\\sqlite3.exe'.replace(/\\:/g, ':'),
      'C:\\Program Files\\sqlite3\\sqlite3.exe',
      'C:\\sqlite3\\sqlite3.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'sqlite3.exe'),
    ]
  : [
      '/opt/homebrew/bin/sqlite3', // Apple Silicon Homebrew
      '/usr/local/bin/sqlite3', // Intel Homebrew / Linux local
      '/usr/bin/sqlite3', // macOS system / most Linux
      '/bin/sqlite3',
    ];

let _cached; // undefined = not resolved yet; null/string = resolved

function resolveSqlite3() {
  if (_cached !== undefined) return _cached;
  _cached = doResolve();
  return _cached;
}

function looksRunnable(p) {
  try {
    return !!p && fs.existsSync(p) && fs.statSync(p).isFile();
  } catch (_) {
    return false;
  }
}

function doResolve() {
  // 1. explicit override
  const override = process.env.MYTHOS_SQLITE3;
  if (override && looksRunnable(override)) return override;

  // 2. platform PATH lookup
  try {
    const finder = isWin ? 'where' : 'which';
    const out = execFileSync(finder, [EXE], { encoding: 'utf8' }).trim();
    // `where` can return multiple lines; take the first real hit
    const first = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first && (looksRunnable(first) || !isWin)) return first;
  } catch (_) {
    /* not on PATH — fall through */
  }

  // 3. common absolute locations
  for (const p of COMMON_PATHS) {
    if (looksRunnable(p)) return p;
  }

  // 4. give up — caller uses JSONL fallback
  return null;
}

module.exports = { resolveSqlite3 };
