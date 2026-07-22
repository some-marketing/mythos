#!/usr/bin/env node
'use strict';
/**
 * owl-dispatch — enforce tool-use + single-model-family routing on subagent
 * dispatch. Two jobs:
 *   build  — wrap a task into a dispatch prompt that (a) injects a manifest of
 *            EXISTING tools relevant to the task, (b) stamps the standing rules
 *            (single-family routing, grep-tools-first, tier, provenance-required).
 *   check  — validate a subagent's return declares which tools it ran; flags
 *            missing provenance so the reviewing actor can bounce it.
 * Deterministic, no inference. Enforcement is mechanical after this is built once.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');

const RULES = [
  'SINGLE-FAMILY: you and any sub-dispatch route to the same model family ONLY, unless the operator explicitly names a different one.',
  'TOOLS-FIRST: before writing any script, grep tools/ for an existing tool. If one exists, USE it — do not reimplement.',
  'BUILD-TO-KEEP: if you must build a mechanical step, build it as a reusable tool under tools/ (not an inline one-off), with a test.',
  'PROVENANCE: your return MUST end with a "TOOLS_USED:" block listing each tool/command you ran and its result. No provenance = rejected.',
  'OWL: operate Observe -> Weigh -> Loop; tier work to the cheapest mind that the verification can hold accountable.',
];

function scanTools(task) {
  // Derive keywords from the task; grep tool filenames for matches.
  const words = (task.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || [])
    .filter(w => !['with','that','this','from','into','your','must','will','plan','task','when','only'].includes(w));
  const uniq = [...new Set(words)].slice(0, 24);
  const hits = new Set();
  for (const w of uniq) {
    try {
      const out = execSync(
        `find tools -maxdepth 4 -type f \\( -name '*.js' -o -name '*.cjs' \\) 2>/dev/null | grep -i -- '${w}' | head -8`,
        { cwd: ROOT, encoding: 'utf8' }
      ).trim();
      out.split('\n').filter(Boolean).forEach(f => hits.add(f));
    } catch (_) { /* no match */ }
  }
  return [...hits].sort().slice(0, 25);
}

function build(task, tier) {
  const tools = scanTools(task);
  const manifest = tools.length
    ? tools.map(t => `  - ${t}`).join('\n')
    : '  (no existing tool matched — grep tools/ yourself before building; if you build one, keep it under tools/ with a test.)';
  return [
    `# DISPATCH (owl-dispatch, tier=${tier})`,
    '',
    '## Standing rules (non-negotiable)',
    ...RULES.map(r => `- ${r}`),
    '',
    '## Existing tools that likely apply — you MUST use these, not reimplement:',
    manifest,
    '',
    '## Task',
    task,
    '',
    '## Return contract',
    'End your final message with a block exactly like:',
    'TOOLS_USED:',
    '- <tool/command> => <one-line result>',
    '(one line per tool you ran; if you genuinely used none, write "TOOLS_USED: none — <why no tool applied>")',
  ].join('\n');
}

function check(returnText) {
  const idx = returnText.search(/TOOLS_USED\s*:/i);
  if (idx === -1) {
    return { ok: false, reason: 'no TOOLS_USED provenance block — REJECT and re-dispatch requiring it' };
  }
  const block = returnText.slice(idx);
  const noneMatch = /TOOLS_USED\s*:\s*none\b/i.test(block);
  const lines = block.split('\n').slice(1).filter(l => /^\s*-\s+\S/.test(l));
  if (noneMatch && lines.length === 0) {
    return { ok: true, tools_used: [], note: 'declared none — reviewing actor should confirm no tool applied' };
  }
  if (lines.length === 0) {
    return { ok: false, reason: 'TOOLS_USED block present but lists no tools and did not justify "none"' };
  }
  return { ok: true, tools_used: lines.map(l => l.replace(/^\s*-\s+/, '').trim()) };
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) args[rest[i].slice(2)] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
  }
  if (cmd === 'build') {
    if (!args.task) { console.error('build requires --task "<text>"'); process.exit(2); }
    process.stdout.write(build(args.task, args.tier || 'default') + '\n');
    return 0;
  }
  if (cmd === 'check') {
    const text = args['return-file'] ? fs.readFileSync(args['return-file'], 'utf8') : (args.text || '');
    if (!text) { console.error('check requires --return-file <path> or --text "<...>"'); process.exit(2); }
    const res = check(text);
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    process.exit(res.ok ? 0 : 1);
  }
  console.error('usage: owl-dispatch build --task "..." [--tier <label>]\n       owl-dispatch check --return-file <path>');
  process.exit(2);
}
if (require.main === module) main();
module.exports = { build, check, scanTools, RULES };
