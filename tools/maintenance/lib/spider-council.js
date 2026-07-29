'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { buildLedger: buildTopologyLedger } = require('./topology-scout');
const { bindEvidence } = require('../../reconciliation/lib/evidence-binding.cjs');
const { sha256, stableJson } = require('../../reconciliation/lib/normalized-content-hash.cjs');

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

function fingerprintFindings(findings) {
  const normalized = findings.map((finding) => ({
    spider_id: finding.spider_id,
    diet_class: finding.diet_class,
    severity: finding.severity,
    actionability: finding.actionability,
    evidence_paths: finding.evidence_paths,
    recommended_next_command: finding.recommended_next_command
  })).sort((a, b) => stableJson(a).localeCompare(stableJson(b)));
  return crypto.createHash('sha256').update(stableJson(normalized)).digest('hex');
}

function classifyMaintenanceDisposition({ projectRoot, finding, prior_dispositions = [] } = {}) {
  if (process.env.MAINTENANCE_DISPOSITION_V1 === '0') return null;
  const evidence = bindEvidence(projectRoot, finding && finding.evidence_paths || []);
  const findingContentSha256 = sha256(stableJson({
    spider_id: finding && finding.spider_id,
    diet_class: finding && finding.diet_class,
    severity: finding && finding.severity,
    actionability: finding && finding.actionability,
    evidence_binding_sha256: evidence.binding_sha256
  }));
  const fingerprint = sha256(stableJson({ id: finding && finding.id, finding_content_sha256: findingContentSha256 }));
  const prior = (Array.isArray(prior_dispositions) ? prior_dispositions : []).filter((item) => item && item.finding_id === finding.id);
  let state = evidence.state === 'bound' ? 'new' : 'semantic_review';
  let reason = evidence.state === 'bound' ? 'no_prior_disposition' : 'evidence_unavailable_or_ambiguous';
  if (evidence.state !== 'bound') {
    // Missing or ambiguous evidence cannot prove duplicate identity.
  } else if (prior.length > 1) {
    state = 'semantic_review'; reason = 'prior_disposition_ambiguous';
  } else if (prior.length === 1) {
    const previous = prior[0];
    if (previous.fingerprint_sha256 === fingerprint && previous.finding_content_sha256 !== findingContentSha256) {
      state = 'semantic_review'; reason = 'fingerprint_collision_or_inconsistent_prior';
    } else if (previous.evidence_binding_sha256 !== evidence.binding_sha256) {
      state = previous.state === 'resolved' ? 'reopened' : 'semantic_review'; reason = 'evidence_content_changed';
    } else if (previous.state === 'resolved') {
      state = 'reopened'; reason = 'resolved_finding_recurred';
    } else {
      state = 'duplicate'; reason = 'exact_finding_and_evidence_identity';
    }
  }
  return {
    schema: 'MaintenanceDisposition/1.0', finding_id: finding.id, state, reason,
    fingerprint_sha256: fingerprint, finding_content_sha256: findingContentSha256, evidence_binding_sha256: evidence.binding_sha256,
    append_only: true, can_dispatch: false, can_delete_or_suppress: false, authority: 'advisory_only'
  };
}

function makeFinding(spiderId, id, dietClass, severity, actionability, message, evidencePaths, nextCommand, extra = {}) {
  return {
    id: `${spiderId}:${id}`,
    spider_id: spiderId,
    diet_class: dietClass,
    severity,
    actionability,
    message,
    habitat: extra.habitat || '',
    evidence_paths: evidencePaths,
    recommended_next_command: nextCommand,
    confidence: extra.confidence || 'probable',
    notes: extra.notes || ''
  };
}

const OWNED_ARTIFACT_CLASSIFICATIONS = Object.freeze([
  'expected-future',
  'optional',
  'stale-plan',
  'missing-output',
  'ambiguous'
]);

