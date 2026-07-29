'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(String(value || '')).digest('hex')}`;
}

function within(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

function classification(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['repository', 'private-bounded', 'synthetic', 'external-approved'].includes(normalized) ? normalized : 'unknown';
}

function projectBoundaryReceipt(input = {}, adapters = {}) {
  const io = adapters.fs || fs;
  const resolveReal = (value) => io.realpathSync(value);
  const allowedRoot = path.resolve(String(input.allowed_root || ''));
  const projectRoot = path.resolve(String(input.project_root || ''));
  const references = Array.isArray(input.references) ? input.references : [];
  const grantId = String(input.operator_grant_id || '').trim();
  const external = !within(allowedRoot, projectRoot);
  const receipt = {
    schema: 'ProjectBoundaryReceipt/1.0',
    state: 'blocked',
    allowed_root_sha256: sha256(allowedRoot),
    project_root_sha256: sha256(projectRoot),
    classification: classification(input.classification || 'repository'),
    operator_grant_id_sha256: grantId ? sha256(grantId) : null,
    references: [],
    reason_codes: [],
    content_read: false,
    report_only: true
  };

  try {
    if (!String(input.allowed_root || '').trim() || !String(input.project_root || '').trim()) {
      receipt.reason_codes.push('missing_boundary_root');
      return receipt;
    }
    if (external && !grantId) {
      receipt.reason_codes.push('external_root_requires_operator_grant');
      return receipt;
    }
    const realAllowed = resolveReal(allowedRoot);
    const realProject = resolveReal(projectRoot);
    if (!external && !within(realAllowed, realProject)) {
      receipt.reason_codes.push('project_symlink_escape');
      return receipt;
    }
    for (const ref of references) {
      const raw = String(ref && ref.path || ref || '');
      const resolved = path.resolve(projectRoot, raw);
      const item = {
        reference_sha256: sha256(raw),
        resolved_sha256: sha256(resolved),
        classification: classification(ref && ref.classification || input.classification || 'repository'),
        reader_allowed: ref && ref.reader_allowed !== false,
        state: 'allowed'
      };
      if (!within(projectRoot, resolved)) {
        item.state = 'blocked';
        receipt.reason_codes.push('reference_traversal');
      } else if (io.existsSync(resolved)) {
        const realRef = resolveReal(resolved);
        if (!within(realProject, realRef)) {
          item.state = 'blocked';
          receipt.reason_codes.push('reference_symlink_escape');
        }
      }
      if (!item.reader_allowed) {
        item.state = 'blocked';
        receipt.reason_codes.push('reader_not_allowed');
      }
      receipt.references.push(item);
    }
    if (receipt.reason_codes.length === 0) receipt.state = external ? 'external_approved' : 'allowed';
    return receipt;
  } catch (error) {
    receipt.state = 'blocked';
    receipt.reason_codes.push(`boundary_probe_error:${String(error && error.code || 'unknown').toLowerCase()}`);
    return receipt;
  }
}

function safeProjectBoundaryReceipt(input, adapters) {
  try {
    return projectBoundaryReceipt(input, adapters);
  } catch (_) {
    return {
      schema: 'ProjectBoundaryReceipt/1.0', state: 'blocked', allowed_root_sha256: sha256('error'),
      project_root_sha256: sha256('error'), classification: 'unknown', operator_grant_id_sha256: null,
      references: [], reason_codes: ['boundary_report_error'], content_read: false, report_only: true
    };
  }
}

module.exports = { classification, projectBoundaryReceipt, safeProjectBoundaryReceipt, sha256, within };
