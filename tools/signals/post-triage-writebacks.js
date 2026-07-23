#!/usr/bin/env node
// Post the proposed_writeback comments from client-board-triage artifacts to Dart.
// Operator-gated by design: triage NEVER posts; this tool runs only after the
// operator approves ("post writebacks"). Each comment is tagged with the triage
// artifact it came from. Dry-run by default; pass --post to write.
//
// Usage:
//   node tools/signals/post-triage-writebacks.js --date 2026-06-10 [--client {CLIENT_CODE}] [--post]
const fs = require('fs');
const path = require('path');
const api = require(path.join(__dirname, '..', 'dart-integration', 'lib', 'dart-api.js'));

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const DATE = opt('--date', new Date().toISOString().slice(0, 10));
const ONLY = opt('--client', null);
const POST = flag('--post');

const dir = path.join(__dirname, '..', '..', '_dev', 'reports', 'analysis');
const files = fs.readdirSync(dir).filter(f => f.startsWith('client-board-triage__') && f.endsWith(`__${DATE}.json`));
if (!files.length) { console.error(`No triage JSON artifacts for ${DATE} in ${dir}`); process.exit(1); }

(async () => {
  let posted = 0, failed = 0, planned = 0;
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (ONLY && j.client !== ONLY) continue;
    for (const item of j.items) {
      if (!item.proposed_writeback) continue;
      planned++;
      const text = `🦉 **Board triage ${DATE}** (classification: ${item.classification})\n\n${item.proposed_writeback}\n\n_Full triage: _dev/reports/analysis/client-board-triage__${j.client}__${DATE}.md_`;
      if (!POST) { console.log(`DRY ${j.client} ${item.id} ${item.title.slice(0, 70)}`); continue; }
      try { await api.addComment(item.id, text); posted++; console.log(`OK  ${j.client} ${item.id} ${item.title.slice(0, 70)}`); }
      catch (e) { failed++; console.log(`ERR ${j.client} ${item.id} ${e.message}`); }
    }
  }
  console.log(POST ? `DONE posted=${posted} failed=${failed} (planned=${planned})` : `DRY-RUN planned=${planned} (re-run with --post to write)`);
  if (failed) process.exitCode = 2;
})();
