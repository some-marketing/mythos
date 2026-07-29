const fs = require('fs');
const path = require('path');

const DEFAULT_HOME_SECRET_FILE = path.resolve(process.cwd(), 'secrets/mythos.home.env');

function parseEnvFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const result = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function loadHomeSecrets() {
  const filePath = process.env.MYTHOS_HOME_SECRET_FILE
    ? path.resolve(process.env.MYTHOS_HOME_SECRET_FILE)
    : DEFAULT_HOME_SECRET_FILE;
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing secret file: ${filePath}`);
  }
  return {
    filePath,
    values: parseEnvFile(filePath),
  };
}

module.exports = {
  DEFAULT_HOME_SECRET_FILE,
  loadHomeSecrets,
};
