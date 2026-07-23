'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { createHandoffSignal, validateHandoffSignal } = require('../../verify/lib/signal.cjs');

const DEFAULT_STALE_SIGNAL_HOURS = 48;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function listFiles(dirPath, predicate = () => true) {
  if (!fs.existsSync(dirPath)) return [];
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dirPath, entry.name))
    .filter(predicate)
    .sort();
}

function rel(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).replace(/\\/g, '/');
}

function safeTimestampForFile(iso) {
  return String(iso || new Date().toISOString())
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
}

function parseTimestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprintFindings(findings) {
  const normalized = findings.map((finding) => ({
    type: finding.type,
    severity: finding.severity,
    actionability: finding.actionability,
    evidence_paths: finding.evidence_paths,
    recommended_next_command: finding.recommended_next_command
  })).sort((a, b) => stableJson(a).localeCompare(stableJson(b)));
  return crypto.createHash('sha256').update(stableJson(normalized)).digest('hex');
}

function finding(id, type, severity, actionability, message, evidencePaths, nextCommand, extra = {}) {
  return {
    id,
    type,
    severity,
    actionability,
    message,
    habitat: extra.habitat || '',
    diet_class: type,
    evidence_paths: evidencePaths,
    recommended_next_command: nextCommand,
    confidence: extra.confidence || 'probable',
    notes: extra.notes || ''
  };
}

function detectStaleLiveSignals(projectRoot, nowMs, thresholdHours) {
  const signalsDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  const thresholdMs = Number(thresholdHours || DEFAULT_STALE_SIGNAL_HOURS) * 60 * 60 * 1000;
  const findings = [];
  const files = listFiles(signalsDir, (filePath) => filePath.endsWith('.json'));

  for (const filePath of files) {
    const signal = safeReadJson(filePath);
    if (!signal || signal.schema !== 'HandoffSignal/1.0') continue;
    if (signal.lifecycle_state !== 'live') continue;
    const timestampMs = parseTimestamp(signal.timestamp);
    if (timestampMs == null) continue;
    const ageMs = nowMs - timestampMs;
    if (ageMs < thresholdMs) continue;
    const ageHours = Math.floor(ageMs / (60 * 60 * 1000));
    findings.push(finding(
      `stale-live-signal:${rel(projectRoot, filePath)}`,
      'stale_live_signal',
      ageHours >= 168 ? 'high' : 'medium',
      'mechanical_review',
      `Live coordination signal is ${ageHours}h old, above the ${thresholdHours}h threshold.`,
      [rel(projectRoot, filePath)],
      '/normalize-signals',
      {
        habitat: '_dev/reports/signals/',
        confidence: 'confirmed',
        notes: `signal_scope=${signal.signal_scope || signal.scope || '(none)'}`
      }
    ));
  }

  return findings;
}

function debriefBaseFromMarkdown(filePath) {
  const base = path.basename(filePath, '.md');
  if (!base.startsWith('run-debrief__')) return null;
  if (base.includes('.improve-plan') || base.includes('.replicate-plan')) return null;
  return base;
}

function detectDebriefFollowupGaps(projectRoot) {
  const analysisDir = path.join(projectRoot, '_dev', 'reports', 'analysis');
  const findings = [];
  const debriefs = listFiles(analysisDir, (filePath) => path.basename(filePath).startsWith('run-debrief__') && filePath.endsWith('.md'));

  for (const filePath of debriefs) {
    const base = debriefBaseFromMarkdown(filePath);
    if (!base) continue;
    const improve = path.join(analysisDir, `${base}.improve-plan.json`);
    const replicate = path.join(analysisDir, `${base}.replicate-plan.json`);
    const missing = [];
    if (!fs.existsSync(improve)) missing.push(rel(projectRoot, improve));
    if (!fs.existsSync(replicate)) missing.push(rel(projectRoot, replicate));
    if (missing.length === 0) continue;
    findings.push(finding(
      `debrief-followup-gap:${rel(projectRoot, filePath)}`,
      'debrief_followup_pair_missing',
      'low',
      'needs_review',
      'Run debrief is missing its expected improve/replicate follow-up pair.',
      [rel(projectRoot, filePath), ...missing],
      '/debrief-run <scope>',
      {
        habitat: '_dev/reports/analysis/',
        confidence: 'probable',
        notes: `Missing: ${missing.join(', ')}`
      }
    ));
  }

  return findings;
}

function artifactPathExists(projectRoot, artifactPath) {
  if (typeof artifactPath !== 'string' || artifactPath.trim() === '') return false;
  const clean = artifactPath.trim();
  const abs = path.isAbsolute(clean) ? clean : path.join(projectRoot, clean);
  return fs.existsSync(abs);
}

