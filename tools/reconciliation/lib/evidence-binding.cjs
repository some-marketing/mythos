'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { normalizedContentHash, sha256, stableJson } = require('./normalized-content-hash.cjs');

function isContained(root, target) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function resolveContainedPath(projectRoot, relativePath, options = {}) {
  try {
    if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath) || relativePath.split(/[\\/]+/).includes('..') || relativePath.includes('\0')) {
      return { state: 'out_of_bounds', reason: 'relative_path_invalid' };
    }
    const root = fs.realpathSync(projectRoot);
    const candidate = path.resolve(root, relativePath);
    if (!isContained(root, candidate)) return { state: 'out_of_bounds', reason: 'lexical_escape' };
    if (!fs.existsSync(candidate)) return options.allow_missing ? { state: 'missing', root, path: candidate } : { state: 'missing', reason: 'path_missing' };
    const resolved = fs.realpathSync(candidate);
    if (!isContained(root, resolved)) return { state: 'out_of_bounds', reason: 'symlink_escape' };
    return { state: 'contained', root, path: resolved, relative_path: path.relative(root, resolved).replaceAll(path.sep, '/') };
  } catch (error) {
    return { state: 'unsupported', reason: String(error.code || error.message || 'path_resolution_failed') };
  }
}

function bindEvidence(projectRoot, relativePaths) {
  const bindings = [];
  for (const relativePath of Array.isArray(relativePaths) ? relativePaths : []) {
    const resolved = resolveContainedPath(projectRoot, relativePath);
    if (resolved.state !== 'contained') {
      bindings.push({ ref_sha256: sha256(String(relativePath)), state: resolved.state, content_sha256: null });
      continue;
    }
    const bytes = fs.readFileSync(resolved.path);
    const format = resolved.path.endsWith('.json') ? 'json' : 'opaque';
    const identity = normalizedContentHash(bytes, { format });
    bindings.push({ ref_sha256: sha256(relativePath), state: identity.state, content_sha256: identity.sha256 });
  }
  return {
    schema: 'EvidenceBindingReceipt/1.0',
    state: bindings.every((binding) => binding.state === 'bound') ? 'bound' : bindings.some((binding) => binding.state === 'out_of_bounds') ? 'ambiguous' : 'missing_source',
    bindings,
    binding_sha256: sha256(stableJson(bindings)),
    authority: 'identity_only'
  };
}

module.exports = { bindEvidence, isContained, resolveContainedPath };
