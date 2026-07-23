'use strict';

const fs = require('fs');
const path = require('path');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(readUtf8(filePath));
  } catch {
    return null;
  }
}

function writeText(filePath, text) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, text, 'utf8');
}

function listFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath).map((name) => path.join(dirPath, name));
}

function rel(projectRoot, targetPath) {
  return path.relative(projectRoot, targetPath).replace(/\\/g, '/');
}

function parseFlagArgs(args = []) {
  const flags = {};
  const positionals = [];

  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] || '').trim();
    if (!token) continue;

    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2).replace(/-/g, '_');
    const next = String(args[i + 1] || '').trim();
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }

  return { flags, positionals };
}

function formatIsoForFile(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

module.exports = {
  ensureDir,
  formatIsoForFile,
  listFiles,
  parseFlagArgs,
  readJsonSafe,
  readUtf8,
  rel,
  shellQuote,
  writeText
};
