'use strict';

const path = require('path');
const {
  ensureDir,
  exists,
  isFile,
  listFilesRecursive,
  readJson,
  readText,
  writeJson,
  writeText
} = require('./fs');

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function loadJson(filePath, label = filePath) {
  try {
    return readJson(filePath);
  } catch (err) {
    die(`Invalid JSON in ${label}: ${err.message}`);
  }
}

function findWorkspaceRoot(startPath) {
  let current = path.resolve(startPath);
  while (true) {
    if (exists(path.join(current, 'WORKSPACE_MANIFEST.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function requireWorkspaceRoot(inputPath) {
  const root = findWorkspaceRoot(inputPath);
  if (!root) die(`Could not find WORKSPACE_MANIFEST.json above: ${path.resolve(inputPath)}`);
  return root;
}

function requireProjectRoot(inputPath) {
  const projectRoot = path.resolve(String(inputPath));
  if (!exists(path.join(projectRoot, 'project.json'))) {
    die(`Not a project root (missing project.json): ${projectRoot}`);
  }
  const workspaceRoot = requireWorkspaceRoot(projectRoot);
  return { projectRoot, workspaceRoot };
}

function requireWorkspaceProject(inputPath) {
  const { projectRoot, workspaceRoot } = requireProjectRoot(inputPath);
  // Prefer config/client.json; fall back to root client.json (private ops)
  const configClientPath = path.join(workspaceRoot, 'config', 'client.json');
  const rootClientPath = path.join(workspaceRoot, 'client.json');
  const workspaceConfigPath = exists(configClientPath) ? configClientPath : rootClientPath;
  return {
    workspaceRoot,
    projectRoot,
    projectName: path.basename(projectRoot),
    projectJsonPath: path.join(projectRoot, 'project.json'),
    project: loadProject(projectRoot),
    workspaceManifestPath: path.join(workspaceRoot, 'WORKSPACE_MANIFEST.json'),
    workspaceConfigPath
  };
}

function requireCaptureRoot(inputPath) {
  const captureRoot = path.resolve(String(inputPath));
  if (!exists(path.join(captureRoot, 'CAPTURE_META.json'))) {
    die(`Not a capture root (missing CAPTURE_META.json): ${captureRoot}`);
  }
  if (path.basename(path.dirname(captureRoot)) !== 'captures') {
    die(`Capture root must live under <project>/captures/: ${captureRoot}`);
  }
  const projectRoot = path.dirname(path.dirname(captureRoot));
  const { workspaceRoot } = requireProjectRoot(projectRoot);
  return { captureRoot, projectRoot, workspaceRoot };
}

function requireCandidateRoot(inputPath) {
  const candidateRoot = path.resolve(String(inputPath));
  if (!exists(path.join(candidateRoot, 'candidate.json'))) {
    die(`Not a candidate root (missing candidate.json): ${candidateRoot}`);
  }
  if (path.basename(path.dirname(candidateRoot)) !== 'framework_candidates') {
    die(`Candidate root must live under <project>/framework_candidates/: ${candidateRoot}`);
  }
  const projectRoot = path.dirname(path.dirname(candidateRoot));
  const { workspaceRoot } = requireProjectRoot(projectRoot);
  return { candidateRoot, projectRoot, workspaceRoot };
}

function relPosix(fromPath, toPath) {
  return path.relative(fromPath, toPath).replaceAll(path.sep, '/');
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function timestampId(prefix = '') {
  const iso = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `${iso}${prefix ? `__${slugify(prefix)}` : ''}`;
}

function timestampCompact(date = new Date()) {
  return date.toISOString().replaceAll(':', '').replaceAll('-', '').replace(/\.\d{3}Z$/, 'Z');
}

function getSmosRoot() {
  return path.resolve(__dirname, '..', '..', '..');
}

function toPosix(relPath) {
  return String(relPath).replaceAll(path.sep, '/');
}

function ensureUniqueDir(baseDir, preferredName) {
  const stem = slugify(preferredName) || 'item';
  let attempt = stem;
  let counter = 2;
  while (exists(path.join(baseDir, attempt))) {
    attempt = `${stem}-${counter}`;
    counter += 1;
  }
  const finalDir = path.join(baseDir, attempt);
  ensureDir(finalDir);
  return finalDir;
}

function writeJsonl(filePath, rows) {
  const lines = Array.isArray(rows) ? rows.map((row) => JSON.stringify(row)) : [];
  writeText(filePath, `${lines.join('\n')}${lines.length ? '\n' : ''}`);
}

function readJsonl(filePath) {
  if (!exists(filePath)) return [];
  return readText(filePath)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        die(`Invalid JSONL at ${filePath}:${index + 1}: ${err.message}`);
      }
    });
}

function listImportedFiles(dirPath) {
  return listFilesRecursive(dirPath);
}

function writeMarkdownTemplate(filePath, lines) {
  writeText(filePath, `${lines.join('\n')}\n`);
}

function isLikelyTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return [
    '.md',
    '.txt',
    '.json',
    '.jsonl',
    '.yaml',
    '.yml',
    '.csv',
    '.html',
    '.xml',
    '.js',
    '.ts',
    '.tsx',
    '.jsx',
    '.css',
    '.scss'
  ].includes(ext);
}

function summarizeFileList(baseDir, maxItems = 50) {
  const files = listFilesRecursive(baseDir);
  return {
    total_files: files.length,
    preview: files.slice(0, maxItems),
    truncated: files.length > maxItems
  };
}

function readTextPreview(filePath, maxChars = 1200) {
  if (!isFile(filePath) || !isLikelyTextFile(filePath)) return null;
  const text = readText(filePath).trim();
  if (!text) return '';
  return text.slice(0, maxChars);
}

function loadProject(projectRoot) {
  return loadJson(path.join(projectRoot, 'project.json'), 'project.json');
}

module.exports = {
  die,
  ensureUniqueDir,
  findWorkspaceRoot,
  isLikelyTextFile,
  listImportedFiles,
  loadJson,
  loadProject,
  readJsonl,
  readTextPreview,
  relPosix,
  requireCandidateRoot,
  requireCaptureRoot,
  requireProjectRoot,
  requireWorkspaceProject,
  requireWorkspaceRoot,
  slugify,
  summarizeFileList,
  timestampCompact,
  timestampId,
  toPosix,
  getSmosRoot,
  writeJson,
  writeJsonl,
  writeMarkdownTemplate
};
