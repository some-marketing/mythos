#!/usr/bin/env node
'use strict';

// tools/ticktock/ratification-proposal.cjs -- the producer for
// TickTockRatificationProposal/1.0. Plan: ticktock-skill, repair of S3-c in
// _dev/state/ticktock/ticktock-dryrun-evidence.json.
//
// WHAT WAS MISSING.
//
// The refusal half of S3-c was already real and executed: charter.checkImmutability
// detects a charter edit, validateCharter fails at CHARTER_HASH, and every meta-file
// path falls outside the charter's allowed_write_surfaces. The PROPOSAL half existed
// only as SKILL prose -- "the refusal must produce the proposal artifact -- a bare
// refusal is an incomplete outcome (this is what S3-c checks)" -- with no module, no
// schema, and no path convention behind it. This file is the producer, the schema
// sits next to it, and the path convention is stated below and enforced by code.
//
// WHY IT IS PRODUCT CODE AND NOT TEST CODE. The previous S3 run correctly declined
// to write a proposal artifact from inside the verifier: a verifier that manufactures
// the artifact it is verifying proves nothing about the system under test. The fix is
// not to lower that bar, it is to ship the producer, so that S3-c asserts against the
// PRODUCT's artifact.
//
// PATH CONVENTION:
//
//     _dev/state/ticktock/proposals/<proposal_id>.json
//
// One file per proposal, named by its id, alongside the run's other state. The
// directory is created on demand. Proposals are never overwritten: an id collision
// is a refusal, because silently replacing a proposal would erase a record the
// operator may already have read.
//
// WHAT THIS PRODUCER MAY NOT DO, BY CONSTRUCTION:
//   - it never writes to the refused target (that is the edit that was refused);
//   - it never writes any status other than PROPOSED;
//   - it carries no machine-applicable patch, so nothing downstream can replay it
//     as an edit. Ratification is an operator act, and a proposal that could be
//     auto-applied would be an edit wearing a proposal's name.

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const { canonicalize, sha256Hex, hashObject } = require('./canonical.cjs');
const PROPOSAL_SCHEMA = require('./ratification-proposal-schema.json');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_DIR = '_dev/state/ticktock/proposals';
const SCHEMA_ID = 'TickTockRatificationProposal/1.0';

// The protected surfaces SKILL.md (tt.improve) hard-blocks, and the `kind` each maps
// to. Order matters: the most specific prefix wins.
const PROTECTED_SURFACES = [
  { prefix: 'instructions/canonical/dispatch-routing-rule.yaml', kind: 'dispatch_routing_rule' },
  { prefix: '_dev/reports/analysis/mind-capabilities-matrix.md', kind: 'capabilities_matrix' },
  { prefix: '.claude/skills/ticktock/', kind: 'meta_file' },
  { prefix: '.claude/skills/go/', kind: 'meta_file' },
  { prefix: '.claude/skills/meditate/', kind: 'meta_file' }
];

const DEFAULT_RATIFICATION_PATH = {
  steps: [
    'read the proposal artifact named in this record',
    'route the change through /plan-task (or /blueprint if it is big) as an ordinary bounded change',
    'obtain a distinct-family adversarial review of that plan -- the cycle that raised the proposal never reviews it',
    'the operator ratifies or rejects, explicitly; elapsed time and silence ratify nothing',
    'only after ratification does a normal /go run apply the edit, outside the /tt cycle'
  ],
  gate: 'operator ratification',
  decided_by: 'operator (never the cycle that raised the proposal -- a producer never validates its own trial)'
};

function compileValidator() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  return { ajv, validate: ajv.compile(PROPOSAL_SCHEMA) };
}

/** The proposal's identity hash: sha256 of the canonical projection without proposal_hash. */
function computeProposalHash(proposal) {
  return hashObject(proposal, ['proposal_hash']);
}

/** Schema validation only. Returns {valid, errors, errorText}. Never throws. */
function validateProposal(proposal) {
  const { ajv, validate } = compileValidator();
  const valid = validate(proposal);
  return { valid, errors: valid ? [] : validate.errors, errorText: valid ? null : ajv.errorsText(validate.errors) };
}

/** Which protected surface (if any) a path belongs to. */
function classifyTarget(targetPath) {
  const p = String(targetPath || '');
  for (const s of PROTECTED_SURFACES) {
    if (p === s.prefix || p.startsWith(s.prefix)) return s.kind;
  }
  return 'other';
}

