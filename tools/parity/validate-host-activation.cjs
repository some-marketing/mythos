#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const file = path.resolve(process.argv[2] || path.join(ROOT, 'parity/host-activation.json'));
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
const errors = [];
const ids = new Set();
const requiredKinds = new Set(['git-hooks', 'project-hooks', 'launchd', 'mcp-registration', 'credentialed-adapter', 'operator-gated-tcc']);
if (manifest.schema !== 'MythosHostActivation/2.0' || manifest.secret_free !== true) errors.push('invalid schema or secret_free marker');
const calculatedPlan = crypto.createHash('sha256').update(JSON.stringify(manifest.entries || [])).digest('hex');
if (manifest.plan_sha256 !== calculatedPlan) errors.push('plan_sha256 does not bind the exact entry plan');
if (!['pending', 'approved'].includes(manifest.operator_approval)) errors.push('invalid operator approval');
for (const [index, entry] of (manifest.entries || []).entries()) {
  if (!entry.id || ids.has(entry.id)) errors.push(`entry ${index} has missing/duplicate id`);
  ids.add(entry.id);
  requiredKinds.delete(entry.kind);
  if (!['selected', 'not_applicable'].includes(entry.selection)) errors.push(`${entry.id}: invalid selection`);
  if (entry.selection === 'not_applicable' && !entry.not_applicable_reason) errors.push(`${entry.id}: missing deterministic not_applicable reason`);
  if (entry.selection === 'selected' && entry.not_applicable_reason) errors.push(`${entry.id}: selected entry has not_applicable reason`);
  for (const field of ['prerequisites', 'backup', 'preflight', 'install', 'kickstart', 'healthcheck', 'rollback']) {
    if (!Array.isArray(entry[field])) errors.push(`${entry.id}: ${field} must be an array`);
  }
  if (!entry.receipt?.startsWith('_dev/state/host-activation/receipts/')) errors.push(`${entry.id}: invalid ignored receipt path`);
  for (const action of [...(entry.backup || []), ...(entry.preflight || []), ...(entry.install || []), ...(entry.kickstart || []), ...(entry.healthcheck || []), ...(entry.rollback || [])]) {
    if (!action.op || !Array.isArray(action.args)) errors.push(`${entry.id}: malformed action`);
    if (action.args?.some(value => typeof value !== 'string' || path.isAbsolute(value))) errors.push(`${entry.id}: non-portable action argument`);
    if (action.op === 'run' && action.args[0]?.includes('/')) {
      const executable = path.join(ROOT, action.args[0]);
      if (!fs.existsSync(executable) || !(fs.statSync(executable).mode & 0o111)) {
        errors.push(`${entry.id}: directly spawned entrypoint is not executable: ${action.args[0]}`);
      }
    }
  }
}
if (requiredKinds.size) errors.push(`missing activation kinds: ${[...requiredKinds].join(', ')}`);
if (manifest.operator_approval === 'approved' && manifest.approval_manifest_sha256 !== manifest.plan_sha256) {
  errors.push('approved manifest is not stamped with its exact plan_sha256');
}
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/launchd/services.json'), 'utf8'));
for (const service of catalog.services) if (!ids.has(`launchd-${service.id}`)) errors.push(`missing launchd service ${service.id}`);
if (errors.length) {
  console.error(`BLOCKED: ${errors.length} host activation manifest errors`);
  errors.forEach(error => console.error(`  ${error}`));
  process.exit(1);
}
console.log(`OK: ${ids.size} host activation entries are complete, portable, secret-free, and deterministically selected.`);
