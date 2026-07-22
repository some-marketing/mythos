#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ANALYSIS_REL = path.join('_dev', 'reports', 'analysis');
const ACTIVE_HANDOFF = 'next-session-handoff.md';
const ARCHIVE_DIR = 'next-session-archive';
const OUT_JSON = 'next-session-continuity.json';
const OUT_MD = 'next-session-continuity.md';

function rel(root, filePath) {
  return path.relative(root, filePath).replace(/\\/g, '/');
}

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return String(match[1] || '').trim();
  }
  return '';
}

function section(text, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^## ${escaped}\\s*\\n([\\s\\S]*?)(?=\\n## |(?![\\s\\S]))`, 'm');
  const match = text.match(pattern);
  return match ? String(match[1] || '').trim() : '';
}

function summarizeSection(text, heading, maxLen = 240) {
  const value = section(text, heading)
    .split('\n')
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
    .find((line) => !line.startsWith('```')) || '';
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen - 3).trim()}...`;
}

function extractRecommendedCommand(text) {
  const recommended = section(text, 'RECOMMENDED NEXT COMMAND');
  const lines = recommended.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return '';
  if (lines[0].startsWith('```')) {
    const fenced = [];
    for (const line of lines.slice(1)) {
      if (line.startsWith('```')) break;
      fenced.push(line);
    }
    return cleanCommandLine(fenced.find(Boolean) || '');
  }
  return cleanCommandLine(lines[0]);
}

function cleanCommandLine(line) {
  const value = String(line || '').trim().replace(/^[-*]\s*/, '');
  const inline = value.match(/^`([^`]+)`(?:\s|$)/);
  if (inline) return inline[1].trim();
  return value;
}

function parseHandoff(root, filePath, kind, extra = {}) {
  const text = safeRead(filePath);
  const stat = fs.statSync(filePath);
  return {
    kind,
    scope_type: extra.scopeType || 'system',
    client_code: extra.clientCode || '',
    path: rel(root, filePath),
    basename: path.basename(filePath),
    mtime: stat.mtime.toISOString(),
    scope: firstMatch(text, [
      /^>\s*Scope:\s*(.+)$/m,
      /^\*\*Scope:\*\*\s*`?([^`\n]+)`?/m
    ]),
    date: firstMatch(text, [
      /^>\s*Date:\s*(.+)$/m,
      /^\*\*Debriefed at:\*\*\s*(.+)$/m
    ]),
    recommended_next_command: extractRecommendedCommand(text),
    completed_summary: summarizeSection(text, 'COMPLETED THIS SESSION'),
    blocked_summary: summarizeSection(text, 'BLOCKED'),
    ready_summary: summarizeSection(text, 'READY TO EXECUTE')
  };
}

function listHandoffFiles(projectRoot) {
  const analysisDir = path.join(projectRoot, ANALYSIS_REL);
  const active = path.join(analysisDir, ACTIVE_HANDOFF);
  const archiveDir = path.join(analysisDir, ARCHIVE_DIR);
  const files = [];
  if (fs.existsSync(active)) files.push({ kind: 'active', path: active, scopeType: 'system' });
  if (fs.existsSync(archiveDir)) {
    for (const name of fs.readdirSync(archiveDir)) {
      if (name.endsWith('.md')) files.push({ kind: 'archived', path: path.join(archiveDir, name), scopeType: 'system' });
    }
  }
  const clientsDir = path.join(projectRoot, 'clients');
  if (fs.existsSync(clientsDir)) {
    for (const clientCode of fs.readdirSync(clientsDir)) {
      const clientRoot = path.join(clientsDir, clientCode);
      if (!fs.statSync(clientRoot).isDirectory()) continue;
      const clientActive = path.join(clientRoot, ACTIVE_HANDOFF);
      if (fs.existsSync(clientActive)) {
        files.push({ kind: 'active-client', path: clientActive, scopeType: 'client', clientCode });
      }
      const clientArchive = path.join(clientRoot, 'plans', 'archive');
      if (fs.existsSync(clientArchive)) {
        for (const name of fs.readdirSync(clientArchive)) {
          if (name.endsWith('.md') && name.includes('handoff')) {
            files.push({ kind: 'archived-client', path: path.join(clientArchive, name), scopeType: 'client', clientCode });
          }
        }
      }
    }
  }
  return files.sort((a, b) => {
    const rank = { active: 0, 'active-client': 0, archived: 1, 'archived-client': 1 };
    const rankDelta = (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9);
    if (rankDelta !== 0) return rankDelta;
    return fs.statSync(b.path).mtimeMs - fs.statSync(a.path).mtimeMs;
  });
}