/** Is a path inside the charter's own allowed_write_surfaces? Glob suffixes are trimmed to prefixes. */
function insideAllowedWriteSurfaces(targetPath, charter) {
  const surfaces = (charter && charter.allowed_write_surfaces) || [];
  return surfaces.some((s) => String(targetPath).startsWith(String(s).replace(/\*+$/, '')));
}

/** tt-proposal-<UTC stamp>-<8 hex of target+change>. Stable filename stem. */
function proposalId(targetPath, changeSummary, at) {
  const when = (at ? new Date(at) : new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const digest = sha256Hex(`${targetPath}\n${changeSummary}`).slice(0, 8);
  return `tt-proposal-${when}-${digest}`;
}

/** The canonical filename for a proposal: <proposal_id>.json under the proposals dir. */
function proposalPath(id, dir) {
  return path.join(dir || DEFAULT_DIR, `${id}.json`);
}

/**
 * Build the proposal document from a refusal. Pure -- no disk. Exported separately
 * so a caller can inspect what would be written before writing it.
 */
function buildProposal(input) {
  const i = input || {};
  const charter = i.charter || {};
  const targetPath = i.target_path;
  if (!targetPath) throw new Error('PROPOSAL-REFUSED: target_path is required -- a proposal with no target names nothing.');
  const change = i.proposed_change || {};
  if (!change.summary) throw new Error('PROPOSAL-REFUSED: proposed_change.summary is required -- an unnamed change cannot be ratified.');
  const refusal = i.refusal || {};
  if (!refusal.halt_state) throw new Error('PROPOSAL-REFUSED: refusal.halt_state is required -- this artifact is the completion of a specific refusal.');

  const createdAt = i.created_at || new Date().toISOString();
  return {
    schema: SCHEMA_ID,
    proposal_id: i.proposal_id || proposalId(targetPath, change.summary, createdAt),
    created_at: createdAt,
    charter_id: charter.charter_id,
    charter_hash: charter.charter_hash,
    cycle_index: i.cycle_index === undefined ? 0 : i.cycle_index,
    refusal: {
      halt_state: refusal.halt_state,
      detail: refusal.detail === undefined ? '' : String(refusal.detail),
      refused_by: refusal.refused_by || 'unspecified mechanism'
    },
    target: {
      path: targetPath,
      kind: i.target_kind || classifyTarget(targetPath),
      inside_allowed_write_surfaces: insideAllowedWriteSurfaces(targetPath, charter)
    },
    proposed_change: {
      summary: change.summary,
      fields: Array.isArray(change.fields) ? change.fields : [],
      diff_preview: change.diff_preview === undefined ? '' : String(change.diff_preview)
    },
    rationale: {
      why: (i.rationale && i.rationale.why) || change.summary,
      expected_benefit: (i.rationale && i.rationale.expected_benefit) || '',
      // Deliberately not defaulted to prose: an empty falsifier is the honest
      // record of a proposal that has none, and the schema keeps the field
      // present so its emptiness is visible rather than absent.
      falsifier: (i.rationale && i.rationale.falsifier) || '',
      evidence_links: (i.rationale && i.rationale.evidence_links) || []
    },
    ratification_path: i.ratification_path || DEFAULT_RATIFICATION_PATH,
    status: 'PROPOSED'
  };
}

/**
 * THE PRODUCER. Emit the ratification-path proposal artifact a refused
 * charter/meta edit is required to produce.
 *
 * Same four-step discipline as the generation-manifest writer -- construct, validate
 * before disk, write atomically, read back independently through the filesystem --
 * because a proposal the operator half-reads is worse than one that never landed.
 *
 * @returns {object} a TickTockRatificationProposalReceipt/1.0. Throws on any refusal.
 */
function emitRatificationProposal(input, opts) {
  const options = opts || {};
  const dir = options.dir || DEFAULT_DIR;

  // 1. CONSTRUCT -- the writer computes the hash; a supplied one is checked, not trusted.
  const draft = buildProposal(input);
  const intendedHash = computeProposalHash(draft);
  if (input && input.proposal_hash !== undefined && input.proposal_hash !== intendedHash) {
    throw new Error(`PROPOSAL-HASH-MISMATCH: supplied proposal_hash does not equal the recomputed ${intendedHash}.`);
  }
  const document = Object.assign({}, draft, { proposal_hash: intendedHash });

  // 2. VALIDATE before disk.
  const pre = validateProposal(document);
  if (!pre.valid) {
    throw new Error(`PROPOSAL-SCHEMA-INVALID (pre-write): ${pre.errorText}`);
  }

  // 3. WRITE atomically, and never over an existing proposal.
  const relPath = proposalPath(document.proposal_id, dir);
  const absPath = path.resolve(REPO_ROOT, relPath);
  if (fs.existsSync(absPath) && options.overwrite !== true) {
    throw new Error(
      `PROPOSAL-ALREADY-EXISTS: ${relPath} is already on disk. Proposals are never silently replaced -- the operator may already have read this one.`
    );
  }
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const bytes = Buffer.from(JSON.stringify(document, null, 2) + '\n', 'utf8');
  const tmpPath = `${absPath}.tmp`;
  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, absPath);

  // 4. READ BACK independently, through the filesystem.
  const readBackBytes = fs.readFileSync(absPath);
  let readBack;
  try {
    readBack = JSON.parse(readBackBytes.toString('utf8'));
  } catch (err) {
    throw new Error(`PROPOSAL-READBACK-UNPARSEABLE: ${relPath}: ${err.message}`);
  }
  const post = validateProposal(readBack);
  if (!post.valid) throw new Error(`PROPOSAL-SCHEMA-INVALID (read-back): ${post.errorText}`);
  const readBackHash = computeProposalHash(readBack);
  if (readBackHash !== intendedHash) {
    throw new Error(`PROPOSAL-READBACK-HASH-MISMATCH: on-disk content hashes to ${readBackHash}, intended ${intendedHash}.`);
  }
  if (readBack.proposal_hash !== intendedHash) {
    throw new Error(`PROPOSAL-READBACK-FIELD-MISMATCH: on-disk proposal_hash is ${readBack.proposal_hash}, intended ${intendedHash}.`);
  }

  return {
    schema: 'TickTockRatificationProposalReceipt/1.0',
    path: relPath,
    proposal_id: readBack.proposal_id,
    target_path: readBack.target.path,
    target_kind: readBack.target.kind,
    halt_state: readBack.refusal.halt_state,
    status: readBack.status,
    proposal_hash: intendedHash,
    file_sha256: sha256Hex(readBackBytes.toString('utf8')),
    bytes: readBackBytes.length,
    canonical_length: canonicalize(readBack).length,
    constructed: true,
    validated_pre_write: true,
    written_atomically: true,
    read_back_verified: true,
    written_at: new Date().toISOString()
  };
}

