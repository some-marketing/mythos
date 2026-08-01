#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const REGISTRY_PATH = path.join(__dirname, 'lib/registry.json');

function readRegistry() {
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
}

function normalizeCommand(input) {
  if (input) return String(input);
  const raw = process.env.CLAUDE_TOOL_INPUT || '{}';
  try {
    const parsed = JSON.parse(raw);
    return String(parsed.command || parsed.cmd || ((parsed.tool_input || {}).command) || '');
  } catch {
    return '';
  }
}

function commandHash(command) {
  return crypto.createHash('sha256').update(String(command || '')).digest('hex').slice(0, 16);
}

function redactPreview(command) {
  let preview = String(command || '').slice(0, 240);
  const homeRoots = ['home', 'Users'].join('|');
  preview = preview.replace(new RegExp('/(?:' + homeRoots + ')/[^/\\s]+', 'g'), '~/[redacted]');
  preview = preview.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]');
  preview = preview.replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[redacted-phone]');
  preview = preview.replace(/\b(?:token|secret|password|credential|apikey|api_key)=?[^\s&]+/gi, '[redacted-credential]');
  return preview;
}

function registeredWrapperFor(command, registry) {
  const normalized = String(command || '').trim();
  return (registry.registered_wrappers || []).find((entry) => {
    return entry.status === 'registered'
      && entry.command_prefix
      && normalized.startsWith(entry.command_prefix);
  }) || null;
}

function detectPrivateSurface(command, registry = readRegistry()) {
  const normalized = String(command || '');
  const routedWrapper = registeredWrapperFor(normalized, registry);
  if (routedWrapper) {
    return {
      violation: false,
      wrapper_id: routedWrapper.id,
      matches: []
    };
  }

  const lower = normalized.toLowerCase();
  const matches = [];
  for (const entry of registry.private_path_patterns || []) {
    for (const pattern of entry.patterns || []) {
      if (lower.includes(String(pattern).toLowerCase())) {
        matches.push({
          id: entry.id,
          substrate: entry.substrate,
          pattern_id: crypto.createHash('sha256').update(String(pattern)).digest('hex').slice(0, 8)
        });
        break;
      }
    }
  }

  return {
    violation: matches.length > 0,
    wrapper_id: null,
    matches
  };
}

function appendViolation(command, detection, registry = readRegistry()) {
  const relLog = registry.violation_log || 'reports/perimeter-violations.jsonl';
  const logPath = path.join(PROJECT_ROOT, relLog);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const entry = {
    schema: 'PrivateSurfaceViolation/1.0',
    timestamp: new Date().toISOString(),
    mode: registry.mode || 'advisory',
    command_hash: commandHash(command),
    command_preview: redactPreview(command),
    matches: detection.matches,
    action: registry.mode === 'block' ? 'blocked' : 'advisory'
  };
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  return entry;
}

function run(command) {
  const registry = readRegistry();
  const detection = detectPrivateSurface(command, registry);
  if (!detection.violation) return { violation: false, action: 'allow' };

  const entry = appendViolation(command, detection, registry);
  const substrates = [...new Set(detection.matches.map((m) => m.substrate))].join(', ');
  process.stdout.write(
    `PRIVATE SURFACE ADVISORY: raw shell command appears to touch ${substrates}. ` +
    `Use a ratified wrapper and search receipt. Logged ${entry.command_hash} to ${registry.violation_log}.\n`
  );
  if (registry.mode === 'block') process.exitCode = 2;
  return { violation: true, action: entry.action, entry };
}

if (require.main === module) {
  const argCommand = process.argv.includes('--command')
    ? process.argv[process.argv.indexOf('--command') + 1]
    : '';
  run(normalizeCommand(argCommand));
}

module.exports = {
  normalizeCommand,
  commandHash,
  redactPreview,
  detectPrivateSurface,
  appendViolation,
  run
};
