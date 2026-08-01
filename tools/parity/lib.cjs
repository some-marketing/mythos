'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fileSha(file) {
  return sha256(fs.readFileSync(file));
}

function posix(value) {
  return value.split(path.sep).join('/');
}

function walk(root, excluded = () => false) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      const relative = posix(path.relative(root, absolute));
      if (excluded(relative, entry)) continue;
      if (entry.isDirectory()) stack.push(absolute);
      else if (entry.isFile()) files.push(relative);
    }
  }
  return files.sort();
}

function globRegex(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function matches(pathname, patterns) {
  return patterns.some(pattern => (
    (pattern.endsWith('/**') && pathname === pattern.slice(0, -3))
    || globRegex(pattern).test(pathname)
  ));
}

function treeDigest(root, files) {
  return sha256(files.map(file => `${file}:${fileSha(path.join(root, file))}`).join('\n'));
}

module.exports = { fileSha, matches, posix, sha256, treeDigest, walk };
