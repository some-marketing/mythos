'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let loaded = false;

function parseDotEnv(text) {
  const values = {};
  const lines = String(text || '').split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const idx = line.indexOf('=');
    if (idx === -1) continue;

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) values[key] = value;
  }

  return values;
}

function loadLocalEnv() {
  if (loaded) return;
  loaded = true;

  const candidates = [
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env'),
    path.join(os.homedir(), '.mythos', '.env')
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const parsed = parseDotEnv(fs.readFileSync(candidate, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}

function getEnv(name, options = {}) {
  loadLocalEnv();

  const value = process.env[name];
  if ((value === undefined || value === '') && options.required) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value === undefined || value === '' ? options.defaultValue : value;
}

function getBooleanEnv(name, defaultValue = false) {
  const raw = getEnv(name, { defaultValue: String(defaultValue) });
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

function getNumberEnv(name, defaultValue) {
  const raw = getEnv(name, { defaultValue: String(defaultValue) });
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be numeric`);
  }
  return parsed;
}

module.exports = {
  getBooleanEnv,
  getEnv,
  getNumberEnv,
  loadLocalEnv
};
