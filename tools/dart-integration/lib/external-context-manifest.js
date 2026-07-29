'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCHEMA_ID = 'MythosExternalContextManifest/1.0';
const ALLOWED_SHARING_TIERS = new Set(['private-to-operator', 'restricted']);
const LEAKAGE_PATTERNS = [
  { id: 'private_local_path', re: /\/Users\/[A-Za-z0-9_.\-/]+/ },
  { id: 'env_file', re: /(^|[^\w.-])\.env([^\w.-]|$)/ },
  { id: 'api_key_assignment', re: /\b[A-Z0-9_]*(API_KEY|TOKEN|SECRET|PASSWORD)\b\s*[:=]/i },
  { id: 'private_key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'email_address', re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i }
];

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

function isRepoRelative(value) {
  const text = String(value || '');
  return text.length > 0 && !path.isAbsolute(text) && !text.includes('..');
}

function basenameWithoutExt(value) {
  return path.basename(String(value || ''), path.extname(String(value || '')));
}

function scanLeakage(text) {
  const findings = [];
  for (const pattern of LEAKAGE_PATTERNS) {
    if (pattern.re.test(text)) findings.push(pattern.id);
  }
  return findings;
}

function validateExternalContextManifest(manifestPath, opts = {}) {
  const projectRoot = opts.projectRoot || process.cwd();
  const absoluteManifestPath = path.resolve(projectRoot, manifestPath);
  const errors = [];
  const warnings = [];

  if (!fs.existsSync(absoluteManifestPath)) {
    return {
      ok: false,
      manifest_path: path.relative(projectRoot, absoluteManifestPath),
      errors: ['manifest file does not exist'],
      warnings
    };
  }

  let manifest;
  try {
    manifest = readJson(absoluteManifestPath);
  } catch (err) {
    return {
      ok: false,
      manifest_path: path.relative(projectRoot, absoluteManifestPath),
      errors: ['manifest JSON parse failed: ' + err.message],
      warnings
    };
  }

  if (manifest.schema !== SCHEMA_ID) errors.push('schema must be ' + SCHEMA_ID);
  if (!manifest.task || !manifest.task.id) errors.push('task.id is required');
  if (!manifest.task || !manifest.task.title) errors.push('task.title is required');
  if (!manifest.task || !manifest.task.type) errors.push('task.type is required');
  if (!manifest.owner || !manifest.owner.name) errors.push('owner.name is required');
  if (!manifest.owner || !manifest.owner.role) errors.push('owner.role is required');
  if (!Array.isArray(manifest.dependencies)) errors.push('dependencies must be an array');
  if (Array.isArray(manifest.dependencies)) {
    manifest.dependencies.forEach((dependency, index) => {
      if (!dependency || !dependency.kind) errors.push('dependencies[' + index + '].kind is required');
      if (!dependency || !dependency.id) errors.push('dependencies[' + index + '].id is required');
    });
  }
  if (manifest.machine_manifest_location !== 'repo-local') {
    errors.push('machine_manifest_location must be repo-local');
  }

  const sourcePath = manifest.source_artifact && manifest.source_artifact.path;
  if (!isRepoRelative(sourcePath)) {
    errors.push('source_artifact.path must be repo-relative and must not contain ..');
  }

  const expectedHash = String(manifest.source_artifact && manifest.source_artifact.sha256 || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
    errors.push('source_artifact.sha256 must be a 64-character hex SHA-256');
  }

  let sourceText = '';
  if (isRepoRelative(sourcePath)) {
    const absoluteSourcePath = path.resolve(projectRoot, sourcePath);
    if (!absoluteSourcePath.startsWith(path.resolve(projectRoot) + path.sep)) {
      errors.push('source_artifact.path escapes project root');
    } else if (!fs.existsSync(absoluteSourcePath)) {
      errors.push('source_artifact.path does not exist: ' + sourcePath);
    } else {
      const actualHash = sha256File(absoluteSourcePath);
      sourceText = fs.readFileSync(absoluteSourcePath, 'utf8');
      if (expectedHash && actualHash !== expectedHash) {
        errors.push('source_artifact.sha256 does not match current source file');
      }
    }
  }

  const humanRepoPath = manifest.human_doc && manifest.human_doc.repo_path;
  if (!manifest.human_doc || !manifest.human_doc.title) errors.push('human_doc.title is required');
  if (!isRepoRelative(humanRepoPath)) {
    errors.push('human_doc.repo_path must be repo-relative and must not contain ..');
  }
  if (sourcePath && humanRepoPath && sourcePath !== humanRepoPath) {
    warnings.push('human_doc.repo_path differs from source_artifact.path');
  }

  const external = manifest.external || {};
  if (!external.publish_target) errors.push('external.publish_target is required');
  if (!external.publish_target_id) errors.push('external.publish_target_id is required');
  if (!isHttpUrl(external.external_doc_url)) errors.push('external.external_doc_url must be an http(s) URL');

  const sharing = external.sharing || {};
  if (!ALLOWED_SHARING_TIERS.has(sharing.tier)) {
    errors.push('external.sharing.tier must be private-to-operator or restricted');
  }
  if (sharing.anyone_with_link !== false) errors.push('external.sharing.anyone_with_link must be false');
  if (sharing.public !== false) errors.push('external.sharing.public must be false');

  const footer = manifest.dart_footer || {};
  const relManifestPath = path.relative(projectRoot, absoluteManifestPath).replace(/\\/g, '/');
  if (footer.manifest_path !== relManifestPath) {
    errors.push('dart_footer.manifest_path must equal manifest repo path: ' + relManifestPath);
  }
  if (String(footer.source_sha256 || '').toLowerCase() !== expectedHash) {
    errors.push('dart_footer.source_sha256 must match source_artifact.sha256');
  }
  if (footer.external_doc_url !== external.external_doc_url) {
    errors.push('dart_footer.external_doc_url must match external.external_doc_url');
  }
  if (footer.publish_target !== external.publish_target) {
    errors.push('dart_footer.publish_target must match external.publish_target');
  }

  const taskId = manifest.task && manifest.task.id ? String(manifest.task.id) : '';
  if (taskId) {
    const manifestBase = basenameWithoutExt(relManifestPath);
    const sourceBase = basenameWithoutExt(sourcePath);
    const humanBase = basenameWithoutExt(humanRepoPath);
    if (manifestBase && manifestBase !== taskId) {
      errors.push('task.id must match manifest filename: ' + manifestBase);
    }
    if (sourceBase && sourceBase !== taskId) {
      errors.push('task.id must match source_artifact filename: ' + sourceBase);
    }
    if (humanBase && humanBase !== taskId) {
      errors.push('task.id must match human_doc filename: ' + humanBase);
    }
  }

  const manifestText = JSON.stringify(manifest);
  const leakage = Array.from(new Set(scanLeakage(manifestText).concat(scanLeakage(sourceText))));
  for (const finding of leakage) {
    errors.push('leakage marker found: ' + finding);
  }

  return {
    ok: errors.length === 0,
    manifest_path: relManifestPath,
    task_id: manifest.task && manifest.task.id,
    publish_target: external.publish_target || '',
    external_doc_url: external.external_doc_url || '',
    errors,
    warnings
  };
}

module.exports = {
  SCHEMA_ID,
  scanLeakage,
  sha256File,
  validateExternalContextManifest
};
