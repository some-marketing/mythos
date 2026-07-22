'use strict';

const path = require('path');
const { exists, listFilesRecursive, readText } = require('./fs');

const TEXT_EXTENSIONS = new Set(['.json', '.md', '.txt', '.yaml', '.yml']);

function scanTextForTerms(rootDir, terms) {
  if (!exists(rootDir)) return [];
  const files = listFilesRecursive(rootDir).filter((relPath) => TEXT_EXTENSIONS.has(path.extname(relPath)));
  const findings = [];
  const normalizedTerms = [...new Set((terms || []).map((term) => String(term || '').trim()).filter(Boolean))];
  for (const relPath of files) {
    const fullPath = path.join(rootDir, relPath);
    const text = readText(fullPath);
    for (const term of normalizedTerms) {
      if (text.includes(term)) {
        findings.push({ file: relPath, term });
      }
    }
  }
  return findings;
}

module.exports = {
  scanTextForTerms
};