function detectEvidenceGaps(projectRoot) {
  const signalsDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  const findings = [];
  const files = listFiles(signalsDir, (filePath) => filePath.endsWith('.json'));
  const claimTypes = new Set(['ready-for-review', 'ready-for-clear', 'cycle-complete']);

  for (const filePath of files) {
    const signal = safeReadJson(filePath);
    if (!signal || signal.schema !== 'HandoffSignal/1.0') continue;
    if (!claimTypes.has(signal.signal_type)) continue;
    const artifacts = Array.isArray(signal.artifacts) ? signal.artifacts : [];
    const missing = artifacts.filter((artifact) => !artifactPathExists(projectRoot, artifact));
    if (artifacts.length === 0 && signal.validation && signal.validation.ran === true) {
      findings.push(finding(
        `evidence-gap:empty-artifacts:${rel(projectRoot, filePath)}`,
        'completion_or_review_evidence_gap',
        'medium',
        'needs_review',
        'Signal claims validation ran but cites no artifacts.',
        [rel(projectRoot, filePath)],
        '/review-progress <scope>',
        {
          habitat: '_dev/reports/signals/',
          confidence: 'probable',
          notes: `signal_type=${signal.signal_type}`
        }
      ));
      continue;
    }
    if (missing.length === 0) continue;
    findings.push(finding(
      `evidence-gap:missing-artifacts:${rel(projectRoot, filePath)}`,
      'completion_or_review_evidence_gap',
      'medium',
      'needs_review',
      'Signal cites artifact paths that are missing on disk.',
      [rel(projectRoot, filePath), ...missing],
      '/review-progress <scope>',
      {
        habitat: '_dev/reports/signals/',
        confidence: 'confirmed',
        notes: `Missing artifacts: ${missing.join(', ')}`
      }
    ));
  }

  return findings;
}

function summarizeFindings(findings) {
  const byType = {};
  const bySeverity = {};
  const byActionability = {};
  const byDietClass = {};
  for (const item of findings) {
    byType[item.type] = (byType[item.type] || 0) + 1;
    bySeverity[item.severity] = (bySeverity[item.severity] || 0) + 1;
    byActionability[item.actionability] = (byActionability[item.actionability] || 0) + 1;
    byDietClass[item.diet_class] = (byDietClass[item.diet_class] || 0) + 1;
  }
  return {
    total: findings.length,
    by_type: byType,
    by_diet_class: byDietClass,
    by_severity: bySeverity,
    by_actionability: byActionability
  };
}

function buildLedger(projectRoot, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const timestamp = now.toISOString();
  const nowMs = now.getTime();
  const thresholdHours = Number(opts.staleSignalHours || DEFAULT_STALE_SIGNAL_HOURS);
  const findings = [
    ...detectStaleLiveSignals(projectRoot, nowMs, thresholdHours),
    ...detectDebriefFollowupGaps(projectRoot),
    ...detectEvidenceGaps(projectRoot)
  ].sort((a, b) => a.id.localeCompare(b.id));
  const fingerprint = fingerprintFindings(findings);

  return {
    schema: 'MaintenanceTopologyLedger/1.0',
    timestamp,
    scope: 'maintenance-topology-scout',
    mode: 'read-only',
    actor_continuity_kernel: {
      current_state: 'Mythos maintenance topology was inspected from durable repo artifacts.',
      question_work: 'Which bounded topology anomalies exist in the first scout habitat and diet?',
      desired_state: 'Findings are written as resumable evidence with exact next commands and no source mutation.'
    },
    habitat: [
      '_dev/reports/signals/',
      '_dev/reports/analysis/',
      '_dev/reports/analysis/task-plans/'
    ],
    source_artifacts: [
      '_dev/reports/analysis/convene-runs/20260528T225238Z-maintenance-ecology/synthesis.md',
      '_dev/reports/analysis/task-plans/maintenance-topology-scout__plan.json',
      '_dev/reports/analysis/task-plans/maintenance-topology-scout__plan.md'
    ],
    diet: [
      'stale_live_signal',
      'debrief_followup_pair_missing',
      'completion_or_review_evidence_gap'
    ],
    authority: 'report-only',
    thresholds: {
      stale_signal_hours: thresholdHours
    },
    summary: summarizeFindings(findings),
    fingerprint,
    findings,
    next_command: findings.length > 0 ? '/review-progress maintenance-topology-scout' : '/debrief-run maintenance-topology-scout'
  };
}

function formatMarkdown(ledger, jsonRelPath) {
  const lines = [
    '# Maintenance Topology Ledger',
    '',
    `- Timestamp: ${ledger.timestamp}`,
    `- Scope: \`${ledger.scope}\``,
    `- Mode: ${ledger.mode}`,
    `- Authority: ${ledger.authority}`,
    `- JSON: \`${jsonRelPath}\``,
    `- Fingerprint: \`${ledger.fingerprint}\``,
    '',
    '## Task Kernel',
    '',
    `1. **Current State:** ${ledger.actor_continuity_kernel.current_state}`,
    `2. **Question / Work:** ${ledger.actor_continuity_kernel.question_work}`,
    `3. **Desired State:** ${ledger.actor_continuity_kernel.desired_state}`,
    '',
    '## Summary',
    '',
    `- Total findings: ${ledger.summary.total}`
  ];

  for (const [type, count] of Object.entries(ledger.summary.by_type)) {
    lines.push(`- ${type}: ${count}`);
  }

  lines.push('', '## Findings', '');
  if (ledger.findings.length === 0) {
    lines.push('- None');
  } else {
    for (const item of ledger.findings) {
      lines.push(`- **${item.type}** (${item.severity}, ${item.actionability}): ${item.message}`);
      lines.push(`  - Evidence: ${item.evidence_paths.map((p) => `\`${p}\``).join(', ')}`);
      lines.push(`  - Next: \`${item.recommended_next_command}\``);
      if (item.notes) lines.push(`  - Notes: ${item.notes}`);
    }
  }

  lines.push('', '## Next Command', '', `\`${ledger.next_command}\``);
  return `${lines.join('\n')}\n`;
}

