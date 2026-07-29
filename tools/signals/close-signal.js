#!/usr/bin/env node
'use strict';

/**
 * close-signal.js — Close a coordination signal and move it to the closed/ subdirectory.
 *
 * Reads coordination signals from _dev/reports/signals/, sets lifecycle_state to
 * "closed", adds a closed_at timestamp, moves the file to _dev/reports/signals/closed/,
 * and logs the closure to _dev/logs/archive.jsonl.
 *
 * Usage:
 *   node tools/signals/close-signal.js [--file <name>] [--all] [--scope <glob-or-substring>] [--reason <reason>] [--execute] [--verbose]
 *
 * Options:
 *   --file <name>   Close a specific signal file by name (within _dev/reports/signals/)
 *   --all           Close all closeable HandoffSignal/1.0 + 2.0 files
 *   --scope <match> Close live signals matching a glob-or-substring scope pattern
 *   --proposal <p>  Consume one validated report-only normalization proposal
 *   --reason <r>    Close reason: closed, consumed, superseded, ignored, stale, duplicate
 *   --execute       Actually move files (default is dry-run)
 *   --verbose       Show per-file details
 *   --help          Show this help
 *
 * Default behavior (no --file, no --all): scan and report closable signals (dry-run).
 *
 * Exit code 0 = success, 1 = error
 */

const fs = require('fs');
const path = require('path');
const { parseArgs } = require('../workspace/lib/args');
const { validate } = require('../verify/lib/schema.cjs');

let PROJECT_ROOT = path.resolve(__dirname, '../..');
let SIGNAL_DIR = path.join(PROJECT_ROOT, '_dev', 'reports', 'signals');
let CLOSED_DIR = path.join(SIGNAL_DIR, 'closed');
let LOG_DIR = path.join(PROJECT_ROOT, '_dev', 'logs');
let LOG_PATH = path.join(LOG_DIR, 'archive.jsonl');

const {
  COORDINATION_SCHEMA_VERSION,
  COORDINATION_SCHEMA_VERSION_2_0,
  closeSignal
} = require('../verify/lib/signal.cjs');
const {
  EXEMPT_REASONS,
  closureEvidence,
  writeDeferralRecord
} = require('./lib/closure-evidence.cjs');
const {
  isSafeBasename,
  signalContentSha256,
  validateNormalizationProposal
} = require('./lib/signal-normalization-proposal');

const VALID_CLOSE_REASONS = Object.freeze(['closed', 'consumed', 'superseded', 'ignored', 'stale', 'duplicate']);
const PROPOSAL_SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, 'schemas', 'signal-normalization-proposal.schema.json'), 'utf8'));
const AUTHORITY_SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, 'schemas', 'signal-authority-decision.schema.json'), 'utf8'));

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function help() {
  console.log(`
Close coordination signals and move them to the closed/ subdirectory.

Reads HandoffSignal/1.0 and /2.0 files from _dev/reports/signals/,
sets lifecycle_state to "closed", adds closed_at (and closed_reason on 2.0
when --reason is given), and moves to _dev/reports/signals/closed/.

Usage:
  node tools/signals/close-signal.js [options]

Options:
  --file <name>   Close a specific signal file by name
  --all           Close all closeable HandoffSignal/1.0 + 2.0 files
  --scope <match> Close live signals matching a glob-or-substring scope pattern
  --proposal <p>  Consume one proposal under
                  _dev/reports/analysis/signal-normalization-proposals/
                  Requires --file and --execute; incompatible with --all,
                  --scope, --reason, --successor, and --defer
  --reason <r>    Close reason: ${VALID_CLOSE_REASONS.join(', ')}
  --execute       Actually move files (default is dry-run)
  --defer <why>   L8: close WITHOUT contracted artifacts by writing a durable
                  deferral record (obligation preserved, not erased)
  --successor <s> Required with --reason superseded|duplicate: names the signal
                  that preserves this one's obligation
  --verbose       Show per-file details
  --project-root <path>
                  Override project root for tests
  --help          Show this help

Default (no --file, no --all): scan and report closable signals.

Signal surface: _dev/reports/signals/
Closed surface: _dev/reports/signals/closed/
Archive log:    _dev/logs/archive.jsonl
`.trim());
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function assertContainedRegularFile(projectRoot, relativePath, allowedRoot, label) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath) || relativePath.includes('\\') || relativePath.includes('\0')) {
    throw new Error(`${label} must be a repo-relative path`);
  }
  const normalized = path.posix.normalize(relativePath);
  const normalizedRoot = String(allowedRoot).replace(/\/$/, '');
  if (normalized !== relativePath || !normalized.startsWith(`${normalizedRoot}/`) || normalized === normalizedRoot) {
    throw new Error(`${label} must remain under ${normalizedRoot}/`);
  }
  const rootReal = fs.realpathSync(projectRoot);
  let cursor = rootReal;
  for (const segment of normalized.split('/')) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) throw new Error(`${label} does not exist`);
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`${label} must not contain symlinks`);
  }
  const real = fs.realpathSync(cursor);
  if (real !== rootReal && !real.startsWith(`${rootReal}${path.sep}`)) throw new Error(`${label} resolves outside the project root`);
  if (!fs.statSync(real).isFile()) throw new Error(`${label} must resolve to a regular file`);
  return { relativePath: normalized, real };
}

