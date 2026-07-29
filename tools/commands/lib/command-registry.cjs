'use strict';

const fs = require('fs');
const path = require('path');

function canonicalCommandPath(projectRoot, commandId) {
  return path.join(projectRoot, 'instructions', 'canonical', 'commands', commandId + '.yaml');
}

function loadCanonicalCommand(projectRoot, commandId) {
  const specPath = canonicalCommandPath(projectRoot, commandId);
  if (!fs.existsSync(specPath)) {
    return null;
  }
  const raw = fs.readFileSync(specPath, 'utf8');
  try {
    return {
      specPath,
      spec: JSON.parse(raw)
    };
  } catch (err) {
    throw new Error(`Failed to parse canonical command spec ${specPath}: ${err.message}`);
  }
}

function parseSlashCommand(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    return { ok: false, error: 'Missing command string.' };
  }
  const match = raw.match(/^\/([a-z][a-z0-9-]*)(?:\s+([\s\S]*))?$/i);
  if (!match) {
    return { ok: false, error: `Not a slash command: ${raw}` };
  }
  return {
    ok: true,
    raw,
    commandId: match[1].toLowerCase(),
    argsText: String(match[2] || '').trim()
  };
}

module.exports = {
  canonicalCommandPath,
  loadCanonicalCommand,
  parseSlashCommand
};
