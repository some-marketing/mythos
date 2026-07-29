#!/usr/bin/env node
/**
 * Recover /btw concept sketches from Claude Code transcripts.
 *
 * Scans ~/.claude/projects/<project>/*.jsonl for user messages containing
 * `/btw` or `btw ` markers, captures the user message + the assistant
 * response that immediately follows, and writes one file per pair to
 * _dev/concepts/_recovered/ with full provenance.
 *
 * Usage:
 *   node tools/concepts/recover-btw.js              # scan + write
 *   node tools/concepts/recover-btw.js --dry-run    # report only, no writes
 *   node tools/concepts/recover-btw.js --since 2026-04-01
 *
 * Idempotent: re-runs skip pairs already written (keyed by session+uuid).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECTS_ROOT = path.join(os.homedir(), '.claude/projects');
// Claude Code names each project's transcript directory after the absolute
// cwd path with path separators (and underscores/dots) replaced by dashes.
// Derive it from the current working directory instead of hardcoding one
// operator's path -- this also makes the default actually portable.
function defaultProjectDirName(cwd = process.cwd()) {
  return cwd.replace(/[\/_.]/g, '-');
}
const DEFAULT_PROJECT = defaultProjectDirName();
const OUT_DIR = path.join(
  __dirname,
  '..',
  '..',
  '_dev/concepts/_recovered'
);

function parseArgs(argv) {
  const args = { dryRun: false, since: null, allProjects: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--since') args.since = argv[++i];
    else if (argv[i] === '--all-projects') args.allProjects = true;
  }
  return args;
}

function extractText(msg) {
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((c) => {
        if (typeof c === 'string') return c;
        if (c?.type === 'text') return c.text || '';
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function isBtwMarker(text) {
  if (!text) return false;
  const t = text.trim();
  return /(^|\s)\/btw\b/i.test(t) || /^btw[\s,]/i.test(t);
}

function extractBtwFromLocalCommand(record) {
  if (record.type !== 'system' || record.subtype !== 'local_command') return null;
  const c = record.content || '';
  if (!/<command-name>\/btw<\/command-name>/.test(c)) return null;
  const argsMatch = c.match(/<command-args>([\s\S]*?)<\/command-args>/);
  const msgMatch = c.match(/<command-message>([\s\S]*?)<\/command-message>/);
  const argsRaw = argsMatch ? argsMatch[1].trim() : '';
  const args = argsRaw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  return {
    args,
    message: msgMatch ? msgMatch[1].trim() : '',
  };
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled';
}

function readJsonl(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const records = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // skip malformed
    }
  }
  return records;
}

function findPairs(records, sessionFile) {
  const pairs = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    let userText = '';
    let triggerKind = null;
    if (r.type === 'user' && r.message) {
      const t = extractText(r.message);
      if (isBtwMarker(t)) {
        userText = t;
        triggerKind = 'user-prose';
      }
    } else {
      const btw = extractBtwFromLocalCommand(r);
      if (btw) {
        userText = btw.args || btw.message || '/btw';
        triggerKind = 'local-command';
      }
    }
    if (!triggerKind) continue;

    let assistantText = '';
    let assistantUuid = null;
    let assistantTs = null;
    for (let j = i + 1; j < records.length; j++) {
      const n = records[j];
      if (n.type === 'assistant' && n.message) {
        const t = extractText(n.message);
        if (t.trim()) {
          assistantText = t;
          assistantUuid = n.uuid;
          assistantTs = n.timestamp;
          break;
        }
      }
      if (n.type === 'user' && n.message) {
        const nt = extractText(n.message);
        if (nt.trim() && !isBtwMarker(nt)) break;
      }
    }

    pairs.push({
      sessionFile: path.basename(sessionFile),
      projectDir: path.dirname(sessionFile),
      triggerKind,
      userUuid: r.uuid,
      userTs: r.timestamp,
      userText,
      assistantUuid,
      assistantTs,
      assistantText,
    });
  }
  return pairs;
}

function pairKey(p) {
  return `${path.basename(p.projectDir || '')}/${p.sessionFile}::${p.userUuid}`;
}

function loadIndex() {
  const indexFile = path.join(OUT_DIR, '_index.json');
  if (!fs.existsSync(indexFile)) return { keys: {} };
  try {
    return JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  } catch {
    return { keys: {} };
  }
}

function saveIndex(index) {
  const indexFile = path.join(OUT_DIR, '_index.json');
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n');
}

function writePair(pair) {
  const date = (pair.userTs || '').slice(0, 10) || 'undated';
  const slug = slugify(pair.userText.replace(/\/btw/i, '').trim());
  const projectTag = pair.projectDir ? path.basename(pair.projectDir).slice(-30) : '';
  const filename = `${date}__${pair.sessionFile.replace(/\.jsonl$/, '')}__${slug}.md`;
  const filepath = path.join(OUT_DIR, filename);

  const body = [
    `# Recovered /btw — ${slug}`,
    '',
    `**Project:** \`${path.basename(pair.projectDir || '')}\``,
    `**Session:** \`${pair.sessionFile}\``,
    `**Trigger:** ${pair.triggerKind}`,
    `**User message uuid:** \`${pair.userUuid}\``,
    `**User timestamp:** ${pair.userTs || 'unknown'}`,
    `**Assistant response uuid:** \`${pair.assistantUuid || 'none'}\``,
    `**Assistant timestamp:** ${pair.assistantTs || 'unknown'}`,
    '',
    '---',
    '',
    '## User /btw',
    '',
    pair.userText.trim(),
    '',
    '---',
    '',
    '## Assistant response',
    '',
    pair.assistantText.trim() || '_(no assistant response captured)_',
    '',
  ].join('\n');

  fs.writeFileSync(filepath, body);
  return filepath;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dryRun) fs.mkdirSync(OUT_DIR, { recursive: true });

  const projectDirs = args.allProjects
    ? fs
        .readdirSync(PROJECTS_ROOT)
        .map((d) => path.join(PROJECTS_ROOT, d))
        .filter((d) => fs.statSync(d).isDirectory())
    : [path.join(PROJECTS_ROOT, DEFAULT_PROJECT)];

  const files = [];
  for (const dir of projectDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.jsonl')) files.push(path.join(dir, f));
    }
  }

  const sinceTs = args.since ? Date.parse(args.since) : null;
  const index = args.dryRun ? { keys: {} } : loadIndex();

  let scanned = 0;
  let foundPairs = 0;
  let written = 0;
  let skipped = 0;

  for (const file of files) {
    scanned++;
    let records;
    try {
      records = readJsonl(file);
    } catch {
      continue;
    }
    const pairs = findPairs(records, file);
    for (const p of pairs) {
      if (sinceTs && p.userTs && Date.parse(p.userTs) < sinceTs) continue;
      foundPairs++;
      const key = pairKey(p);
      if (index.keys[key]) {
        skipped++;
        continue;
      }
      if (!args.dryRun) {
        const fp = writePair(p);
        index.keys[key] = path.basename(fp);
      }
      written++;
    }
  }

  if (!args.dryRun) saveIndex(index);

  console.log(
    JSON.stringify(
      {
        scanned_files: scanned,
        pairs_found: foundPairs,
        pairs_written: written,
        pairs_skipped_already_indexed: skipped,
        out_dir: path.relative(process.cwd(), OUT_DIR),
        dry_run: args.dryRun,
      },
      null,
      2
    )
  );
}

main();