function assertProposalModeArgs(args) {
  if (!args.proposal) return;
  const conflicts = ['all', 'scope', 'reason', 'successor', 'defer'].filter((key) => args[key] !== undefined);
  if (conflicts.length > 0) throw new Error(`--proposal cannot be combined with ${conflicts.map((key) => `--${key}`).join(', ')}`);
  if (!args.file || !isSafeBasename(String(args.file))) throw new Error('--proposal requires --file <signal-basename.json>');
  if (!args.execute) throw new Error('--proposal requires --execute');
}

function loadNormalizationProposal(projectRoot, proposalRef, targetFile) {
  const resolved = assertContainedRegularFile(
    projectRoot,
    String(proposalRef),
    '_dev/reports/analysis/signal-normalization-proposals',
    'proposal path'
  );
  let proposal;
  try {
    proposal = JSON.parse(fs.readFileSync(resolved.real, 'utf8'));
  } catch (err) {
    throw new Error(`proposal is not valid JSON: ${err.message}`);
  }
  const errors = [
    ...validate(proposal, PROPOSAL_SCHEMA, { rootSchema: PROPOSAL_SCHEMA, path: '' }).map((error) => `${error.path || '/'} ${error.message}`),
    ...validate(proposal.authority_decision, AUTHORITY_SCHEMA, { rootSchema: AUTHORITY_SCHEMA, path: '/authority_decision' }).map((error) => `${error.path || '/'} ${error.message}`),
    ...validateNormalizationProposal(proposal)
  ];
  if (errors.length > 0) throw new Error(`proposal validation failed: ${errors.join('; ')}`);
  if (proposal.signal_basename !== targetFile) throw new Error('proposal signal_basename does not match --file');
  return proposal;
}