function classifyOwnedArtifactFinding(finding) {
  const text = [
    finding && finding.message,
    finding && finding.notes,
    ...(Array.isArray(finding && finding.evidence_paths) ? finding.evidence_paths : [])
  ].filter(Boolean).join(' ').toLowerCase();

  if (!text.trim() || /<[^>]+>|\*|\?|\[/.test(text)) return 'ambiguous';
  if (/optional|if present|when available/.test(text)) return 'optional';
  if (/\(new\)|planned|future|to be written|candidate output/.test(text)) return 'expected-future';
  if (/stale plan|superseded|completed plan|closed plan|obsolete/.test(text)) return 'stale-plan';
  if (/missing|not present|absent|does not exist/.test(text)) return 'missing-output';
  return 'ambiguous';
}

function aggregateOwnedArtifactFindings(findings) {
  const relevant = (Array.isArray(findings) ? findings : []).filter(
    (finding) => finding && finding.diet_class === 'task_plan_owned_artifact_missing'
  );
  if (relevant.length === 0) return [];

  const counts = Object.fromEntries(OWNED_ARTIFACT_CLASSIFICATIONS.map((label) => [label, 0]));
  for (const finding of relevant) {
    const classification = finding.classification || classifyOwnedArtifactFinding(finding);
    if (Object.hasOwn(counts, classification)) counts[classification] += 1;
  }
  return [{
    id: 'task-plan-owned-artifacts:operator-triage',
    state: 'blocked',
    authority: 'operator',
    finding_count: relevant.length,
    classifications: counts,
    finding_ids: relevant.map((finding) => finding.id).sort(),
    next_command: '/review-progress spider-ledger',
    reason: 'Owned-artifact findings require one bounded operator triage pass; no per-finding command was dispatched.'
  }];
}

function spiderSummary(id, name, habitat, diet, findings) {
  return {
    id,
    name,
    habitat,
    diet,
    authority: 'report-only',
    finding_count: findings.length
  };
}

function topologySpider(projectRoot, opts = {}) {
  const topology = buildTopologyLedger(projectRoot, opts);
  const spiderId = 'topology-spider';
  const findings = topology.findings.map((finding) => makeFinding(
    spiderId,
    finding.id,
    finding.diet_class || finding.type,
    finding.severity,
    finding.actionability,
    finding.message,
    finding.evidence_paths,
    finding.recommended_next_command,
    {
      habitat: finding.habitat,
      confidence: finding.confidence,
      notes: finding.notes
    }
  ));

  return {
    summary: spiderSummary(
      spiderId,
      'Topology Spider',
      topology.habitat,
      topology.diet,
      findings
    ),
    findings
  };
}

function commandSurfaceSpider(projectRoot) {
  const spiderId = 'command-surface-spider';
  const systemPath = path.join(projectRoot, 'instructions', 'canonical', 'system.yaml');
  const system = safeReadJson(systemPath);
  const migrated = Array.isArray(system?.commands?.migrated) ? system.commands.migrated : [];
  const findings = [];

  for (const commandId of migrated) {
    const specPath = path.join(projectRoot, 'instructions', 'canonical', 'commands', `${commandId}.yaml`);
    const claudePath = path.join(projectRoot, '.claude', 'commands', `${commandId}.md`);
    const previewPath = path.join(projectRoot, 'instructions', 'generated', 'claude', 'commands', `${commandId}.md`);
    if (!fs.existsSync(specPath)) {
      findings.push(makeFinding(
        spiderId,
        `missing-spec:${commandId}`,
        'missing_command_spec',
        'high',
        'mechanical_review',
        'Migrated command is registered in canonical system metadata but its canonical command spec is missing.',
        [rel(projectRoot, systemPath), rel(projectRoot, specPath)],
        '/sync-manifest',
        { habitat: 'instructions/canonical/commands/', confidence: 'confirmed' }
      ));
    }
    if (fs.existsSync(path.dirname(claudePath)) && !fs.existsSync(claudePath)) {
      findings.push(makeFinding(
        spiderId,
        `missing-claude-command:${commandId}`,
        'missing_generated_command_surface',
        'medium',
        'mechanical_review',
        'Canonical command is missing its generated Claude command surface.',
        [rel(projectRoot, specPath), rel(projectRoot, claudePath)],
        'npm run instructions:generate',
        { habitat: '.claude/commands/', confidence: 'confirmed' }
      ));
    }
    if (fs.existsSync(path.dirname(previewPath)) && !fs.existsSync(previewPath)) {
      findings.push(makeFinding(
        spiderId,
        `missing-preview-command:${commandId}`,
        'missing_generated_command_surface',
        'medium',
        'mechanical_review',
        'Canonical command is missing its generated Claude preview command surface.',
        [rel(projectRoot, specPath), rel(projectRoot, previewPath)],
        'npm run instructions:generate:preview',
        { habitat: 'instructions/generated/claude/commands/', confidence: 'confirmed' }
      ));
    }
  }

  return {
    summary: spiderSummary(
      spiderId,
      'Command Surface Spider',
      ['instructions/canonical/system.yaml', 'instructions/canonical/commands/', '.claude/commands/', 'instructions/generated/claude/commands/'],
      ['missing_command_spec', 'missing_generated_command_surface'],
      findings
    ),
    findings
  };
}

function listTaskPlanFiles(projectRoot) {
  const roots = [
    path.join(projectRoot, '_dev', 'reports', 'analysis', 'task-plans')
  ];
  const clientsDir = path.join(projectRoot, 'clients');
  if (fs.existsSync(clientsDir)) {
    for (const client of fs.readdirSync(clientsDir, { withFileTypes: true })) {
      if (!client.isDirectory() || client.name.startsWith('.')) continue;
      roots.push(path.join(clientsDir, client.name, 'plans'));
    }
  }
  return roots.flatMap((root) => listFiles(root, (filePath) => filePath.endsWith('__plan.json')));
}

function isGlobLike(value) {
  return /[*?[{]/.test(String(value || ''));
}

function isPlannedOrDescriptiveArtifact(value) {
  const raw = String(value || '').trim();
  const lower = raw.toLowerCase();
  return (
    /\((?:new|to be written|modified|existing|step-|pass-|created|extended|no direct edit|transitively covered)/i.test(raw) ||
    lower.includes('to be written') ||
    lower.includes('any codex-cli-run') ||
    raw.includes('<') ||
    raw.includes('#') ||
    raw.startsWith('~/')
  );
}

function artifactExists(projectRoot, artifactPath) {
  const clean = String(artifactPath || '').trim();
  if (!clean || isGlobLike(clean)) return true;
  if (isPlannedOrDescriptiveArtifact(clean)) return true;
  const withoutMarker = clean.replace(/\s+\([^)]*\)$/i, '');
  const abs = path.isAbsolute(withoutMarker) ? withoutMarker : path.join(projectRoot, withoutMarker);
  return fs.existsSync(abs);
}

function taskPlanSpider(projectRoot) {
  const spiderId = 'task-plan-spider';
  const findings = [];

  for (const filePath of listTaskPlanFiles(projectRoot)) {
    const plan = safeReadJson(filePath);
    if (!plan || typeof plan !== 'object') continue;
    const owned = Array.isArray(plan.scope_identity?.owned_artifacts) ? plan.scope_identity.owned_artifacts : [];
    const missing = owned.filter((artifact) => !artifactExists(projectRoot, artifact));
    if (missing.length === 0) continue;
    const finding = makeFinding(
      spiderId,
      `missing-owned-artifacts:${plan.task_id || rel(projectRoot, filePath)}`,
      'task_plan_owned_artifact_missing',
      'medium',
      'needs_review',
      'Task plan declares owned artifacts that are not present on disk and are not marked NEW or glob-like.',
      [rel(projectRoot, filePath), ...missing],
      `/review-task-plan ${plan.task_id || rel(projectRoot, filePath)}`,
      {
        habitat: '_dev/reports/analysis/task-plans/ and clients/*/plans/',
        confidence: 'probable',
        notes: `Missing: ${missing.join(', ')}`
      }
    );
    finding.classification = plan.status === 'complete' || plan.outcome_delta?.completed === true
      ? 'stale-plan'
      : classifyOwnedArtifactFinding(finding);
    findings.push(finding);
  }

  return {
    summary: spiderSummary(
      spiderId,
      'Task Plan Spider',
      ['_dev/reports/analysis/task-plans/', 'clients/*/plans/'],
      ['task_plan_owned_artifact_missing'],
      findings
    ),
    findings
  };
}

function verificationSignalSpider(projectRoot) {
  const spiderId = 'verification-signal-spider';
  const signalsDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  const findings = [];

  for (const filePath of listFiles(signalsDir, (item) => item.endsWith('.json'))) {
    const signal = safeReadJson(filePath);
    if (!signal || typeof signal !== 'object') continue;
    if (!String(signal.schema || '').startsWith('VerificationSignal/')) continue;
    if (signal.verdict !== 'FAIL') continue;
    findings.push(makeFinding(
      spiderId,
      `failing-verification:${rel(projectRoot, filePath)}`,
      'failing_verification_signal',
      'high',
      'mechanical_review',
      'Verification signal records a failed verdict.',
      [rel(projectRoot, filePath)],
      `/review-progress ${signal.scope || rel(projectRoot, filePath)}`,
      {
        habitat: '_dev/reports/signals/',
        confidence: 'confirmed',
        notes: signal.gate_decision?.reason || ''
      }
    ));
  }

  return {
    summary: spiderSummary(
      spiderId,
      'Verification Signal Spider',
      ['_dev/reports/signals/'],
      ['failing_verification_signal'],
      findings
    ),
    findings
  };
}

function summarize(spiders, findings) {
  const bySpider = {};
  const byDietClass = {};
  const bySeverity = {};
  const byActionability = {};
  for (const spider of spiders) bySpider[spider.id] = spider.finding_count;
  for (const finding of findings) {
    byDietClass[finding.diet_class] = (byDietClass[finding.diet_class] || 0) + 1;
    bySeverity[finding.severity] = (bySeverity[finding.severity] || 0) + 1;
    byActionability[finding.actionability] = (byActionability[finding.actionability] || 0) + 1;
  }
  return {
    total: findings.length,
    by_spider: bySpider,
    by_diet_class: byDietClass,
    by_severity: bySeverity,
    by_actionability: byActionability
  };
}

function buildSpiderLedger(projectRoot, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const results = [
    topologySpider(projectRoot, opts),
    commandSurfaceSpider(projectRoot),
    taskPlanSpider(projectRoot),
    verificationSignalSpider(projectRoot)
  ];
  const spiders = results.map((result) => result.summary);
  const findings = results.flatMap((result) => result.findings).sort((a, b) => a.id.localeCompare(b.id));
  const fingerprint = fingerprintFindings(findings);
  const loopStates = aggregateOwnedArtifactFindings(findings);
  const maintenanceDispositions = process.env.MAINTENANCE_DISPOSITION_V1 === '0' ? [] : findings.map((finding) => classifyMaintenanceDisposition({ projectRoot, finding, prior_dispositions: opts.priorDispositions || [] }));

  return {
    schema: 'SpiderLedger/1.0',
    timestamp: now.toISOString(),
    scope: 'spider-ledger',
    mode: 'read-only',
    authority: 'report-only',
    actor_continuity_kernel: {
      current_state: 'Mythos has bounded maintenance scouts, but bug detection needs a deterministic multi-spider evidence ledger.',
      question_work: 'Which declared spiders observe actionable bug evidence in their habitats?',
      desired_state: 'A future owl or orchestrate-loop session can route repairs from durable spider evidence without granting spiders mutation authority.'
    },
    source_artifacts: [
      'instructions/canonical/commands/council-of-owls.yaml',
      'tools/maintenance/lib/topology-scout.js',
      '_dev/reports/analysis/run-debrief__maintenance-topology-scout.md'
    ],
    spiders,
    summary: summarize(spiders, findings),
    fingerprint,
    findings,
    maintenance_dispositions: maintenanceDispositions,
    loop_states: loopStates,
    next_command: findings.length > 0 ? '/owl spider-ledger' : '/debrief-run spider-ledger'
  };
}

function formatMarkdown(ledger, jsonRelPath) {
  const lines = [
    '# Spider Ledger',
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
    '## Spiders',
    ''
  ];

  for (const spider of ledger.spiders) {
    lines.push(`- **${spider.id}**: ${spider.finding_count} finding(s); authority=${spider.authority}`);
  }

  lines.push('', '## Summary', '', `- Total findings: ${ledger.summary.total}`);
  for (const [dietClass, count] of Object.entries(ledger.summary.by_diet_class)) {
    lines.push(`- ${dietClass}: ${count}`);
  }

  lines.push('', '## Findings', '');
  if (ledger.findings.length === 0) {
    lines.push('- None');
  } else {
    for (const item of ledger.findings) {
      lines.push(`- **${item.spider_id}/${item.diet_class}** (${item.severity}, ${item.actionability}): ${item.message}`);
      lines.push(`  - Evidence: ${item.evidence_paths.map((p) => `\`${p}\``).join(', ')}`);
      lines.push(`  - Next: \`${item.recommended_next_command}\``);
      if (item.notes) lines.push(`  - Notes: ${item.notes}`);
    }
  }

  lines.push('', '## Next Command', '', `\`${ledger.next_command}\``);
  return `${lines.join('\n')}\n`;
}

function runSpiderLedger(projectRoot, opts = {}) {
  const ledger = buildSpiderLedger(projectRoot, opts);
  const timestampSafe = safeTimestampForFile(ledger.timestamp);
  const analysisDir = path.join(projectRoot, '_dev', 'reports', 'analysis');
  const jsonPath = opts.outputJsonPath || path.join(analysisDir, `spider-ledger__${timestampSafe}.json`);
  const markdownPath = opts.outputMarkdownPath || path.join(analysisDir, `spider-ledger__${timestampSafe}.md`);
  const paths = {
    jsonRelPath: rel(projectRoot, jsonPath),
    markdownRelPath: rel(projectRoot, markdownPath)
  };

  ensureDir(path.dirname(jsonPath));
  fs.writeFileSync(jsonPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  ensureDir(path.dirname(markdownPath));
  fs.writeFileSync(markdownPath, formatMarkdown(ledger, paths.jsonRelPath), 'utf8');

  return {
    ledger,
    jsonPath,
    markdownPath
  };
}

module.exports = {
  buildSpiderCouncilLedger: buildSpiderLedger,
  buildSpiderLedger,
  aggregateOwnedArtifactFindings,
  classifyOwnedArtifactFinding,
  commandSurfaceSpider,
  formatMarkdown,
  runSpiderCouncil: runSpiderLedger,
  runSpiderLedger,
  taskPlanSpider,
  topologySpider,
  verificationSignalSpider,
  OWNED_ARTIFACT_CLASSIFICATIONS,
  classifyMaintenanceDisposition
};
