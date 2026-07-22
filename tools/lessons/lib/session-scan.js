'use strict';

const fs = require('fs');
const path = require('path');

const TEXT_EXTENSIONS = new Set([
  '.md',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.js',
  '.cjs'
]);

const SCAN_ROOTS = Object.freeze([
  '_dev/reports/analysis',
  '_dev/concepts',
  'clients',
  'tools'
]);

/**
 * Provenance fields to capture from structured artifacts (JSON) for
 * distinct-intelligence validation downstream.
 */
const PROVENANCE_KEYS = Object.freeze([
  'produced_by_actor_id',
  'produced_by_actor_type',
  'produced_by_harness_id',
  'validated_by_actor_id',
  'validated_by_actor_type',
  'validated_by_harness_id',
  'validation_artifact'
]);

const EXCLUDED_PATTERNS = Object.freeze([
  /^_dev\/archive\//,
  /^_dev\/reports\/analysis\/session-bundles\//,
  /\/node_modules\//,
  /\/\.git\//,
  /\/screenshots\//,
  /\/reports\/extracted\//,
  /\/extracted\//
]);

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function assertDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date: ${value}. Use YYYY-MM-DD, today, or latest.`);
  }
  return value;
}

function listScanFiles(rootDir, relDir = '') {
  const absDir = path.join(rootDir, relDir);
  if (!fs.existsSync(absDir)) return [];

  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relPath = relDir ? path.join(relDir, entry.name) : entry.name;
    const normalized = relPath.split(path.sep).join('/');
    if (EXCLUDED_PATTERNS.some((pattern) => pattern.test(normalized))) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...listScanFiles(rootDir, relPath));
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) {
      continue;
    }

    files.push(normalized);
  }

  return files;
}

function localDateFromStat(stat) {
  return formatLocalDate(new Date(stat.mtimeMs));
}

function detectProject(relPath) {
  const projectMatch = relPath.match(/^clients\/([^/]+)\/projects\/([^/]+)/);
  if (projectMatch) {
    return `${projectMatch[1]}/${projectMatch[2]}`;
  }

  const clientToolsMatch = relPath.match(/^clients\/([^/]+)\/tools\//);
  if (clientToolsMatch) {
    return `${clientToolsMatch[1]}/tools`;
  }

  return '';
}

function classifyPath(relPath) {
  const normalized = relPath.split(path.sep).join('/');
  const base = path.basename(normalized);
  const ext = path.extname(base).toLowerCase();

  const rules = [
    {
      test: () => normalized.startsWith('_dev/reports/analysis/session-learnings__') && ext === '.md',
      kind: 'session_learnings',
      bucket: 'primary',
      priority: 100,
      label: 'Session Learnings'
    },
    {
      test: () => normalized.startsWith('_dev/reports/analysis/run-debrief__') && base.endsWith('.improve-plan.json'),
      kind: 'improve_plan',
      bucket: 'primary',
      priority: 99,
      label: 'Improve Plan'
    },
    {
      test: () => normalized.startsWith('_dev/reports/analysis/run-debrief__') && base.endsWith('.replicate-plan.json'),
      kind: 'replicate_plan',
      bucket: 'primary',
      priority: 99,
      label: 'Replicate Plan'
    },
    {
      test: () => normalized.startsWith('_dev/reports/analysis/run-debrief__') && ext === '.md',
      kind: 'run_debrief',
      bucket: 'primary',
      priority: 98,
      label: 'Run Debrief'
    },
    {
      test: () => normalized.startsWith('_dev/reports/analysis/lessons-reconciliation__') && ext === '.md',
      kind: 'lessons_reconciliation',
      bucket: 'primary',
      priority: 97,
      label: 'Lessons Reconciliation'
    },
    {
      test: () => normalized.startsWith('_dev/reports/analysis/lessons-reconciliation__') && base.endsWith('.expectation-failures.json'),
      kind: 'lessons_reconciliation_failures',
      bucket: 'primary',
      priority: 96,
      label: 'Lessons Reconciliation Failures'
    },
    {
      test: () => base.endsWith('.expectation-failures.json'),
      kind: 'expectation_failures',
      bucket: 'primary',
      priority: 95,
      label: 'Expectation Failures'
    },
    {
      test: () => normalized.startsWith('_dev/reports/analysis/review-progress__') && ext === '.md',
      kind: 'review_progress',
      bucket: 'primary',
      priority: 94,
      label: 'Review Progress'
    },
    {
      test: () => normalized.startsWith('_dev/reports/analysis/advance-pipeline__') && ext === '.md',
      kind: 'advance_pipeline',
      bucket: 'primary',
      priority: 93,
      label: 'Advance Pipeline'
    },
    {
      test: () => normalized.startsWith('_dev/reports/analysis/closeout-maintenance__'),
      kind: 'maintenance_report',
      bucket: 'primary',
      priority: 90,
      label: 'Maintenance Report'
    },
    {
      test: () => /\/captures\/[^/]+\//.test(normalized),
      kind: 'capture_artifact',
      bucket: 'supporting',
      priority: 88,
      label: 'Capture Artifact'
    },
    {
      test: () => /^clients\/[^/]+\/projects\/[^/]+\/verification\/.+\.json$/.test(normalized),
      kind: 'verification_signal',
      bucket: 'supporting',
      priority: 87,
      label: 'Verification Artifact'
    },
    {
      test: () => base.startsWith('WHATS_NEXT') && ext === '.md',
      kind: 'project_handoff',
      bucket: 'supporting',
      priority: 86,
      label: 'Project Handoff'
    },
    {
      test: () => base.startsWith('CLAUDE_') && ext === '.md',
      kind: 'project_brief',
      bucket: 'supporting',
      priority: 85,
      label: 'Project Brief'
    },
    {
      test: () => base === 'EXPECTED_OUTCOMES.md',
      kind: 'expected_outcomes',
      bucket: 'supporting',
      priority: 84,
      label: 'Expected Outcomes'
    },
    {
      test: () => /^clients\/[^/]+\/projects\/[^/]+\/reports\/.+\.(md|json|jsonl)$/.test(normalized),
      kind: 'project_report',
      bucket: 'supporting',
      priority: 83,
      label: 'Project Report'
    },
    {
      test: () => /^clients\/[^/]+\/projects\/[^/]+\/evidence\/.+\.(md|json)$/.test(normalized),
      kind: 'structured_evidence',
      bucket: 'supporting',
      priority: 82,
      label: 'Structured Evidence'
    },
    {
      test: () => normalized.startsWith('_dev/concepts/') && ext === '.md',
      kind: 'concept',
      bucket: 'supporting',
      priority: 81,
      label: 'Concept Doc'
    },
    {
      test: () => normalized.startsWith('tools/') && (ext === '.js' || ext === '.cjs'),
      kind: 'tooling',
      bucket: 'supporting',
      priority: 80,
      label: 'Tooling Surface'
    },
    {
      test: () => base === 'project.json' && /^clients\/[^/]+\/projects\/[^/]+\//.test(normalized),
      kind: 'project_metadata',
      bucket: 'supporting',
      priority: 75,
      label: 'Project Metadata'
    }
  ];

  for (const rule of rules) {
    if (rule.test()) {
      return {
        kind: rule.kind,
        bucket: rule.bucket,
        priority: rule.priority,
        label: rule.label
      };
    }
  }

  return null;
}

function matchDateReasons(relPath, stat, targetDate) {
  const reasons = [];
  const base = path.basename(relPath);
  const compactDate = targetDate.replace(/-/g, '');

  if (base.includes(targetDate)) {
    reasons.push('filename-date');
  }
  if (base.includes(compactDate)) {
    reasons.push('filename-compact-date');
  }
  if (localDateFromStat(stat) === targetDate) {
    reasons.push('mtime-date');
  }

  return reasons;
}

function compareCandidates(left, right) {
  if (left.bucket !== right.bucket) {
    return left.bucket === 'primary' ? -1 : 1;
  }
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }
  if (left.mtime !== right.mtime) {
    return right.mtime.localeCompare(left.mtime);
  }
  return left.path.localeCompare(right.path);
}

function shouldBypassProjectFilter(kind) {
  return kind === 'session_learnings'
    || kind === 'lessons_reconciliation'
    || kind === 'lessons_reconciliation_failures';
}

/**
 * Extract provenance metadata from a JSON artifact file.
 * Returns an object with only the provenance keys that are present, or null
 * if the file is not JSON or contains no provenance fields.
 */
function extractProvenance(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  if (ext !== '.json') return null;

  try {
    const raw = fs.readFileSync(absPath, 'utf8');
    const data = JSON.parse(raw);
    const provenance = {};
    let found = false;
    for (const key of PROVENANCE_KEYS) {
      if (data[key] != null && data[key] !== '') {
        provenance[key] = data[key];
        found = true;
      }
    }
    return found ? provenance : null;
  } catch {
    return null;
  }
}

function summarizeCandidates(candidates) {
  const byKind = {};
  const byProject = {};

  for (const candidate of candidates) {
    byKind[candidate.kind] = (byKind[candidate.kind] || 0) + 1;
    if (candidate.project) {
      byProject[candidate.project] = (byProject[candidate.project] || 0) + 1;
    }
  }

  return {
    total: candidates.length,
    primary: candidates.filter((candidate) => candidate.bucket === 'primary').length,
    supporting: candidates.filter((candidate) => candidate.bucket === 'supporting').length,
    by_kind: byKind,
    by_project: byProject
  };
}

function findLatestRelevantDate(projectRoot) {
  let latestMs = 0;

  for (const scanRoot of SCAN_ROOTS) {
    const files = listScanFiles(projectRoot, scanRoot);
    for (const relPath of files) {
      const classification = classifyPath(relPath);
      if (!classification) continue;

      const absPath = path.join(projectRoot, relPath);
      let stat;
      try {
        stat = fs.statSync(absPath);
      } catch {
        continue; // dangling symlink or vanished file — skip, never abort the scan
      }
      if (stat.mtimeMs > latestMs) {
        latestMs = stat.mtimeMs;
      }
    }
  }

  if (latestMs === 0) {
    return formatLocalDate(new Date());
  }

  return formatLocalDate(new Date(latestMs));
}

function resolveTargetDate(projectRoot, rawDate, now = new Date()) {
  if (!rawDate || rawDate === 'today') {
    return formatLocalDate(now);
  }
  if (rawDate === 'latest') {
    return findLatestRelevantDate(projectRoot);
  }
  return assertDateString(rawDate);
}

function scanSessionData(projectRoot, options = {}) {
  const now = options.now || new Date();
  const targetDate = resolveTargetDate(projectRoot, options.date || 'today', now);
  const projectFilter = String(options.project_filter || '').trim().toLowerCase();

  const candidates = [];

  for (const scanRoot of SCAN_ROOTS) {
    const files = listScanFiles(projectRoot, scanRoot);
    for (const relPath of files) {
      const classification = classifyPath(relPath);
      if (!classification) continue;

      const absPath = path.join(projectRoot, relPath);
      let stat;
      try {
        stat = fs.statSync(absPath);
      } catch {
        continue; // dangling symlink or vanished file — skip, never abort the scan
      }
      const matchedBy = matchDateReasons(relPath, stat, targetDate);
      if (matchedBy.length === 0) continue;

      const project = detectProject(relPath);
      if (projectFilter) {
        const haystack = `${project} ${relPath}`.toLowerCase();
        const keepGlobalPrimary = shouldBypassProjectFilter(classification.kind);
        if (!keepGlobalPrimary && !haystack.includes(projectFilter)) {
          continue;
        }
      }

      const candidate = {
        path: relPath,
        project,
        kind: classification.kind,
        label: classification.label,
        bucket: classification.bucket,
        priority: classification.priority,
        matched_by: matchedBy,
        mtime: new Date(stat.mtimeMs).toISOString()
      };

      // Capture provenance metadata from structured artifacts so downstream
      // consumers (reconcile-lessons, improve-framework) can enforce the
      // distinct-intelligence validation law.
      const provenance = extractProvenance(absPath);
      if (provenance) {
        candidate.provenance = provenance;
      }

      candidates.push(candidate);
    }
  }

  candidates.sort(compareCandidates);

  const summary = summarizeCandidates(candidates);
  const suggestedInputs = candidates
    .filter((candidate) => candidate.bucket === 'primary' || candidate.priority >= 85)
    .map((candidate) => candidate.path);

  const notes = [];
  if (summary.primary === 0) {
    notes.push('No primary reconciliation inputs found for the target date. Produce session learnings or debrief artifacts before running reconcile-lessons.');
  }
  if (summary.supporting === 0) {
    notes.push('No supporting same-day context files were detected.');
  }

  return {
    schema: 'LessonsSessionScan/1.0',
    scanned_at: new Date(now).toISOString(),
    target_date: targetDate,
    filters: {
      project_filter: projectFilter || null
    },
    summary,
    candidates,
    suggested_reconcile_inputs: suggestedInputs,
    suggested_next_command: `/reconcile-lessons ${targetDate}`,
    notes
  };
}

function buildSessionScanMarkdown(scan) {
  const lines = [
    `# Lessons Session Scan — ${scan.target_date}`,
    '',
    `- Scanned at: ${scan.scanned_at}`,
    `- Suggested next command: \`${scan.suggested_next_command}\``,
    `- Total candidates: ${scan.summary.total}`,
    `- Primary reconcile inputs: ${scan.summary.primary}`,
    `- Supporting context files: ${scan.summary.supporting}`
  ];

  if (scan.filters.project_filter) {
    lines.push(`- Project filter: \`${scan.filters.project_filter}\``);
  }

  if (scan.notes.length > 0) {
    lines.push('', '## Notes', '');
    for (const note of scan.notes) {
      lines.push(`- ${note}`);
    }
  }

  const primary = scan.candidates.filter((candidate) => candidate.bucket === 'primary');
  const supporting = scan.candidates.filter((candidate) => candidate.bucket === 'supporting');

  lines.push('', '## Primary Reconcile Inputs', '');
  if (primary.length === 0) {
    lines.push('- none');
  } else {
    for (const candidate of primary) {
      const provenanceSuffix = candidate.provenance
        ? ` | producer: ${candidate.provenance.produced_by_actor_type || 'unknown'}`
        : '';
      lines.push(`- [${candidate.label}] \`${candidate.path}\` (${candidate.matched_by.join(', ')})${provenanceSuffix}`);
    }
  }

  lines.push('', '## Supporting Context', '');
  if (supporting.length === 0) {
    lines.push('- none');
  } else {
    for (const candidate of supporting) {
      const projectSuffix = candidate.project ? ` — ${candidate.project}` : '';
      lines.push(`- [${candidate.label}] \`${candidate.path}\`${projectSuffix}`);
    }
  }

  lines.push('', '## Active Projects', '');
  const projects = Object.entries(scan.summary.by_project)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  if (projects.length === 0) {
    lines.push('- none');
  } else {
    for (const [projectName, count] of projects) {
      lines.push(`- ${projectName}: ${count} file(s)`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function writeSessionScanArtifacts(projectRoot, scan) {
  const analysisDir = path.join(projectRoot, '_dev', 'reports', 'analysis');
  fs.mkdirSync(analysisDir, { recursive: true });

  const jsonPath = path.join(analysisDir, `lessons-scan__${scan.target_date}.json`);
  const markdownPath = path.join(analysisDir, `lessons-scan__${scan.target_date}.md`);

  fs.writeFileSync(jsonPath, `${JSON.stringify(scan, null, 2)}\n`);
  fs.writeFileSync(markdownPath, buildSessionScanMarkdown(scan));

  return {
    jsonPath,
    markdownPath
  };
}

module.exports = {
  buildSessionScanMarkdown,
  classifyPath,
  detectProject,
  extractProvenance,
  listScanFiles,
  matchDateReasons,
  PROVENANCE_KEYS,
  resolveTargetDate,
  scanSessionData,
  writeSessionScanArtifacts
};