function refreshProposalTarget(projectRoot, info, proposal, liveSignals) {
  const relativePath = `_dev/reports/signals/${info.name}`;
  const resolved = assertContainedRegularFile(projectRoot, relativePath, '_dev/reports/signals', 'signal path');
  const signal = readHandoffSignal(resolved.real);
  if (!signal) throw new Error('signal is unreadable or not a supported HandoffSignal');
  if (signal.lifecycle_state !== 'live') throw new Error('proposal target is no longer live');
  const currentHash = signalContentSha256(signal);
  if (currentHash !== proposal.signal_content_sha256) throw new Error('proposal is stale because signal authority/content changed');
  const decision = proposal.authority_decision || {};
  if (decision.signal_basename !== info.name || decision.signal_content_sha256 !== currentHash) throw new Error('proposal authority decision does not bind the current signal');
  const scope = String(signal.signal_scope || signal.scope || '').trim();
  if (!scope || decision.signal_scope !== scope || decision.requested_scope !== scope) throw new Error('proposal scope no longer matches the signal');
  const targetActor = String(signal.recommended_next_actor || '').trim().toLowerCase();
  if (decision.target_actor !== targetActor) throw new Error('proposal actor binding no longer matches the signal');

  if (proposal.successor) {
    const successor = liveSignals.find((candidate) => candidate.name === proposal.successor);
    if (!successor) throw new Error('proposal successor is not live');
    const successorScope = String(successor.signal.signal_scope || successor.signal.scope || '').trim();
    if (successorScope !== scope) throw new Error('proposal successor is outside the signal scope');
    const referenceField = proposal.disposition === 'duplicate' ? successor.signal.duplicates_signal : successor.signal.supersedes_signal;
    const normalizedRef = String(referenceField || '').replace(/\\/g, '/');
    if (normalizedRef !== info.name && !normalizedRef.endsWith(`/${info.name}`)) {
      throw new Error(`proposal successor lacks an explicit ${proposal.disposition} link to the target`);
    }
  }
  return { ...info, signal, filePath: resolved.real, size: fs.statSync(resolved.real).size };
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function appendArchiveLog(entry) {
  try {
    ensureDir(LOG_DIR);
    fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n');
  } catch {
    // Non-fatal: logging failure should not block closure
  }
}

function configureProjectRoot(projectRoot) {
  PROJECT_ROOT = path.resolve(projectRoot || PROJECT_ROOT);
  SIGNAL_DIR = path.join(PROJECT_ROOT, '_dev', 'reports', 'signals');
  CLOSED_DIR = path.join(SIGNAL_DIR, 'closed');
  LOG_DIR = path.join(PROJECT_ROOT, '_dev', 'logs');
  LOG_PATH = path.join(LOG_DIR, 'archive.jsonl');
}

function globToRegExp(pattern) {
  const escaped = String(pattern)
    .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function signalMatchText(info) {
  const signal = info.signal || {};
  return [
    info.name,
    info.relPath,
    signal.scope,
    signal.signal_scope,
    signal.source,
    signal.recommended_next_actor,
    signal.recommended_next_command,
    signal.next_prompt_stub,
    Array.isArray(signal.next_step_detail) ? signal.next_step_detail.join(' ') : '',
    Array.isArray(signal.artifacts) ? signal.artifacts.join(' ') : '',
    Array.isArray(signal.decision_context_artifacts) ? signal.decision_context_artifacts.join(' ') : ''
  ].filter((value) => String(value || '').trim()).map(String);
}

function matchesScope(info, scopePattern) {
  const pattern = String(scopePattern || '').trim();
  if (!pattern) return false;
  const regex = pattern.includes('*') ? globToRegExp(pattern) : null;
  const lowerPattern = pattern.toLowerCase();
  return signalMatchText(info).some((value) => {
    const normalized = value.trim();
    if (!normalized) return false;
    if (regex && regex.test(normalized)) return true;
    return normalized.toLowerCase().includes(lowerPattern);
  });
}

/**
 * Read and classify a signal file. Returns null if not a coordination signal
 * (1.0 or 2.0).
 */
function readHandoffSignal(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const signal = JSON.parse(content);
    if (
      signal.schema !== COORDINATION_SCHEMA_VERSION &&
      signal.schema !== COORDINATION_SCHEMA_VERSION_2_0
    ) {
      return null;
    }
    return signal;
  } catch {
    return null;
  }
}

/**
 * Scan the signal surface for closeable HandoffSignal files.
 *
 * Closeable means any non-closed HandoffSignal state. Older signals have
 * used legacy states such as "open" and "consumed", and some historic bridge
 * signals omitted lifecycle_state entirely; all of those should leave the hot
 * surface through this tool rather than by manual moves.
 */
function scanLiveHandoffSignals() {
  if (!fs.existsSync(SIGNAL_DIR)) return [];

  const entries = fs.readdirSync(SIGNAL_DIR, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith('.')) continue;
    if (!entry.name.endsWith('.json')) continue;

    const filePath = path.join(SIGNAL_DIR, entry.name);
    const signal = readHandoffSignal(filePath);
    if (!signal) continue;

    if (signal.lifecycle_state === 'closed') continue;

    const stat = fs.statSync(filePath);
    results.push({
      name: entry.name,
      filePath,
      relPath: path.relative(PROJECT_ROOT, filePath),
      signal,
      size: stat.size
    });
  }

  return results;
}

/**
 * Close a single signal file: update content, move to closed/, log the closure.
 */
