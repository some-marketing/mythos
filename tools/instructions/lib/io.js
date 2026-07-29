const fs = require('fs');
const path = require('path');

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readJsonAsYaml(filePath) {
  const raw = readText(filePath).trim();
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse ${filePath}. Canonical .yaml files use JSON-compatible YAML in this repo. ${err.message}`);
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeText(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function listFiles(dirPath) {
  if (!exists(dirPath)) return [];
  return fs.readdirSync(dirPath).map((name) => path.join(dirPath, name));
}

module.exports = {
  readText,
  readJsonAsYaml,
  ensureDir,
  writeText,
  exists,
  listFiles
};