function readState(statePath) {
  const state = safeReadJson(statePath);
  if (state && typeof state === 'object') return state;
  return { schema: 'MaintenanceTopologyScoutState/1.0' };
}

function writeState(statePath, state) {
  ensureDir(path.dirname(statePath));
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function writeSignalIfNeeded(projectRoot, ledger, paths, state, opts = {}) {
  if (!opts.emitSignal) {
    return { emitted: false, reason: 'emit-signal-disabled', path: null };
  }
  if (ledger.findings.length === 0) {
    return { emitted: false, reason: 'no-findings', path: null };
  }
  if (state.last_signal_fingerprint === ledger.fingerprint) {
    return { emitted: false, reason: 'fingerprint-unchanged', path: null };
  }

  const signal = createHandoffSignal(
    'maintenance-topology-scout',
    'maintenance-topology-scout',
    'coordination-request',
    {
      artifacts: [paths.jsonRelPath, paths.markdownRelPath],
      validation: { ran: true, summary: `${ledger.findings.length} topology finding(s) reported.` },
      recommended_next_actor: 'operator',
      recommended_next_command: '/review-progress maintenance-topology-scout',
      next_prompt_stub: 'Review the maintenance topology ledger and route findings to existing maintenance commands. Do not mutate source from the scout signal.',
      next_step_detail: [
        `Read ${paths.jsonRelPath}`,
        'Route stale signal findings through /normalize-signals',
        'Route uncertain evidence gaps through /review-progress',
        'Create or amend bounded plans for any repair work'
      ],
      signal_scope: 'maintenance-topology-scout'
    }
  );
  const validation = validateHandoffSignal(signal);
  if (!validation.valid) {
    return { emitted: false, reason: `invalid-signal:${validation.errors.join('; ')}`, path: null };
  }

  const signalPath = path.join(
    projectRoot,
    '_dev',
    'reports',
    'signals',
    `coordination-request__${safeTimestampForFile(ledger.timestamp)}__maintenance-topology-scout.json`
  );
  ensureDir(path.dirname(signalPath));
  fs.writeFileSync(signalPath, `${JSON.stringify(signal, null, 2)}\n`, 'utf8');
  state.last_signal_fingerprint = ledger.fingerprint;
  state.last_signal_path = rel(projectRoot, signalPath);
  return { emitted: true, reason: 'fingerprint-changed', path: signalPath };
}

function runTopologyScout(projectRoot, opts = {}) {
  const ledger = buildLedger(projectRoot, opts);
  const timestampSafe = safeTimestampForFile(ledger.timestamp);
  const analysisDir = path.join(projectRoot, '_dev', 'reports', 'analysis');
  const jsonPath = opts.outputJsonPath || path.join(analysisDir, `maintenance-ledger__${timestampSafe}.json`);
  const markdownPath = opts.outputMarkdownPath || path.join(analysisDir, `maintenance-ledger__${timestampSafe}.md`);
  const statePath = opts.statePath || path.join(projectRoot, '_dev', 'state', 'maintenance-topology-scout.json');
  const paths = {
    jsonRelPath: rel(projectRoot, jsonPath),
    markdownRelPath: rel(projectRoot, markdownPath)
  };

  ensureDir(path.dirname(jsonPath));
  fs.writeFileSync(jsonPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  ensureDir(path.dirname(markdownPath));
  fs.writeFileSync(markdownPath, formatMarkdown(ledger, paths.jsonRelPath), 'utf8');

  const state = readState(statePath);
  const signal = writeSignalIfNeeded(projectRoot, ledger, paths, state, opts);
  state.last_ledger_fingerprint = ledger.fingerprint;
  state.last_ledger_path = paths.jsonRelPath;
  state.last_run_at = ledger.timestamp;
  writeState(statePath, state);

  return {
    ledger,
    jsonPath,
    markdownPath,
    statePath,
    signal
  };
}

module.exports = {
  DEFAULT_STALE_SIGNAL_HOURS,
  buildLedger,
  detectDebriefFollowupGaps,
  detectEvidenceGaps,
  detectStaleLiveSignals,
  fingerprintFindings,
  formatMarkdown,
  runTopologyScout
};
