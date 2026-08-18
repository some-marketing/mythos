'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  chooseActorModel,
  chooseClaudeBudgetUsd,
  detectInstalledActors,
  inferWorkload,
  selectActorForMaintenance
} = require('../../signals/lib/actor-registry');
const {
  closeSignalInfo
} = require('../../signals/lib/actor-auto');
// closeLiveSignalsForScope MUST come from codex-auto: its 4th arg is an options
// object honoring excludePath + obligation_successor. actor-auto exports a
// same-named helper whose 4th arg is a reasonPrefix string — importing that one
// silently ignored excludePath and could close the just-written successor
// (Codex third-pass review 2026-06-10, MAJOR).
const { closeLiveSignalsForScope } = require('../../signals/lib/codex-auto');
const {
  createHandoffSignal,
  findConflictingLiveSignals,
  validateHandoffSignal
} = require('../../verify/lib/signal.cjs');
const { sanitizeScope } = require('../../signals/lib/codex-bridge');
const { closureEvidence } = require('../../signals/lib/closure-evidence.cjs');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function snippet(text, maxLength = 500) {
  const value = String(text || '').trim();
  if (!value) return '';
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function runNodeScript(projectRoot, relativePath, args = [], opts = {}) {
  const runner = opts.runner || spawnSync;
  const scriptPath = path.join(projectRoot, relativePath);
  const result = runner(
    process.execPath,
    [scriptPath, ...args],
    {
      cwd: projectRoot,
      encoding: 'utf8'
    }
  );

  return {
    status: result.status == null ? 1 : result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    error: result.error || null,
    command: `node ${relativePath}${args.length ? ` ${args.join(' ')}` : ''}`
  };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseArchiveCandidateCount(output) {
  const match = String(output || '').match(/Archive candidates:\s+(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function parseArtifactRetentionExceeded(output) {
  return /exceeds retention policy|surfaces exceed retention policy/i.test(String(output || ''));
}

function summarizeCloseoutFindings(parsed) {
  if (!parsed || !Array.isArray(parsed.findings)) {
    return 'Artifact completeness check failed.';
  }
  return parsed.findings
    .filter((finding) => finding.status === 'FAIL')
    .map((finding) => `${finding.id}: ${finding.message}`)
    .slice(0, 5);
}

function createCondition(id, type, severity, message, detail, extra = {}) {
  return {
    id,
    type,
    severity,
    message,
    detail,
    auto_fixable: Boolean(extra.auto_fixable),
    requires_write: Boolean(extra.requires_write),
    status: extra.status || 'detected',
    checks: extra.checks || [],
    command: extra.command || '',
    actor_hint: extra.actor_hint || '',
    stdout_excerpt: extra.stdout_excerpt || '',
    stderr_excerpt: extra.stderr_excerpt || ''
  };
}

function createAction(id, command, result, extra = {}) {
  return {
    id,
    command,
    success: Boolean(extra.success),
    dry_run: Boolean(extra.dry_run),
    stdout_excerpt: snippet(result && result.stdout),
    stderr_excerpt: snippet(result && result.stderr),
    detail: extra.detail || ''
  };
}

function normalizeSignalConflicts(projectRoot, conflicts, execute) {
  const actions = [];
  if (!Array.isArray(conflicts) || conflicts.length === 0) {
    return actions;
  }

  for (const conflict of conflicts) {
    const kept = Array.isArray(conflict.signals) ? conflict.signals[0] : null;
    const staleSignals = Array.isArray(conflict.signals) ? conflict.signals.slice(1) : [];
    for (const info of staleSignals) {
      // L8 closure-requires-evidence (convene 20260610T175230Z; Codex review
      // 2026-06-10 MAJOR: this path bypassed the gate): an artifact-contracted
      // duplicate may close ONLY when the kept signal preserves the same
      // obligation (same recommended_next_command). Same signal_scope alone
      // does not prove obligation preservation.
      const evidence = closureEvidence(info.signal, projectRoot);
      const keptCommand = kept && kept.signal ? String(kept.signal.recommended_next_command || '') : '';
      const obligationPreserved = keptCommand
        && keptCommand === String(info.signal.recommended_next_command || '');
      if (evidence.required && !evidence.satisfied && !obligationPreserved) {
        actions.push({
          id: `signal_conflict:${info.name}`,
          command: `node tools/signals/close-signal.js --file ${info.name} --execute`,
          success: false,
          dry_run: !execute,
          stdout_excerpt: '',
          stderr_excerpt: '',
          detail: `SKIPPED (L8): duplicate of signal_scope ${conflict.signal_scope} has unmet obligation \`${evidence.command}\` and the kept signal does not carry the same command; close manually with --defer or after the artifacts exist`
        });
        continue;
      }
      if (!execute) {
        actions.push({
          id: `signal_conflict:${info.name}`,
          command: `node tools/signals/close-signal.js --file ${info.name} --execute`,
          success: true,
          dry_run: true,
          stdout_excerpt: '',
          stderr_excerpt: '',
          detail: `Would close duplicate live signal for signal_scope ${conflict.signal_scope}`
        });
        continue;
      }

      closeSignalInfo(
        projectRoot,
        info,
        'maintenance:closeout',
        `signal_conflict:${conflict.signal_scope}`,
        obligationPreserved ? { obligationSuccessor: kept.name } : {}
      );
      actions.push({
        id: `signal_conflict:${info.name}`,
        command: `node tools/signals/close-signal.js --file ${info.name} --execute`,
        success: true,
        dry_run: false,
        stdout_excerpt: '',
        stderr_excerpt: '',
        detail: `Closed duplicate live signal for signal_scope ${conflict.signal_scope}`
      });
    }
  }

  return actions;
}

function reportArtifacts(projectRoot, scope, timestamp) {
  const safeScope = sanitizeScope(scope || 'latest');
  const analysisDir = path.join(projectRoot, '_dev', 'reports', 'analysis');
  return {
    markdownPath: path.join(analysisDir, `closeout-maintenance__${timestamp}__${safeScope}.md`),
    jsonPath: path.join(analysisDir, `closeout-maintenance__${timestamp}__${safeScope}.json`)
  };
}

function writeMarkdownReport(filePath, report) {
  const lines = [
    '# Closeout Maintenance Report',
    '',
    `- Timestamp: ${report.timestamp}`,
    `- Scope: \`${report.scope}\``,
    `- Execute mode: ${report.execute ? 'apply' : 'preview'}`,
    `- Clearance: ${report.clearance}`,
    ''
  ];

  lines.push('## Conditions');
  lines.push('');
  if (report.conditions.length === 0) {
    lines.push('- None');
  } else {
    for (const condition of report.conditions) {
      lines.push(`- [${condition.severity}] ${condition.type}: ${condition.message}`);
      if (condition.detail) {
        lines.push(`  Detail: ${condition.detail}`);
      }
    }
  }

  lines.push('');
  lines.push('## Auto Actions');
  lines.push('');
  if (report.auto_actions.length === 0) {
    lines.push('- None');
  } else {
    for (const action of report.auto_actions) {
      lines.push(`- ${action.id}: ${action.command}`);
      lines.push(`  Success: ${action.success ? 'yes' : 'no'}${action.dry_run ? ' (dry-run)' : ''}`);
      if (action.detail) lines.push(`  Detail: ${action.detail}`);
      if (action.stdout_excerpt) lines.push(`  Stdout: ${action.stdout_excerpt}`);
      if (action.stderr_excerpt) lines.push(`  Stderr: ${action.stderr_excerpt}`);
    }
  }

  lines.push('');
  lines.push('## Unresolved Conditions');
  lines.push('');
  if (report.unresolved_conditions.length === 0) {
    lines.push('- None');
  } else {
    for (const condition of report.unresolved_conditions) {
      lines.push(`- [${condition.severity}] ${condition.type}: ${condition.message}`);
      if (condition.detail) {
        lines.push(`  Detail: ${condition.detail}`);
      }
    }
  }

  lines.push('');
  lines.push('## Dispatches');
  lines.push('');
  if (report.dispatches.length === 0) {
    lines.push('- None');
  } else {
    for (const dispatch of report.dispatches) {
      lines.push(`- ${dispatch.actor || 'operator'} -> ${dispatch.command}`);
      lines.push(`  Signal: ${dispatch.signal_path}`);
    }
  }

  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

function emitMaintenanceDispatch(projectRoot, report, opts = {}) {
  if (!Array.isArray(report.unresolved_conditions) || report.unresolved_conditions.length === 0) {
    return null;
  }

  const runtimes = opts.runtimes || detectInstalledActors();
  const selectedActor = selectActorForMaintenance(report.unresolved_conditions, { runtimes });
  const actorId = selectedActor ? selectedActor.id : 'operator';
  const workload = report.unresolved_conditions.some((condition) => condition.severity === 'critical' || condition.requires_write)
    ? 'medium'
    : 'low';
  const signalScope = `maintenance-closeout:${report.scope}`;
  const timestamp = report.timestamp.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const safeScope = sanitizeScope(signalScope);
  const signalDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  const signalPath = path.join(signalDir, `ready-for-review__${timestamp}__${safeScope}.json`);

  // WRITE-THEN-CLOSE (Codex re-review 2026-06-10): priors close only after the
  // replacement signal exists on disk — see the matching reorder in
  // emitLessonsReconciliationSignal. Closing first left a failure window where
  // a validation/write error erased the maintenance obligation entirely.

  const reportJsonRelPath = path.relative(projectRoot, report.report_paths.jsonPath);
  const reportMarkdownRelPath = path.relative(projectRoot, report.report_paths.markdownPath);
  const signalType = selectedActor ? 'ready-for-review' : 'blocked';
  const nextSteps = [
    `Read ${reportJsonRelPath} first.`,
    'Resolve only the unresolved maintenance conditions listed in the report.',
    'If a condition needs judgment instead of a mechanical fix, publish a truthful follow-up signal instead of guessing.',
    'Preserve the exact next command unless the report proves a different command is necessary.'
  ];

  const maintenanceSignal = createHandoffSignal(
    'maintenance-router',
    `closeout-maintenance:${report.scope}`,
    signalType,
    {
      artifacts: [reportMarkdownRelPath, reportJsonRelPath],
      validation: {
        ran: true,
        summary: `Closeout maintenance found ${report.unresolved_conditions.length} unresolved condition(s).`
      },
      recommended_next_actor: actorId,
      recommended_next_command: '/review-progress closeout-maintenance',
      next_step_detail: nextSteps,
      blocked_by: report.unresolved_conditions.map((condition) => condition.message).slice(0, 5),
      ready_for_clear: false,
      signal_scope: signalScope
    }
  );

  const executionMode = report.unresolved_conditions.some((condition) => condition.requires_write)
    ? 'patch-allowed'
    : 'read-only';
  maintenanceSignal.execution = {
    mode: executionMode,
    cwd: '.',
    timeout_ms: 900000
  };

  if (selectedActor) {
    const model = chooseActorModel(actorId, workload);
    if (model) {
      maintenanceSignal.execution.model = model;
    }
    if (actorId === 'claude') {
      maintenanceSignal.execution.max_budget_usd = chooseClaudeBudgetUsd(workload);
    }
  }

  const validation = validateHandoffSignal(maintenanceSignal, { projectRoot });
  if (!validation.valid) {
    throw new Error(`Maintenance dispatch signal validation failed: ${validation.errors.join('; ')}`);
  }

  ensureDir(path.dirname(signalPath));
  fs.writeFileSync(signalPath, JSON.stringify(maintenanceSignal, null, 2));

  // Successor exists — closing priors is now a legal supersession; exclude the
  // just-written signal (same scope) and record it as the obligation successor.
  closeLiveSignalsForScope(projectRoot, signalScope, 'maintenance:closeout', {
    excludePath: signalPath
  });

  return {
    actor: actorId,
    command: maintenanceSignal.recommended_next_command,
    signal_path: path.relative(projectRoot, signalPath),
    signal_scope: signalScope
  };
}

function analyzeAndApplyCloseoutMaintenance(projectRoot, opts = {}) {
  const execute = Boolean(opts.execute);
  const scope = String(opts.scope || 'latest').trim() || 'latest';
  const timestamp = opts.timestamp || new Date().toISOString();
  const ageDays = Number.isFinite(Number(opts.ageDays)) ? Number(opts.ageDays) : 7;
  const report = {
    schema: 'CloseoutMaintenance/1.0',
    timestamp,
    scope,
    execute,
    conditions: [],
    auto_actions: [],
    unresolved_conditions: [],
    dispatches: [],
    clearance: 'pass',
    report_paths: {}
  };

  const scopeArgs = scope && scope !== 'latest' ? ['--scope', scope] : [];
  const closeoutResult = runNodeScript(
    projectRoot,
    'tools/verify/verify-artifact-completeness.cjs',
    [...scopeArgs, '--json'],
    opts
  );
  const closeoutJson = parseJson(closeoutResult.stdout);
  if (!closeoutJson || closeoutJson.verdict === 'FAIL') {
    report.conditions.push(createCondition(
      'closeout_artifact_gap',
      'closeout_artifact_gap',
      'critical',
      'Closeout artifact completeness is failing.',
      summarizeCloseoutFindings(closeoutJson).join(' | ') || snippet(closeoutResult.stdout || closeoutResult.stderr),
      {
        auto_fixable: false,
        requires_write: false,
        command: closeoutResult.command,
        stdout_excerpt: snippet(closeoutResult.stdout),
        stderr_excerpt: snippet(closeoutResult.stderr)
      }
    ));
  }

  const manifestCheck = runNodeScript(
    projectRoot,
    'tools/verify/sync-manifest.cjs',
    ['--check'],
    opts
  );
  if (manifestCheck.status !== 0) {
    const condition = createCondition(
      'manifest_drift',
      'manifest_drift',
      'warning',
      'Managed manifest assets are out of sync with the repo surface.',
      snippet(manifestCheck.stdout || manifestCheck.stderr),
      {
        auto_fixable: true,
        requires_write: true,
        command: manifestCheck.command,
        stdout_excerpt: snippet(manifestCheck.stdout),
        stderr_excerpt: snippet(manifestCheck.stderr)
      }
    );
    report.conditions.push(condition);
    if (execute) {
      const syncResult = runNodeScript(projectRoot, 'tools/verify/sync-manifest.cjs', [], opts);
      report.auto_actions.push(createAction('manifest:sync', syncResult.command, syncResult, {
        success: syncResult.status === 0,
        detail: 'Synchronized manifest references with assets on disk.'
      }));
      const recheck = runNodeScript(projectRoot, 'tools/verify/sync-manifest.cjs', ['--check'], opts);
      if (recheck.status !== 0) {
        condition.status = 'unresolved';
        condition.auto_fix_failed = true;
      } else {
        condition.status = 'resolved';
      }
    }
  }

  const instructionsValidate = runNodeScript(projectRoot, 'tools/instructions/validate.js', [], opts);
  if (instructionsValidate.status !== 0) {
    const condition = createCondition(
      'instruction_drift',
      'instruction_drift',
      'warning',
      'Generated instruction surfaces are drifting from canonical sources.',
      snippet(instructionsValidate.stdout || instructionsValidate.stderr),
      {
        auto_fixable: true,
        requires_write: true,
        command: instructionsValidate.command,
        stdout_excerpt: snippet(instructionsValidate.stdout),
        stderr_excerpt: snippet(instructionsValidate.stderr)
      }
    );
    report.conditions.push(condition);
    if (execute) {
      const generateResult = runNodeScript(projectRoot, 'tools/instructions/generate.js', [], opts);
      report.auto_actions.push(createAction('instructions:generate', generateResult.command, generateResult, {
        success: generateResult.status === 0,
        detail: 'Regenerated harness-native instruction surfaces.'
      }));
      const revalidate = runNodeScript(projectRoot, 'tools/instructions/validate.js', [], opts);
      report.auto_actions.push(createAction('instructions:validate', revalidate.command, revalidate, {
        success: revalidate.status === 0,
        detail: 'Revalidated generated instruction surfaces after regeneration.'
      }));
      if (revalidate.status !== 0) {
        condition.status = 'unresolved';
        condition.auto_fix_failed = true;
      } else {
        condition.status = 'resolved';
      }
    }
  }

  const conflicts = findConflictingLiveSignals(path.join(projectRoot, '_dev', 'reports', 'signals'));
  if (conflicts.length > 0) {
    const condition = createCondition(
      'signal_surface_conflict',
      'signal_surface_conflict',
      'warning',
      `Live coordination signals conflict across ${conflicts.length} signal_scope group(s).`,
      conflicts.map((conflict) => `${conflict.signal_scope} (${conflict.signals.length})`).join(', '),
      {
        auto_fixable: true,
        requires_write: true
      }
    );
    report.conditions.push(condition);
    report.auto_actions.push(...normalizeSignalConflicts(projectRoot, conflicts, execute));
    if (execute) {
      const remainingConflicts = findConflictingLiveSignals(path.join(projectRoot, '_dev', 'reports', 'signals'));
      if (remainingConflicts.length > 0) {
        condition.status = 'unresolved';
        condition.auto_fix_failed = true;
      } else {
        condition.status = 'resolved';
      }
    }
  }

  // A genuinely read-only caller (opts.report === false, e.g. review-closure
  // status collection) must not dirty the worktree: archive-finished.js's
  // preview mode otherwise appends a dry-run entry to _dev/logs/archive.jsonl
  // "for auditability" even without --execute. Suppress that write here;
  // --no-log has no effect on the actual archive decision or its stdout
  // summary. Codex review, PR #18.
  const archivePreviewArgs = opts.report === false
    ? ['--age', String(ageDays), '--no-log']
    : ['--age', String(ageDays)];
  const archivePreview = runNodeScript(
    projectRoot,
    'tools/artifacts/archive-finished.js',
    archivePreviewArgs,
    opts
  );
  const archiveCandidates = parseArchiveCandidateCount(archivePreview.stdout);
  if (archiveCandidates > 0) {
    const condition = createCondition(
      'finished_analysis_archiveable',
      'finished_analysis_archiveable',
      'warning',
      `${archiveCandidates} finished analysis artifact(s) are ready to archive.`,
      snippet(archivePreview.stdout),
      {
        auto_fixable: true,
        requires_write: true,
        command: archivePreview.command,
        stdout_excerpt: snippet(archivePreview.stdout),
        stderr_excerpt: snippet(archivePreview.stderr)
      }
    );
    report.conditions.push(condition);
    if (execute) {
      const archiveApply = runNodeScript(
        projectRoot,
        'tools/artifacts/archive-finished.js',
        ['--execute', '--age', String(ageDays)],
        opts
      );
      report.auto_actions.push(createAction('artifacts:archive', archiveApply.command, archiveApply, {
        success: archiveApply.status === 0,
        detail: 'Archived finished analysis artifacts from the hot surface.'
      }));
      const archiveRecheck = runNodeScript(
        projectRoot,
        'tools/artifacts/archive-finished.js',
        ['--age', String(ageDays)],
        opts
      );
      if (parseArchiveCandidateCount(archiveRecheck.stdout) > 0) {
        condition.status = 'unresolved';
        condition.auto_fix_failed = true;
      } else {
        condition.status = 'resolved';
      }
    }
  }

  const artifactStatus = runNodeScript(projectRoot, 'tools/artifacts/artifact-status.js', [], opts);
  if (artifactStatus.status !== 0 || parseArtifactRetentionExceeded(artifactStatus.stdout)) {
    report.conditions.push(createCondition(
      'artifact_retention_candidates',
      'artifact_retention_candidates',
      'warning',
      'Artifact retention policy reports excess files on one or more surfaces.',
      snippet(artifactStatus.stdout || artifactStatus.stderr),
      {
        auto_fixable: false,
        requires_write: false,
        command: artifactStatus.command,
        stdout_excerpt: snippet(artifactStatus.stdout),
        stderr_excerpt: snippet(artifactStatus.stderr)
      }
    ));
  }

  report.unresolved_conditions = report.conditions.filter((condition) => {
    if (!execute) return true;
    return condition.status !== 'resolved';
  });

  if (report.unresolved_conditions.length === 0) {
    report.clearance = 'pass';
  } else if (!execute && report.unresolved_conditions.some((condition) => condition.auto_fixable)) {
    report.clearance = 'deferred';
  } else {
    report.clearance = 'blocked';
  }

  if (opts.report !== false) {
    report.report_paths = reportArtifacts(projectRoot, scope, timestamp.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'));
    writeMarkdownReport(report.report_paths.markdownPath, report);
    ensureDir(path.dirname(report.report_paths.jsonPath));
    fs.writeFileSync(report.report_paths.jsonPath, JSON.stringify(report, null, 2));
  }

  if (opts.report !== false && report.unresolved_conditions.length > 0 && opts.emitDispatch !== false) {
    const dispatch = emitMaintenanceDispatch(projectRoot, report, {
      runtimes: detectInstalledActors()
    });
    if (dispatch) {
      report.dispatches.push(dispatch);
      fs.writeFileSync(report.report_paths.jsonPath, JSON.stringify(report, null, 2));
      writeMarkdownReport(report.report_paths.markdownPath, report);
    }
  }

  return report;
}

module.exports = {
  analyzeAndApplyCloseoutMaintenance,
  createAction,
  createCondition,
  emitMaintenanceDispatch,
  normalizeSignalConflicts,
  parseArchiveCandidateCount,
  reportArtifacts,
  runNodeScript,
  snippet,
  summarizeCloseoutFindings,
  writeMarkdownReport
};
