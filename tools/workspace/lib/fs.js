const fs = require('fs');
const path = require('path');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function writeText(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeJson(filePath, obj) {
  writeText(filePath, JSON.stringify(obj, null, 2) + '\n');
}

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function copyDir(srcDir, destDir, { filter } = {}) {
  if (!exists(srcDir)) throw new Error(`Source directory not found: ${srcDir}`);
  ensureDir(destDir);
  fs.cpSync(srcDir, destDir, {
    recursive: true,
    force: false,
    errorOnExist: false,
    filter: (src) => {
      const base = path.basename(src);
      if (base === '.DS_Store') return false;
      return typeof filter === 'function' ? Boolean(filter(src)) : true;
    }
  });
}

function listDirs(dirPath) {
  if (!exists(dirPath)) return [];
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

function listFiles(dirPath) {
  if (!exists(dirPath)) return [];
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .sort();
}

function listFilesRecursive(dirPath, baseDir = dirPath) {
  if (!exists(dirPath)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(fullPath, baseDir));
    } else if (entry.isFile()) {
      out.push(path.relative(baseDir, fullPath).replaceAll(path.sep, '/'));
    }
  }
  return out.sort();
}

function copyPath(srcPath, destPath, { filter } = {}) {
  if (!exists(srcPath)) throw new Error(`Source path not found: ${srcPath}`);
  const stat = fs.statSync(srcPath);
  if (stat.isDirectory()) {
    ensureDir(destPath);
    fs.cpSync(srcPath, destPath, {
      recursive: true,
      force: false,
      errorOnExist: false,
      filter: (src) => {
        const base = path.basename(src);
        if (base === '.DS_Store') return false;
        return typeof filter === 'function' ? Boolean(filter(src)) : true;
      }
    });
    return;
  }
  if (typeof filter === 'function' && !filter(srcPath)) return;
  ensureDir(path.dirname(destPath));
  fs.copyFileSync(srcPath, destPath);
}

function fileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

module.exports = {
  copyDir,
  copyPath,
  ensureDir,
  exists,
  fileSize,
  isDir,
  isFile,
  listDirs,
  listFiles,
  listFilesRecursive,
  readJson,
  readText,
  writeJson,
  writeText
};
