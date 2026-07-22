#!/usr/bin/env node
'use strict';

const fs = require('fs');

const DISPOSITIONS = new Set(['internal_evidence', 'public_web', 'private_prohibited', 'operator_only', 'superseded', 'blocked']);
const STATUSES = new Set(['open', 'in_review', 'resolved', 'deferred', 'superseded', 'blocked']);
const SEVERITIES = new Set(['CRITICAL', 'MAJOR', 'MINOR', 'NOTE']);

function resolveResearchRoute(finding) {
  if (finding.research_disposition === 'public_web') {
    return { route: 'perplexity', allow_external: true, query_artifact: finding.query_artifact || null };
  }
  if (finding.research_disposition === 'private_prohibited') {
    return { route: 'blocked_private', allow_external: false, query_artifact: null };
  }
  if (finding.research_disposition === 'internal_evidence') {
    return { route: 'local_only', allow_external: false, query_artifact: null };
  }
  return { route: finding.research_disposition, allow_external: false, query_artifact: null };
}

function validateFinding(finding, ledger) {
  const errors = [];
  const required = ['finding_id', 'severity', 'producer_family', 'reviewer_family', 'evidence', 'research_disposition', 'privacy_status', 'answer', 'next_action', 'status', 'iteration_count', 'supersedes', 'superseded_by'];
  for (const key of required) if (finding[key] === undefined || finding[key] === null) errors.push(`${finding.finding_id || '<unknown>'}: missing ${key}`);
  if (!SEVERITIES.has(finding.severity)) errors.push(`${finding.finding_id}: invalid severity`);
  if (!DISPOSITIONS.has(finding.research_disposition)) errors.push(`${finding.finding_id}: invalid research_disposition`);
  if (!STATUSES.has(finding.status)) errors.push(`${finding.finding_id}: invalid status`);
  if (Object.prototype.hasOwnProperty.call(finding, 'max_iterations')) errors.push(`${finding.finding_id}: max_iterations belongs on the ledger root`);
  if (!Array.isArray(finding.evidence) || finding.evidence.length === 0) errors.push(`${finding.finding_id}: evidence must be non-empty`);
  if (finding.producer_family === finding.reviewer_family) errors.push(`${finding.finding_id}: reviewer must be family-distinct from producer`);
  if (finding.context_check_required) {
    if (!finding.context_family) errors.push(`${finding.finding_id}: context_family required`);
    if ([finding.producer_family, finding.reviewer_family].includes(finding.context_family)) errors.push(`${finding.finding_id}: context checker must be a third family`);
  }
  if ([finding.producer_family, finding.reviewer_family, finding.context_family].includes(finding.research_substrate)) errors.push(`${finding.finding_id}: research substrate cannot count as an actor family`);
  if (finding.research_disposition === 'internal_evidence') {
    if (finding.query_artifact || (finding.sources || []).some((source) => /^https?:/i.test(String(source)))) errors.push(`${finding.finding_id}: internal_evidence must make zero web calls`);
  }
  if (finding.research_disposition === 'public_web') {
    if (!['safe_for_web', 'redacted_for_web'].includes(finding.privacy_status)) errors.push(`${finding.finding_id}: public_web requires safe/redacted privacy status`);
    if (finding.research_substrate !== 'perplexity') errors.push(`${finding.finding_id}: public_web research substrate must be perplexity`);
    if (!finding.query_artifact) errors.push(`${finding.finding_id}: public_web requires query_artifact`);
    if (!Array.isArray(finding.sources) || finding.sources.length === 0) errors.push(`${finding.finding_id}: public_web requires sources`);
  }
  if (finding.research_disposition === 'private_prohibited') {
    if (finding.privacy_status !== 'web_prohibited') errors.push(`${finding.finding_id}: private_prohibited requires web_prohibited`);
    if (finding.query_artifact || finding.research_substrate || (finding.sources || []).some((source) => /^https?:/i.test(String(source)))) errors.push(`${finding.finding_id}: private_prohibited must fail closed before external query construction`);
  }
  if (finding.research_disposition === 'superseded') {
    if (finding.status !== 'superseded' || !Array.isArray(finding.superseded_by) || finding.superseded_by.length === 0) errors.push(`${finding.finding_id}: superseded finding requires status and superseded_by link`);
  }
  if (finding.iteration_count >= ledger.max_iterations && !['blocked', 'deferred', 'resolved', 'superseded'].includes(finding.status)) errors.push(`${finding.finding_id}: ceiling reached without terminal/escalated status`);
  return errors;
}

function validateLedger(ledger) {
  const errors = [];
  if (!ledger || ledger.schema !== 'EvidenceLoopFindingLedger/1.0') errors.push('invalid or missing ledger schema');
  if (!ledger || !Number.isInteger(ledger.max_iterations) || ledger.max_iterations < 1 || ledger.max_iterations > 5) errors.push('max_iterations must be 1..5');
  if (!ledger || !Array.isArray(ledger.findings)) errors.push('findings must be an array');
  if (errors.length) return errors;
  const ids = new Set();
  for (const finding of ledger.findings) {
    if (ids.has(finding.finding_id)) errors.push(`${finding.finding_id}: duplicate finding_id`);
    ids.add(finding.finding_id);
    errors.push(...validateFinding(finding, ledger));
  }
  return errors;
}

function main() {
  const file = process.argv[2];
  if (!file) {
    process.stderr.write('Usage: node tools/evidence-loop/validate-finding-ledger.cjs <ledger.json>\n');
    process.exit(2);
  }
  let ledger;
  try { ledger = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { process.stderr.write(`INVALID: ${error.message}\n`); process.exit(1); }
  const errors = validateLedger(ledger);
  if (errors.length) {
    process.stderr.write(`INVALID (${errors.length})\n${errors.map((error) => `- ${error}`).join('\n')}\n`);
    process.exit(1);
  }
  process.stdout.write(`VALID ${file} (${ledger.findings.length} findings)\n`);
}

if (require.main === module) main();

module.exports = { DISPOSITIONS, STATUSES, resolveResearchRoute, validateFinding, validateLedger };
