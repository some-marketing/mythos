/**
 * dart-board-cache.js — Daily-refresh local cache for Dart board snapshots.
 *
 * Fetches open tasks from Dart MCP once per day and caches locally.
 * The hourly listener reads from cache, never hitting Dart directly.
 *
 * Cache path: _dev/state/dart-board-snapshots/<board-key>.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CACHE_DIR_NAME = '_dev/state/dart-board-snapshots';
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Get the cache file path for a board.
 */
function cachePath(projectRoot, boardKey) {
  return path.join(projectRoot, CACHE_DIR_NAME, `${boardKey}.json`);
}

/**
 * Read a cached snapshot. Returns null if missing or expired.
 *
 * @param {string} projectRoot
 * @param {string} boardKey
 * @param {object} [opts]
 * @param {number} [opts.maxAgeMs] - Max cache age in ms (default: 24h)
 * @returns {{ tasks: object[], fetched_at: string, board_key: string } | null}
 */
function readCache(projectRoot, boardKey, opts = {}) {
  const maxAge = opts.maxAgeMs || DEFAULT_MAX_AGE_MS;
  const filePath = cachePath(projectRoot, boardKey);

  if (!fs.existsSync(filePath)) return null;

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const age = Date.now() - new Date(data.fetched_at).getTime();
    if (age > maxAge) return null; // expired
    return data;
  } catch {
    return null;
  }
}

/**
 * Write a snapshot to cache.
 *
 * @param {string} projectRoot
 * @param {string} boardKey
 * @param {object[]} tasks - Normalized task objects
 * @param {object} [meta] - Extra metadata (client_code, board_name)
 */
function writeCache(projectRoot, boardKey, tasks, meta = {}) {
  const filePath = cachePath(projectRoot, boardKey);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const snapshot = {
    schema: 'DartBoardSnapshot/1.0',
    board_key: boardKey,
    client_code: meta.client_code || '',
    board_name: meta.board_name || '',
    fetched_at: new Date().toISOString(),
    task_count: tasks.length,
    tasks
  };

  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
  return filePath;
}

/**
 * Check if a cache is still fresh (not expired).
 */
function isFresh(projectRoot, boardKey, opts = {}) {
  const maxAge = opts.maxAgeMs || DEFAULT_MAX_AGE_MS;
  const filePath = cachePath(projectRoot, boardKey);

  if (!fs.existsSync(filePath)) return false;

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return (Date.now() - new Date(data.fetched_at).getTime()) < maxAge;
  } catch {
    return false;
  }
}

/**
 * Get cache age in minutes, or Infinity if missing.
 */
function cacheAgeMinutes(projectRoot, boardKey) {
  const filePath = cachePath(projectRoot, boardKey);
  if (!fs.existsSync(filePath)) return Infinity;

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return (Date.now() - new Date(data.fetched_at).getTime()) / 60000;
  } catch {
    return Infinity;
  }
}

module.exports = {
  CACHE_DIR_NAME,
  DEFAULT_MAX_AGE_MS,
  cachePath,
  readCache,
  writeCache,
  isFresh,
  cacheAgeMinutes
};