function closeSignalFile(info, dryRun, verbose, opts = {}) {
  const closedPath = path.join(CLOSED_DIR, info.name);
  const closedRelPath = path.relative(PROJECT_ROOT, closedPath);
  const closeReason = opts.reason || 'closed';
  const scopeMatch = opts.scopeMatch || '';

  if (dryRun) {
    console.log(`  [dry-run] would close: ${info.relPath} -> ${closedRelPath}`);
    appendArchiveLog({
      ts: new Date().toISOString(),
      event: 'signal.close',
      source: info.relPath,
      destination: closedRelPath,
      surface: '_dev/reports/signals',
      reason: closeReason,
      closed_reason: closeReason,
      closed_scope_match: scopeMatch,
      size_bytes: info.size,
      operator: 'close-signal',
      dry_run: true
    });
    return true;
  }

  // Close the signal in memory
  try {
    closeSignal(info.signal, {
      reason: closeReason,
      closedBy: 'close-signal',
      scopeMatch
    });
    // L8: deferral/successor live on the closed signal itself, not only the
    // archive log — file-level inspection must show the obligation's fate.
    if (opts.deferralRecord) info.signal.closed_deferral_record = opts.deferralRecord;
    if (opts.successor) info.signal.obligation_successor = opts.successor;
  } catch (err) {
    console.error(`  FAILED to close ${info.name}: ${err.message}`);
    return false;
  }

  // Write the closed signal to the closed/ directory
  try {
    ensureDir(CLOSED_DIR);
    if (fs.existsSync(closedPath)) {
      console.error(`  SKIPPED ${info.name}: destination already exists at ${closedRelPath}`);
      return false;
    }
    fs.writeFileSync(closedPath, JSON.stringify(info.signal, null, 2));
  } catch (err) {
    console.error(`  FAILED to write closed signal ${closedRelPath}: ${err.message}`);
    return false;
  }

  // Remove the original from the hot surface
  try {
    fs.unlinkSync(info.filePath);
  } catch (err) {
    console.error(`  FAILED to remove original ${info.relPath}: ${err.message}`);
    // The closed version exists, so this is non-fatal but messy
  }

  appendArchiveLog({
    ts: new Date().toISOString(),
    event: 'signal.close',
    source: info.relPath,
    destination: closedRelPath,
    surface: '_dev/reports/signals',
    reason: closeReason,
    closed_reason: closeReason,
    closed_scope_match: scopeMatch,
    ...(opts.deferralRecord ? { deferral_record: opts.deferralRecord } : {}),
    ...(opts.successor ? { obligation_successor: opts.successor } : {}),
    size_bytes: info.size,
    operator: 'close-signal',
    dry_run: false
  });

  if (verbose) {
    console.log(`  closed: ${info.relPath} -> ${closedRelPath}`);
  }

  return true;
}

// ── Main ──

