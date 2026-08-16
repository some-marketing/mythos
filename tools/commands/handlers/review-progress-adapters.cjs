'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { readJsonAsYaml } = require('../../instructions/lib/io');
const { scanLiveHandoffSignals } = require('../../signals/lib/pipeline-loop');
const { buildStatus } = require('../../status/mythos-status');

const PIPELINE_SOURCES = Object.freeze([
  'tools/codex/prompt-system/claude-master-run-order.md',
  '_dev/reports/analysis/plan-pipeline.next-step.json'
]);
const ACTIVE_WORKSTREAM_SOURCES = Object.freeze([
  '_dev/reports/analysis/plan-active-workstreams.md',
  '_dev/reports/analysis/plan-active-workstreams.next-step.json'
]);
const PRIVATE_RULE = 'instructions/canonical/private-surface-introspection-rule.yaml';

function rel(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).replace(/\\/g, '/');
}

function failure(id, severity, expected, observed, evidence, recommendedNextAction) {
  return { id, severity, expected, observed, evidence, recommended_next_action: recommendedNextAction };
}

function readJson(filePath) {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function sha256File(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function base(scopeType, adapterId, scope) {
  return {
    scopeType,
    adapterId,
    scope,
    sourceOfTruth: [],
    reviewedPaths: [],
    failures: [],
    warnings: [],
    fallbackReason: null,
    summary: ''
  };
}

function requireFiles(projectRoot, result, sources, recoveryCommand) {
  for (const source of sources) {
    const absolute = path.join(projectRoot, source);
    result.sourceOfTruth.push(source);
    if (!fs.existsSync(absolute)) {
      result.failures.push(failure(
        'required-source-missing',
        'blocker',
        'Every finite adapter source exists and is readable.',
        `Required source is missing: ${source}`,
        source,
        recoveryCommand
      ));
      result.fallbackReason = 'required_source_missing';
      continue;
    }
    try {
      fs.accessSync(absolute, fs.constants.R_OK);
      result.reviewedPaths.push(source);
    } catch (error) {
      result.failures.push(failure(
        'required-source-unreadable',
        'blocker',
        'Every finite adapter source is readable.',
        error.message,
        source,
        recoveryCommand
      ));
      result.fallbackReason = 'required_source_unreadable';
    }
  }
}

function inspectJsonSource(projectRoot, result, source) {
  const absolute = path.join(projectRoot, source);
  if (!fs.existsSync(absolute)) return null;
  const parsed = readJson(absolute);
  if (!parsed.ok) {
    result.failures.push(failure(
      'source-json-unreadable',
      'blocker',
      'Structured adapter sources parse as JSON.',
      parsed.error,
      source,
      `/review-progress ${result.scope} after repairing the JSON source.`
    ));
    result.fallbackReason = 'source_json_unreadable';
    return null;
  }
  return parsed.data;
}

function checkOptionalReviewBinding(projectRoot, result, markdownSource, structured) {
  if (!structured || typeof structured !== 'object') return;
  const claimed = structured.review_of_sha256 || structured.transition_evidence?.review_of_sha256;
  if (!claimed) return;
  let current;
  try {
    current = sha256File(path.join(projectRoot, markdownSource));
  } catch (error) {
    result.failures.push(failure(
      'required-source-unreadable',
      'blocker',
      'An explicitly bound review source remains readable while its hash is verified.',
      error.message,
      markdownSource,
      `/review-progress ${result.scope} after restoring read access.`
    ));
    result.fallbackReason = 'required_source_unreadable';
    return;
  }
  if (claimed !== current) {
    result.failures.push(failure(
      'stale-review-relation',
      'blocker',
      'An explicit review binding matches the current reviewed source bytes.',
      `Review binding ${claimed} does not match ${current}.`,
      markdownSource,
      `/review-progress ${result.scope} after regenerating the bound review source.`
    ));
  }
}

function inspectPipeline(projectRoot) {
  const result = base('pipeline', 'pipeline-v2', 'pipeline');
  requireFiles(projectRoot, result, PIPELINE_SOURCES, '/plan-pipeline');
  const next = inspectJsonSource(projectRoot, result, PIPELINE_SOURCES[1]);
  if (next && !String(next.next_recommended_command || '').trim()) {
    result.failures.push(failure(
      'pipeline-next-command-missing',
      'blocker',
      'Pipeline replacement state names its next recommended command or action.',
      'next_recommended_command is empty or absent.',
      PIPELINE_SOURCES[1],
      '/plan-pipeline'
    ));
  }
  if (fs.existsSync(path.join(projectRoot, PIPELINE_SOURCES[0]))) {
    checkOptionalReviewBinding(projectRoot, result, PIPELINE_SOURCES[0], next);
  }
  result.summary = `Pipeline adapter inspected ${result.reviewedPaths.length}/${PIPELINE_SOURCES.length} finite sources and found ${result.failures.length} structural issue(s).`;
  return result;
}

function inspectActiveWorkstreams(projectRoot) {
  const result = base('active-workstreams', 'active-workstreams-v2', 'active-workstreams');
  requireFiles(projectRoot, result, ACTIVE_WORKSTREAM_SOURCES, '/plan-active-workstreams');
  const next = inspectJsonSource(projectRoot, result, ACTIVE_WORKSTREAM_SOURCES[1]);
  if (fs.existsSync(path.join(projectRoot, ACTIVE_WORKSTREAM_SOURCES[0]))) {
    checkOptionalReviewBinding(projectRoot, result, ACTIVE_WORKSTREAM_SOURCES[0], next);
  }
  const signalDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  result.sourceOfTruth.push('_dev/reports/signals/*.json (live HandoffSignal/1.0 files only)');
  try {
    const signals = scanLiveHandoffSignals(signalDir);
    result.reviewedPaths.push(...signals.map((item) => rel(projectRoot, item.filePath)));
  } catch (error) {
    result.failures.push(failure(
      'live-signal-scan-failed',
      'blocker',
      'Live signals can be enumerated through the bounded signal scanner.',
      error.message,
      '_dev/reports/signals',
      '/normalize-signals'
    ));
    result.fallbackReason = 'live_signal_scan_failed';
  }
  result.summary = `Active-workstreams adapter inspected its two declared planning surfaces and bounded live-signal directory; ${result.failures.length} structural issue(s) found.`;
  return result;
}

function loadPrivateRule(projectRoot, result) {
  result.sourceOfTruth.push(PRIVATE_RULE);
  let rule;
  let parseError = null;
  try {
    rule = readJsonAsYaml(path.join(projectRoot, PRIVATE_RULE));
  } catch (error) {
    parseError = error;
  }
  if (!rule || rule.schema !== 'PrivateSurfaceIntrospectionRule/1.0') {
    result.failures.push(failure(
      'private-surface-rule-unavailable',
      'blocker',
      'The canonical private-surface rule is readable before a path target is inspected.',
      parseError ? parseError.message : 'Unexpected private-surface rule schema.',
      PRIVATE_RULE,
      `/review-progress ${result.scope} after restoring the canonical rule.`
    ));
    result.fallbackReason = 'private_surface_rule_unavailable';
    return null;
  }
  result.reviewedPaths.push(PRIVATE_RULE);
  return rule;
}

function inspectPath(projectRoot, target) {
  const result = base('path', 'bounded-path-v2', target);
  const rule = loadPrivateRule(projectRoot, result);
  if (!rule) {
    result.summary = 'Path adapter stopped before target inspection because its privacy authority was unavailable.';
    return result;
  }

  const absolute = path.resolve(projectRoot, target);
  const relative = rel(projectRoot, absolute);
  const contained = relative && relative !== '..' && !relative.startsWith('../') && !path.isAbsolute(relative);
  if (!contained) {
    result.failures.push(failure(
      'path-outside-repository',
      'blocker',
      'Path adapter targets remain inside the repository root.',
      `Resolved path escapes the repository: ${target}`,
      target,
      '/review-progress repo'
    ));
    result.fallbackReason = 'path_outside_repository';
    result.summary = 'Path adapter rejected a repository escape before reading the target.';
    return result;
  }

  const segments = relative.toLowerCase().split('/');
  const privateNames = new Set((rule.private_substrates || []).map((item) => String(item).toLowerCase()));
  const forbidden = segments[0] === 'clients'
    || segments.some((segment) => privateNames.has(segment))
    || segments.some((segment) => segment === '.env' || /secret|credential/.test(segment));
  if (forbidden) {
    result.failures.push(failure(
      'path-private-or-forbidden',
      'blocker',
      'Path adapter does not inspect client, credential, secret, environment, or private-substrate targets.',
      `Target is outside the adapter allowance: ${relative}`,
      relative,
      '/review-progress repo'
    ));
    result.fallbackReason = 'private_or_forbidden_path';
    result.summary = 'Path adapter rejected a private or forbidden target before reading it.';
    return result;
  }

  result.sourceOfTruth.push(relative);
  if (!fs.existsSync(absolute)) {
    result.failures.push(failure(
      'path-target-missing',
      'blocker',
      'The bounded path target exists.',
      `Target does not exist: ${relative}`,
      relative,
      `/review-progress ${relative} after correcting the path.`
    ));
    result.fallbackReason = 'path_target_missing';
  } else {
    const stat = fs.statSync(absolute);
    if (!stat.isFile()) {
      result.failures.push(failure(
        'path-target-not-file',
        'blocker',
        'The bounded path adapter receives one regular file, not a directory traversal request.',
        `Target is not a regular file: ${relative}`,
        relative,
        `/review-progress ${relative} with a specific file target.`
      ));
      result.fallbackReason = 'path_target_not_file';
    } else {
      try {
        fs.accessSync(absolute, fs.constants.R_OK);
        if (relative.endsWith('.json')) {
          const parsed = readJson(absolute);
          if (!parsed.ok) throw new Error(parsed.error);
        }
        result.reviewedPaths.push(relative);
      } catch (error) {
        result.failures.push(failure(
          'path-target-unreadable',
          'blocker',
          'The bounded file is readable and JSON targets parse.',
          error.message,
          relative,
          `/review-progress ${relative} after repairing the target.`
        ));
        result.fallbackReason = 'path_target_unreadable';
      }
    }
  }
  result.summary = `Bounded path adapter inspected ${result.reviewedPaths.includes(relative) ? 1 : 0} target file(s) and found ${result.failures.length} structural issue(s).`;
  return result;
}

function inspectRepoSummary(projectRoot, opts = {}) {
  const result = base('repo-summary', 'repo-summary-v2', 'repo');
  result.sourceOfTruth.push('tools/status/mythos-status.js#buildStatus');
  try {
    const status = typeof opts.buildStatus === 'function' ? opts.buildStatus(projectRoot) : buildStatus(projectRoot);
    result.reviewedPaths.push('tools/status/mythos-status.js#buildStatus');
    if (!status || typeof status !== 'object' || !status.next_step || !status.inventory || !Array.isArray(status.live_signals)) {
      result.failures.push(failure(
        'repo-status-contract-incomplete',
        'blocker',
        'buildStatus() returns the bounded structured status contract.',
        'Required next_step, inventory, or live_signals fields are absent.',
        'tools/status/mythos-status.js#buildStatus',
        '/mythos-status'
      ));
      result.fallbackReason = 'repo_status_contract_incomplete';
    }
  } catch (error) {
    result.failures.push(failure(
      'repo-status-build-failed',
      'blocker',
      'The bounded buildStatus() contract executes without recursive adapter traversal.',
      error.message,
      'tools/status/mythos-status.js#buildStatus',
      '/mythos-status'
    ));
    result.fallbackReason = 'repo_status_build_failed';
  }
  result.summary = `Repository summary adapter consumed only buildStatus() output and found ${result.failures.length} structural issue(s).`;
  return result;
}

function looksLikePath(projectRoot, target) {
  return path.isAbsolute(target)
    || target.startsWith('.')
    || target.includes('/')
    || fs.existsSync(path.resolve(projectRoot, target));
}

function inspectAdapterTarget(projectRoot, target, opts = {}) {
  if (target === 'pipeline' || target === 'advance-pipeline') return inspectPipeline(projectRoot);
  if (target === 'active-workstreams') return inspectActiveWorkstreams(projectRoot);
  if (target === 'repo' || target === 'repo-summary') return inspectRepoSummary(projectRoot, opts);
  if (looksLikePath(projectRoot, target)) return inspectPath(projectRoot, target);
  const result = base('unknown', 'unknown-scope-v2', target || 'repo');
  result.failures.push(failure(
    'target-not-found',
    'blocker',
    'Scope resolves to a task plan, named adapter, or bounded repository file.',
    `No supported review scope resolved for "${target || '(empty)'}".`,
    target || '(empty)',
    '/review-progress repo'
  ));
  result.fallbackReason = 'unsupported_scope';
  result.summary = `Scope ${target || 'repo'} is unsupported by deterministic adapters.`;
  return result;
}

module.exports = {
  ACTIVE_WORKSTREAM_SOURCES,
  PIPELINE_SOURCES,
  PRIVATE_RULE,
  inspectAdapterTarget,
  inspectActiveWorkstreams,
  inspectPath,
  inspectPipeline,
  inspectRepoSummary,
  looksLikePath
};
