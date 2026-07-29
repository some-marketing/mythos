'use strict';

const fs = require('fs');
const path = require('path');

const {
  listLiveHandoffSignals,
  validateHandoffSignal
} = require('../../verify/lib/signal.cjs');

const REPORT_SCHEMA = 'CodexBridgeHygieneReport/1.0';

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

function rel(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).replace(/\\/g, '/');
}

function normalizeActor(actor) {
  return String(actor || '').trim().toLowerCase();
}

function normalizeCommand(command) {
  return typeof command === 'string' ? command.trim() : '';
}

function normalizeScope(scope) {
  return String(scope || '').trim();
}

function authorityScope(signal) {
  return normalizeScope(signal && signal.signal_scope) || normalizeScope(signal && signal.scope);
}

function sanitizeScope(value) {
  const safe = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return safe || 'all';
}

function formatIsoForFile(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function parseTimestamp(value) {
  const ts = Date.parse(String(value || ''));
  return Number.isFinite(ts) ? ts : 0;
}

function isExactSlashCommand(command) {
  return normalizeCommand(command).startsWith('/');
}

function listCodexTargetSignals(projectRoot, scopeFilter = '') {
  const signalDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  const normalizedFilter = normalizeScope(scopeFilter);

  return listLiveHandoffSignals(signalDir).filter((info) => {
    if (normalizeActor(info.signal.recommended_next_actor) !== 'codex') {
      return false;
    }
    if (!normalizedFilter) {
      return true;
    }
    return authorityScope(info.signal) === normalizedFilter;
  });
}

function signalMatchesReference(projectRoot, signalInfo, reference) {
  const normalized = String(reference || '').trim();
  if (!normalized) return false;

  const currentName = path.basename(signalInfo.filePath);
  const currentRel = rel(projectRoot, signalInfo.filePath);

  return normalized === currentName
    || normalized === currentRel
    || normalized.endsWith(`/${currentName}`);
}

function findSupersedingSignals(projectRoot, allLiveSignals, currentInfo) {
  return allLiveSignals.filter((info) => {
    if (info.filePath === currentInfo.filePath) return false;
    return signalMatchesReference(projectRoot, currentInfo, info.signal.supersedes_signal);
  });
}

function duplicateGroup(codexSignals, currentInfo) {
  const key = authorityScope(currentInfo.signal);
  if (!key) return [];
  return codexSignals
    .filter((info) => authorityScope(info.signal) === key)
    .sort((left, right) => parseTimestamp(right.signal.timestamp) - parseTimestamp(left.signal.timestamp));
}

function extractArtifactErrors(errors) {
  return errors.filter((error) => error.startsWith('artifact does not exist:') || error.startsWith('decision context artifact does not exist:'));
}

function classifyCodexTargetSignal(projectRoot, currentInfo, codexSignals, allLiveSignals) {
  const signal = currentInfo.signal;
  const validation = validateHandoffSignal(signal, { projectRoot });
  const exactCommand = isExactSlashCommand(signal.recommended_next_command);
  const duplicates = duplicateGroup(codexSignals, currentInfo);
  const duplicateIndex = duplicates.findIndex((info) => info.filePath === currentInfo.filePath);
  const supersedingSignals = findSupersedingSignals(projectRoot, allLiveSignals, currentInfo);
  const issues = [];
  const missingArtifacts = extractArtifactErrors(validation.errors);
  let classification = 'keep-live';

  if (!parseTimestamp(signal.timestamp)) {
    issues.push('Signal timestamp is missing or invalid.');
  }
  if (!exactCommand) {
    issues.push(`recommended_next_command must be an exact slash command, got "${normalizeCommand(signal.recommended_next_command) || '(empty)'}".`);
  }
  if (signal.signal_type === 'ready-for-clear') {
    issues.push('ready-for-clear signals are not actionable Codex bridge authority.');
  }
  for (const error of validation.errors) {
    if (!issues.includes(error)) {
      issues.push(error);
    }
  }
  if (supersedingSignals.length > 0) {
    issues.push(`Superseded by newer live signal(s): ${supersedingSignals.map((info) => path.basename(info.filePath)).join(', ')}.`);
  }
  if (duplicateIndex > 0) {
    issues.push(`Older duplicate within authority scope "${authorityScope(signal) || '(none)'}".`);
  }

  if (supersedingSignals.length > 0) {
    classification = 'close';
  } else if (duplicateIndex > 0) {
    classification = 'close';
  } else if (missingArtifacts.length > 0) {
    classification = 'close';
  } else if (signal.signal_type === 'ready-for-clear') {
    classification = 'close';
  } else if (!exactCommand) {
    classification = 'reissue-with-exact-command';
  } else if (!validation.valid) {
    classification = 'reissue-with-exact-command';
  }

  return {
    file: path.basename(currentInfo.filePath),
    signal_path: rel(projectRoot, currentInfo.filePath),
    scope: normalizeScope(signal.scope),
    signal_scope: normalizeScope(signal.signal_scope),
    authority_scope: authorityScope(signal),
    signal_type: normalizeScope(signal.signal_type),
    source: normalizeScope(signal.source),
    timestamp: signal.timestamp || '',
    recommended_next_actor: normalizeActor(signal.recommended_next_actor),
    recommended_next_command: normalizeCommand(signal.recommended_next_command),
    exact_command: exactCommand,
    classification,
    issues,
    structural_validation: {
      valid: validation.valid,
      errors: validation.errors
    },
    superseded_by: supersedingSignals.map((info) => path.basename(info.filePath)),
    duplicate_group_size: duplicates.length,
    duplicate_rank: duplicateIndex >= 0 ? duplicateIndex + 1 : 0,
    missing_artifacts: missingArtifacts
  };
}

function readPlanningSurface(projectRoot) {
  const filePath = path.join(projectRoot, '_dev', 'reports', 'analysis', 'plan-active-workstreams.next-step.json');
  const parsed = safeReadJson(filePath);
  if (!parsed) {
    return {
      available: false,
      file: rel(projectRoot, filePath),
      next_recommended_command: '',
      exact_command: false,
      status: 'absent',
      detail: 'No plan-active-workstreams.next-step.json artifact is available.'
    };
  }

  const command = normalizeCommand(parsed.next_recommended_command);
  return {
    available: true,
    file: rel(projectRoot, filePath),
    next_recommended_command: command,
    exact_command: isExactSlashCommand(command),
    status: command ? (isExactSlashCommand(command) ? 'ok' : 'invalid') : 'empty',
    detail: command
      ? (isExactSlashCommand(command)
        ? `Planning surface recommends exact command ${command}.`
        : `Planning surface recommends non-command prose: "${command}".`)
      : 'Planning surface does not currently recommend a next command.'
  };
}

function buildSurfaceDecision(classifications, scopeFilter) {
  const keepLive = classifications.filter((item) => item.classification === 'keep-live');
  const closable = classifications.filter((item) => item.classification === 'close');
  const reissue = classifications.filter((item) => item.classification === 'reissue-with-exact-command');
  const dirtyScopes = new Set(
    [...closable, ...reissue]
      .map((item) => item.authority_scope)
      .filter(Boolean)
  );

  if (classifications.length === 0) {
    return {
      status: 'clear',
      reason: 'No live Codex-targeted coordination signals matched the requested scope.',
      exact_command: '',
      next_command: '',
      blocked_by: []
    };
  }

  if (closable.length > 0 || reissue.length > 0) {
    const blockedBy = [];
    if (closable.length > 0) {
      blockedBy.push(`${closable.length} live Codex-targeted signal(s) should be closed before autonomous continuation.`);
    }
    if (reissue.length > 0) {
      blockedBy.push(`${reissue.length} live Codex-targeted signal(s) require reissue with exact slash commands.`);
    }

    const targetScope = scopeFilter || (dirtyScopes.size === 1 ? [...dirtyScopes][0] : '');
    const nextCommand = targetScope ? `/normalize-signals ${targetScope}` : '/normalize-signals all';

    return {
      status: 'blocked',
      reason: 'Codex bridge authority is dirty and must be normalized before continuation.',
      exact_command: '',
      next_command: nextCommand,
      blocked_by: blockedBy
    };
  }

  if (keepLive.length > 1) {
    const scopes = keepLive.map((item) => item.authority_scope || item.file);
    return {
      status: 'blocked',
      reason: 'Multiple live Codex-targeted authority surfaces remain, so actor-level continuation is ambiguous.',
      exact_command: '',
      next_command: '/review-active-workstreams',
      blocked_by: [`Multiple live Codex-targeted scopes remain: ${scopes.join(', ')}.`]
    };
  }

  return {
    status: 'allowed',
    reason: `Exactly one live Codex-targeted authority surface remains: ${keepLive[0].file}.`,
    exact_command: keepLive[0].recommended_next_command,
    next_command: keepLive[0].recommended_next_command,
    blocked_by: []
  };
}

function buildPlanningAssessment(surfaceDecision, planningSurface) {
  if (!planningSurface.available) {
    return planningSurface;
  }

  if (surfaceDecision.status === 'blocked' && planningSurface.next_recommended_command && planningSurface.next_recommended_command !== surfaceDecision.next_command) {
    return {
      ...planningSurface,
      status: 'conflict',
      detail: `Planning surface recommends ${planningSurface.next_recommended_command}, but Codex bridge hygiene requires ${surfaceDecision.next_command}.`
    };
  }

  if (surfaceDecision.status === 'allowed' && planningSurface.next_recommended_command && planningSurface.next_recommended_command !== surfaceDecision.exact_command) {
    return {
      ...planningSurface,
      status: 'drift',
      detail: `Planning surface recommends ${planningSurface.next_recommended_command}, but live Codex bridge authority resolves to ${surfaceDecision.exact_command}.`
    };
  }

  return planningSurface;
}

function auditCodexBridge(projectRoot, opts = {}) {
  const timestamp = opts.timestamp || new Date().toISOString();
  const scopeFilter = normalizeScope(opts.scope || '');
  const allLiveSignals = listLiveHandoffSignals(path.join(projectRoot, '_dev', 'reports', 'signals'));
  const codexSignals = listCodexTargetSignals(projectRoot, scopeFilter);
  const classifications = codexSignals.map((info) => classifyCodexTargetSignal(projectRoot, info, codexSignals, allLiveSignals));
  const surface = buildSurfaceDecision(classifications, scopeFilter);
  const planningSurface = buildPlanningAssessment(surface, readPlanningSurface(projectRoot));

  const report = {
    schema: REPORT_SCHEMA,
    timestamp,
    actor: 'codex',
    scope_filter: scopeFilter || 'all',
    summary: {
      live_coordination_signals: allLiveSignals.length,
      codex_target_signals: codexSignals.length,
      keep_live: classifications.filter((item) => item.classification === 'keep-live').length,
      close: classifications.filter((item) => item.classification === 'close').length,
      reissue_with_exact_command: classifications.filter((item) => item.classification === 'reissue-with-exact-command').length
    },
    surface,
    planning_surface: planningSurface,
    signals: classifications,
    artifacts: {
      markdown: '',
      json: ''
    }
  };

  report.summary.blocked = surface.status === 'blocked';
  report.summary.allowed = surface.status === 'allowed';
  return report;
}

function writeMarkdownReport(filePath, report) {
  const lines = [
    '# Codex Bridge Hygiene Report',
    '',
    `- Timestamp: ${report.timestamp}`,
    `- Actor: \`${report.actor}\``,
    `- Scope filter: \`${report.scope_filter}\``,
    `- Surface status: ${report.surface.status}`,
    `- Reason: ${report.surface.reason}`,
    `- Exact command: ${report.surface.exact_command || '(none)'}`,
    `- Next command: ${report.surface.next_command || '(none)'}`,
    '',
    '## Summary',
    '',
    `- Live coordination signals: ${report.summary.live_coordination_signals}`,
    `- Codex-targeted live signals: ${report.summary.codex_target_signals}`,
    `- keep-live: ${report.summary.keep_live}`,
    `- close: ${report.summary.close}`,
    `- reissue-with-exact-command: ${report.summary.reissue_with_exact_command}`,
    ''
  ];

  lines.push('## Blockers');
  lines.push('');
  if (report.surface.blocked_by.length === 0) {
    lines.push('- None');
  } else {
    for (const blocker of report.surface.blocked_by) {
      lines.push(`- ${blocker}`);
    }
  }

  lines.push('');
  lines.push('## Planning Surface');
  lines.push('');
  lines.push(`- File: \`${report.planning_surface.file}\``);
  lines.push(`- Status: ${report.planning_surface.status}`);
  lines.push(`- Recommended command: ${report.planning_surface.next_recommended_command || '(none)'}`);
  lines.push(`- Detail: ${report.planning_surface.detail}`);
  lines.push('');
  lines.push('## Signal Classifications');
  lines.push('');
  if (report.signals.length === 0) {
    lines.push('- No live Codex-targeted signals matched the requested scope.');
  } else {
    for (const signal of report.signals) {
      lines.push(`- ${signal.file}: ${signal.classification}`);
      lines.push(`  Scope: ${signal.authority_scope || '(none)'}`);
      lines.push(`  Command: ${signal.recommended_next_command || '(empty)'}`);
      if (signal.issues.length === 0) {
        lines.push('  Issues: none');
      } else {
        for (const issue of signal.issues) {
          lines.push(`  Issue: ${issue}`);
        }
      }
    }
  }

  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function writeCodexBridgeHygieneArtifacts(projectRoot, report) {
  const analysisDir = path.join(projectRoot, '_dev', 'reports', 'analysis');
  const stamp = formatIsoForFile(new Date(report.timestamp));
  const safeScope = sanitizeScope(report.scope_filter);
  const baseName = `codex-bridge-hygiene__${stamp}__${safeScope}`;
  const jsonPath = path.join(analysisDir, `${baseName}.json`);
  const markdownPath = path.join(analysisDir, `${baseName}.md`);

  ensureDir(analysisDir);
  writeMarkdownReport(markdownPath, report);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  report.artifacts.markdown = rel(projectRoot, markdownPath);
  report.artifacts.json = rel(projectRoot, jsonPath);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  return report;
}

module.exports = {
  REPORT_SCHEMA,
  auditCodexBridge,
  isExactSlashCommand,
  listCodexTargetSignals,
  writeCodexBridgeHygieneArtifacts
};