function buildContinuityIndex(projectRoot, opts = {}) {
  const limit = Number.isFinite(opts.limit) ? opts.limit : Infinity;
  const generatedAt = opts.generatedAt || new Date().toISOString();
  const entries = listHandoffFiles(projectRoot)
    .slice(0, limit)
    .map((file) => parseHandoff(projectRoot, file.path, file.kind, file));
  return {
    schema: 'NextSessionContinuityIndex/1.0',
    generated_at: generatedAt,
    active_handoff_path: entries.find((entry) => entry.kind === 'active')?.path || '',
    archive_dir: `${ANALYSIS_REL.replace(/\\/g, '/')}/${ARCHIVE_DIR}`,
    entry_count: entries.length,
    total_available_count: listHandoffFiles(projectRoot).length,
    omitted_count: Number.isFinite(limit) ? Math.max(0, listHandoffFiles(projectRoot).length - entries.length) : 0,
    entries
  };
}

function renderMarkdown(index) {
  const lines = [];
  lines.push('# Next Session Continuity Index');
  lines.push('');
  lines.push(`Generated: ${index.generated_at}`);
  lines.push(`Active handoff: ${index.active_handoff_path || 'none'}`);
  lines.push(`Entries indexed: ${index.entry_count}`);
  lines.push('');
  lines.push('## Handoffs');
  lines.push('');
  for (const entry of index.entries) {
    const label = entry.kind === 'active' ? 'Active system'
      : entry.kind === 'active-client' ? `Active client ${entry.client_code}`
        : entry.kind === 'archived-client' ? `Archived client ${entry.client_code}`
          : 'Archived system';
    lines.push(`### ${label}: ${entry.basename}`);
    lines.push('');
    lines.push(`- Path: \`${entry.path}\``);
    lines.push(`- Scope type: ${entry.scope_type}`);
    if (entry.client_code) lines.push(`- Client: ${entry.client_code}`);
    lines.push(`- Scope: ${entry.scope || 'unknown'}`);
    lines.push(`- Date: ${entry.date || entry.mtime}`);
    lines.push(`- Recommended next command: \`${entry.recommended_next_command || 'unknown'}\``);
    if (entry.completed_summary) lines.push(`- Completed: ${entry.completed_summary}`);
    if (entry.blocked_summary) lines.push(`- Blocked: ${entry.blocked_summary}`);
    if (entry.ready_summary) lines.push(`- Ready: ${entry.ready_summary}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function writeContinuityIndex(projectRoot, opts = {}) {
  const index = buildContinuityIndex(projectRoot, opts);
  const analysisDir = path.join(projectRoot, ANALYSIS_REL);
  fs.mkdirSync(analysisDir, { recursive: true });
  const jsonPath = path.join(analysisDir, OUT_JSON);
  const mdPath = path.join(analysisDir, OUT_MD);
  fs.writeFileSync(jsonPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  fs.writeFileSync(mdPath, renderMarkdown(index), 'utf8');
  return {
    index,
    paths: {
      json: rel(projectRoot, jsonPath),
      markdown: rel(projectRoot, mdPath)
    }
  };
}

function parseArgs(argv) {
  const out = { root: process.cwd(), json: false, limit: Infinity };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--root') {
      out.root = next || out.root;
      i += 1;
    } else if (arg === '--limit') {
      out.limit = Number(next || out.limit);
      i += 1;
    } else if (arg === '--json') {
      out.json = true;
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = writeContinuityIndex(path.resolve(args.root), { limit: args.limit });
  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, paths: result.paths, index: result.index }, null, 2)}\n`);
  } else {
    process.stdout.write(`continuity index written: ${result.paths.markdown}\n`);
    process.stdout.write(`continuity index json: ${result.paths.json}\n`);
  }
}

if (require.main === module) main();

module.exports = {
  buildContinuityIndex,
  listHandoffFiles,
  parseArgs,
  parseHandoff,
  renderMarkdown,
  writeContinuityIndex
};
