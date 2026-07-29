#!/usr/bin/env node
'use strict';
// Scan Dart boards for tasks whose description or comments reference local
// repo/file paths (which external collaborators cannot open). Read-only.
//
// Usage: node tools/dart-integration/scan-local-path-refs.js [--out <path>] [board ...]
// Default boards: none — pass the boards to scan as positional args, or edit
// DEFAULT_BOARDS below to match your own Dart workspace.

const fs = require('fs');
const path = require('path');
const api = require('./lib/dart-api');

const DEFAULT_BOARDS = [
  // EXAMPLE: 'Example Agency/Client A',
];

// Absolute local paths, repo-relative paths, and bare artifact filenames.
const PATH_RE = /\/Users\/[A-Za-z0-9_.\-/]+|(?:clients|_dev|tools|frameworks|instructions)\/[A-Za-z0-9_.\-/]+|[A-Za-z0-9_\-]+__[A-Za-z0-9_\-]+\.(?:md|json|pdf|csv|png|jpg|mp4)/g;

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  return process.argv[i + 1];
}

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
}

(async () => {
  const boards = process.argv.slice(2).filter(a => !a.startsWith('--') && a !== arg('out'));
  const targets = boards.length ? boards : DEFAULT_BOARDS;
  const outPath = arg('out', path.join(__dirname, '../../_dev/reports/analysis/dart-local-path-refs__' + new Date().toISOString().slice(0, 10) + '.json'));

  const findings = [];
  for (const board of targets) {
    let listed;
    try { listed = await api.listTasks(board, { limit: 300 }); }
    catch (e) { console.error('ERR list', board, e.message); continue; }
    const tasks = listed.results || listed;
    console.error('scanning', board, '-', tasks.length, 'tasks');

    await mapLimit(tasks, 6, async (t) => {
      let full = null, comments = [];
      try { full = await api.getTask(t.id); } catch (e) { /* keep stub */ }
      try {
        const c = await api.listComments(t.id);
        comments = c.results || c || [];
      } catch (e) { /* no comments */ }

      const task = full && full.item ? full.item : (full || t);
      const desc = task.description || '';
      const descHits = desc.match(PATH_RE) || [];
      const commentHits = [];
      for (const c of comments) {
        const hits = String(c.text || '').match(PATH_RE) || [];
        if (hits.length) commentHits.push({ commentId: c.id, author: c.author || c.user || null, hits: [...new Set(hits)] });
      }
      if (descHits.length || commentHits.length) {
        findings.push({
          id: t.id,
          board,
          title: t.title,
          status: task.status && task.status.title ? task.status.title : task.status,
          assignees: task.assignees || [],
          tags: task.tags || [],
          htmlUrl: t.htmlUrl,
          descriptionHits: [...new Set(descHits)],
          commentHits,
        });
      }
    });
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ scannedAt: new Date().toISOString(), boards: targets, findings }, null, 2));
  console.error('findings:', findings.length, '->', outPath);
  for (const f of findings) {
    console.log(f.id, '|', (f.title || '').slice(0, 70), '| desc:', f.descriptionHits.length, '| comments:', f.commentHits.length, '| assignees:', JSON.stringify(f.assignees));
  }
})();