function main(argv = process.argv) {
const args = parseArgs(argv);

if (args.help || args.h) {
  help();
  return 0;
}

const executeMode = Boolean(args.execute);
const dryRun = !executeMode;
const verbose = Boolean(args.verbose);
const targetFile = args.file || null;
const closeAll = Boolean(args.all);
const scopeMatch = typeof args.scope === 'string' ? args.scope.trim() : '';
const closeReason = typeof args.reason === 'string' ? args.reason.trim() : 'closed';
// L8 closure-requires-evidence (convene 20260610T175230Z): --defer writes a
// durable deferral record when closing without the contracted artifacts;
// --successor names the obligation-preserving signal for superseded/duplicate.
const deferReason = typeof args.defer === 'string' ? args.defer.trim() : '';
const successor = typeof args.successor === 'string' ? args.successor.trim() : '';

configureProjectRoot(args.project_root || process.env.MYTHOS_PROJECT_ROOT || PROJECT_ROOT);

try {
  assertProposalModeArgs(args);
} catch (err) {
  die(err.message);
}

let proposal = null;
if (args.proposal) {
  try {
    proposal = loadNormalizationProposal(PROJECT_ROOT, args.proposal, String(targetFile));
  } catch (err) {
    die(err.message);
  }
}

const effectiveCloseReason = proposal ? proposal.close_reason : closeReason;
const effectiveSuccessor = proposal ? (proposal.successor || '') : successor;
const effectiveDeferReason = proposal ? (proposal.deferral_reason || '') : deferReason;

if (!VALID_CLOSE_REASONS.includes(effectiveCloseReason)) {
  die(`Invalid close reason "${effectiveCloseReason}". Must be one of: ${VALID_CLOSE_REASONS.join(', ')}`);
}
if (EXEMPT_REASONS.has(effectiveCloseReason) && !effectiveSuccessor) {
  die(`--reason ${effectiveCloseReason} requires --successor <signal-name> so the obligation is preserved, not erased (L8).`);
}

// Scan for live coordination signals
const liveSignals = scanLiveHandoffSignals();

if (dryRun) {
  console.log('Close Coordination Signals -- DRY RUN');
  console.log('======================================\n');
} else {
  console.log('Close Coordination Signals -- EXECUTE');
  console.log('=====================================\n');
}

console.log(`Signal surface: _dev/reports/signals/`);
console.log(`Live coordination signals found: ${liveSignals.length}`);
if (scopeMatch) console.log(`Scope match: ${scopeMatch}`);
console.log(`Close reason: ${effectiveCloseReason}`);
console.log('');

if (liveSignals.length === 0 && !targetFile) {
  console.log('No live coordination signals to close.');
  return 0;
}

// Determine which signals to close
let toClose = [];

if (targetFile) {
  const match = liveSignals.find(s => s.name === targetFile);
  if (!match) {
    // Check if the file exists but is not a coordination signal
    const filePath = path.join(SIGNAL_DIR, targetFile);
    if (!fs.existsSync(filePath)) {
      die(`Signal file not found: ${targetFile}`);
    }
    const signal = readHandoffSignal(filePath);
    if (!signal) {
      die(`${targetFile} is not a HandoffSignal/1.0 file`);
    }
    if (signal.lifecycle_state === 'closed') {
      die(`${targetFile} is already closed`);
    }
    die(`${targetFile} is not in a closable state`);
  }
  toClose = [match];
} else if (scopeMatch) {
  toClose = liveSignals.filter((info) => matchesScope(info, scopeMatch));
  if (toClose.length === 0) {
    die(`No live coordination signals match scope: ${scopeMatch}`);
  }
} else if (closeAll) {
  toClose = liveSignals;
} else {
  // Default: report what could be closed
  if (liveSignals.length > 0) {
    console.log('Closable signals:');
    for (const s of liveSignals) {
      console.log(`  ${s.name} (${s.signal.signal_type}, ${formatBytes(s.size)})`);
      if (verbose) {
        console.log(`    source: ${s.signal.source}`);
        console.log(`    scope: ${s.signal.scope}`);
        console.log(`    ready_for_clear: ${s.signal.ready_for_clear}`);
      }
    }
    console.log('');
    console.log('Use --file <name> to close a specific signal, or --all to close all.');
    console.log('Add --execute to perform the closure (default is dry-run).');
  }
  return 0;
}

// Close the selected signals
console.log(`Signals to close: ${toClose.length}`);
console.log('');

let closedCount = 0;
let errorCount = 0;

for (const info of toClose) {
  let currentInfo = info;
  let currentProposal = proposal;
  if (proposal) {
    try {
      currentProposal = loadNormalizationProposal(PROJECT_ROOT, args.proposal, String(targetFile));
      currentInfo = refreshProposalTarget(PROJECT_ROOT, info, currentProposal, liveSignals);
    } catch (err) {
      console.error(`  BLOCKED ${info.name}: ${err.message}`);
      errorCount++;
      continue;
    }
  }
  const currentCloseReason = currentProposal ? currentProposal.close_reason : effectiveCloseReason;
  const currentSuccessor = currentProposal ? (currentProposal.successor || '') : effectiveSuccessor;
  const currentDeferReason = currentProposal ? (currentProposal.deferral_reason || '') : effectiveDeferReason;
  // L8 gate: artifact-contracted signals close only with evidence, a durable
  // deferral, or an obligation-preserving successor (superseded/duplicate).
  const evidence = closureEvidence(currentInfo.signal, PROJECT_ROOT);
  let deferralRecord = '';
  if (evidence.required && !evidence.satisfied && !EXEMPT_REASONS.has(currentCloseReason)) {
    if (!currentDeferReason) {
      console.error(`  BLOCKED ${currentInfo.name}: obligated command \`${evidence.command}\` has missing artifacts:`);
      for (const rel of evidence.missing) console.error(`    - ${rel}`);
      console.error('    Close with the artifacts present, or pass --defer "<reason>" to write a durable deferral record.');
      errorCount++;
      continue;
    }
    if (!dryRun) {
      deferralRecord = writeDeferralRecord(currentInfo.signal, currentInfo, currentDeferReason, PROJECT_ROOT);
      console.log(`  deferral recorded: ${deferralRecord}`);
    } else {
      console.log(`  [dry-run] would write deferral record for ${currentInfo.name}`);
    }
  }
  if (closeSignalFile(currentInfo, dryRun, verbose, { reason: currentCloseReason, scopeMatch, deferralRecord, successor: currentSuccessor })) {
    closedCount++;
  } else {
    errorCount++;
  }
}

console.log('');
if (dryRun) {
  console.log(`Dry run complete. ${closedCount} signal(s) would be closed.`);
  console.log('Use --execute to perform the closure.');
} else {
  console.log(`Closure complete. ${closedCount} signal(s) closed.`);
  if (errorCount > 0) console.log(`Errors: ${errorCount}`);
}

return errorCount > 0 ? 1 : 0;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = {
  VALID_CLOSE_REASONS,
  closeSignalFile,
  configureProjectRoot,
  main,
  matchesScope,
  assertContainedRegularFile,
  assertProposalModeArgs,
  loadNormalizationProposal,
  readHandoffSignal,
  refreshProposalTarget,
  scanLiveHandoffSignals
};
