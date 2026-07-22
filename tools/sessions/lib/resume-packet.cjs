'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveCanonicalRoot } = require('../../lib/canonical-root.cjs');

const DEFAULT_FULL_CAP_BYTES = 10 * 1024;
const DEFAULT_EXCERPT_CAP_BYTES = 6 * 1024;

function projectRoot(rootOpts = {}) {
  if (rootOpts.root) return rootOpts.root;
  return resolveCanonicalRoot(rootOpts.mode ? rootOpts : { mode: 'hard' });
}

function normalizeRel(filePath) {
  return String(filePath || '').split(path.sep).join('/');
}

function escapeAttr(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function resolveSafeHandoffPath(rootDir, handoffPath) {
  if (!handoffPath) {
    return { ok: false, reason: 'missing_handoff_path', absPath: null, relPath: '' };
  }
  const absPath = path.isAbsolute(handoffPath)
    ? path.normalize(handoffPath)
    : path.resolve(rootDir, handoffPath);
  const relPath = normalizeRel(path.relative(rootDir, absPath));
  if (relPath.startsWith('..') || path.isAbsolute(relPath)) {
    return { ok: false, reason: 'handoff_outside_project_root', absPath, relPath };
  }
  return { ok: true, reason: '', absPath, relPath };
}

function latestRepoTimeMs(rootDir, opts = {}) {
  if (typeof opts.latestRepoTimeMs === 'number') return opts.latestRepoTimeMs;
  const runner = opts.gitRunner || spawnSync;
  const result = runner('git', ['log', '-1', '--format=%cI'], {
    cwd: rootDir,
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 64 * 1024
  });
  if (result.error || result.status !== 0) return null;
  const parsed = Date.parse(String(result.stdout || '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function extractMarkdownSections(content, capBytes = DEFAULT_EXCERPT_CAP_BYTES) {
  const lines = String(content || '').split(/\r?\n/);
  const keep = [];
  const wanted = /^(#{1,6}\s+.*(current state|blocked|context|next command|next step|desired state|question|work|handoff|summary)|\*\*(current state|blocked|context|next command|next step|desired state|question|work|handoff|summary)\b)/i;

  for (let i = 0; i < lines.length; i++) {
    if (!wanted.test(lines[i])) continue;
    keep.push(lines[i]);
    for (let j = i + 1; j < lines.length; j++) {
      if (/^#{1,6}\s+/.test(lines[j]) && j > i + 1) break;
      keep.push(lines[j]);
      if (Buffer.byteLength(keep.join('\n'), 'utf8') >= capBytes) break;
    }
    if (Buffer.byteLength(keep.join('\n'), 'utf8') >= capBytes) break;
  }

  if (keep.length > 0) return keep.join('\n').slice(0, capBytes);
  return String(content || '').slice(0, capBytes);
}

function loadHandoffExcerpt(marker, opts = {}) {
  const rootDir = opts.root ? opts.root : projectRoot(opts);
  const fullCapBytes = opts.fullCapBytes || DEFAULT_FULL_CAP_BYTES;
  const excerptCapBytes = opts.excerptCapBytes || DEFAULT_EXCERPT_CAP_BYTES;
  const resolved = resolveSafeHandoffPath(rootDir, marker && marker.handoff_path);
  const base = {
    scope: marker && marker.scope ? marker.scope : '',
    handoff_path: marker && marker.handoff_path ? marker.handoff_path : '',
    resolved_path: resolved.relPath || '',
    recommended_next_command: marker && marker.recommended_next_command ? marker.recommended_next_command : '',
    summary: marker && marker.summary ? marker.summary : '',
    mode: 'missing',
    content: '',
    warnings: []
  };

  if (!resolved.ok) {
    return {
      ...base,
      missing_reason: resolved.reason,
      warnings: [`HANDOFF_MISSING: ${resolved.reason}`]
    };
  }

  if (!fs.existsSync(resolved.absPath)) {
    return {
      ...base,
      missing_reason: 'handoff_file_not_found',
      warnings: ['HANDOFF_MISSING: handoff_file_not_found']
    };
  }

  const stat = fs.statSync(resolved.absPath);
  const content = fs.readFileSync(resolved.absPath, 'utf8');
  const repoTime = latestRepoTimeMs(rootDir, opts);
  const warnings = [];
  if (repoTime && stat.mtimeMs < repoTime) {
    warnings.push('HANDOFF_STALE: repository latest commit is newer than the handoff file mtime');
  }

  if (Buffer.byteLength(content, 'utf8') <= fullCapBytes) {
    return {
      ...base,
      mode: 'full',
      content,
      handoff_mtime: stat.mtime.toISOString(),
      latest_repo_time: repoTime ? new Date(repoTime).toISOString() : null,
      warnings
    };
  }

  return {
    ...base,
    mode: 'excerpt',
    content: extractMarkdownSections(content, excerptCapBytes),
    handoff_mtime: stat.mtime.toISOString(),
    latest_repo_time: repoTime ? new Date(repoTime).toISOString() : null,
    warnings: [
      ...warnings,
      `HANDOFF_EXCERPT: handoff exceeded ${fullCapBytes} bytes; read the full file before running ${base.recommended_next_command || 'the recommended next command'}`
    ]
  };
}

function renderResumePacket(excerpt, opts = {}) {
  const consumedPath = normalizeRel(opts.consumedPath || '');
  const attrs = [
    `scope="${escapeAttr(excerpt.scope)}"`,
    `path="${escapeAttr(excerpt.resolved_path || excerpt.handoff_path)}"`,
    `mode="${escapeAttr(excerpt.mode)}"`
  ];
  if (consumedPath) attrs.push(`consumed_marker="${escapeAttr(consumedPath)}"`);

  const lines = [
    `<RESUMED_SESSION_HANDOFF ${attrs.join(' ')}>`,
    `scope: ${excerpt.scope || '(unknown)'}`,
    `handoff_path: ${excerpt.handoff_path || '(missing)'}`,
    `recommended_next_command: ${excerpt.recommended_next_command || '(missing)'}`,
    `summary: ${excerpt.summary || '(none)'}`,
    `mode: ${excerpt.mode}`
  ];

  if (excerpt.warnings && excerpt.warnings.length > 0) {
    lines.push('warnings:');
    excerpt.warnings.forEach((warning) => lines.push(`- ${warning}`));
  }

  if (excerpt.content) {
    lines.push('', excerpt.content);
  }

  lines.push('</RESUMED_SESSION_HANDOFF>');
  return `${lines.join('\n')}\n`;
}

function buildResumePacket(marker, opts = {}) {
  const excerpt = loadHandoffExcerpt(marker, opts);
  return {
    excerpt,
    text: renderResumePacket(excerpt, opts)
  };
}

module.exports = {
  DEFAULT_EXCERPT_CAP_BYTES,
  DEFAULT_FULL_CAP_BYTES,
  buildResumePacket,
  extractMarkdownSections,
  loadHandoffExcerpt,
  renderResumePacket,
  resolveSafeHandoffPath
};
