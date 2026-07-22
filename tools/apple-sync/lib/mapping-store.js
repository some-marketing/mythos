'use strict';
// Persistent Dart-task <-> Apple-reminder mapping with last-synced snapshots.
// One JSON file under _dev/state/apple-sync/. Each entry records the snapshot of
// both sides at the last successful sync so the reconciler can tell which side
// changed since.
//
//   entries[dartId] = {
//     dartId, reminderId, listName,
//     lastDart:  { title, due, isCompleted, status },
//     lastApple: { name, completed },
//     updatedAt
//   }

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const STORE_PATH = path.join(REPO_ROOT, '_dev', 'state', 'apple-sync', 'mapping.json');

function load(storePath = STORE_PATH) {
  try {
    const raw = fs.readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && parsed.entries ? parsed : { version: 1, entries: {}, lastSyncAt: null };
  } catch (e) {
    return { version: 1, entries: {}, lastSyncAt: null };
  }
}

function save(store, storePath = STORE_PATH) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const tmp = storePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, storePath);
  return storePath;
}

module.exports = { load, save, STORE_PATH };