/**
 * THE ONE-MOTION CALL SITE: refuse a charter or meta-file edit AND produce the
 * proposal, so a bare refusal is not a reachable outcome.
 *
 * `checkImmutability` is passed in rather than required here, so this module does
 * not reach into charter.cjs's internals; the caller hands over the refusal it
 * already computed.
 *
 * @param {object} args {charter, cycle_index, target_path, refusal, proposed_change, rationale}
 * @returns {object} {refused: true, refusal, proposal_receipt}
 */
function refuseEditWithProposal(args, opts) {
  const receipt = emitRatificationProposal(args, opts);
  return {
    refused: true,
    halt_state: args.refusal.halt_state,
    refusal: args.refusal,
    proposal_receipt: receipt,
    proposal_artifact_path: receipt.path,
    note: 'The edit was refused AND the ratification-path proposal was produced. A bare refusal is an incomplete outcome; this call site cannot produce one.'
  };
}

module.exports = {
  SCHEMA_ID,
  DEFAULT_DIR,
  PROTECTED_SURFACES,
  DEFAULT_RATIFICATION_PATH,
  computeProposalHash,
  validateProposal,
  classifyTarget,
  insideAllowedWriteSurfaces,
  proposalId,
  proposalPath,
  buildProposal,
  emitRatificationProposal,
  refuseEditWithProposal
};

// ---------------------------------------------------------------------------
// CLI -- validate an existing proposal artifact
// ---------------------------------------------------------------------------
if (require.main === module) {
  const [cmd, target] = process.argv.slice(2);
  if (cmd === 'validate' && target) {
    const doc = JSON.parse(fs.readFileSync(path.resolve(target), 'utf8'));
    const result = validateProposal(doc);
    const recomputed = computeProposalHash(doc);
    process.stdout.write(JSON.stringify({
      valid: result.valid,
      errors: result.errors,
      hash_verified: recomputed === doc.proposal_hash,
      recomputed_hash: recomputed
    }, null, 2) + '\n');
    process.exit(result.valid && recomputed === doc.proposal_hash ? 0 : 1);
  } else {
    process.stdout.write('usage: ratification-proposal.cjs validate <path>\n');
    process.exit(2);
  }
}
