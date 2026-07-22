'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { assessSourceFreshness } = require('./build-improve-this-cache.cjs');

const SNAPSHOT_SCHEMA = 'RepoAwareness/1.0';
const CLOSEOUT_SCHEMA = 'RepoAwarenessCloseout/1.0';
const ACTOR_PACKET_SCHEMA = 'ActorAwarenessPacket/1.0';
const STATE_REL = path.join('_dev', 'state', 'repo-awareness');
const ACTOR_PACKET_REL = path.join(STATE_REL, 'actor-packets');
const IMPROVE_THIS_FILES = [
  'README.md',
  'repo-map.md',
  'commands.md',
  'conventions.md',
  'testing.md',
  'risks.md'
];

function summarizeContextBudget(projectRoot) {
  try {
    const { summarizeLatestContextBudget } = require('./context-budget.cjs');
    return summarizeLatestContextBudget(projectRoot);
  } catch (err) {
    return {
      available: false,
      latest_path: '_dev/state/context-budget/latest.json',
      lifecycle_state: 'unknown',
      observe_only: true,
      note: `Unable to inspect context budget: ${err && err.message ? err.message : String(err)}`
    };
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function rel(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).replace(/\\/g, '/');
}

function slug(value) {
  return String(value || 'unknown-session')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown-session';
}

function stateDir(projectRoot) {
  return path.join(projectRoot, STATE_REL);
}

function snapshotPath(projectRoot, sessionId) {
  return path.join(stateDir(projectRoot), `${slug(sessionId)}.json`);
}

function latestPath(projectRoot) {
  return path.join(stateDir(projectRoot), 'latest.json');
}

function closeoutPath(projectRoot, sessionId) {
  return path.join(stateDir(projectRoot), `${slug(sessionId)}__closeout.json`);
}

function actorPacketDir(projectRoot) {
  return path.join(projectRoot, ACTOR_PACKET_REL);
}

function actorPacketPath(projectRoot, packet) {
  const stamp = slug(packet.generated_at || nowIso()).replace(/[:.]/g, '-');
  const role = slug(packet.actor.role || 'actor');
  const task = slug(packet.actor.task || packet.actor.id || 'unscoped').slice(0, 80);
  return path.join(actorPacketDir(projectRoot), `${stamp}__${role}__${task}.json`);
}

function freshnessAge(generatedAt, nowMs = Date.now()) {
  const ts = Date.parse(generatedAt || '');
  if (!Number.isFinite(ts)) return 'unknown';
  const ageMs = nowMs - ts;
  if (ageMs < 0) return 'future';
  if (ageMs <= 24 * 60 * 60 * 1000) return 'fresh';
  if (ageMs <= 7 * 24 * 60 * 60 * 1000) return 'aging';
  return 'stale';
}

function assessImproveThis(projectRoot) {
  const root = path.join(projectRoot, '.improve-this');
  const freshnessPath = path.join(root, 'freshness.json');
  const exists = Boolean(safeStat(root));
  const freshness = safeReadJson(freshnessPath);
  const files = IMPROVE_THIS_FILES.map((name) => {
    const fullPath = path.join(root, name);
    const stat = safeStat(fullPath);
    return {
      path: `.improve-this/${name}`,
      exists: Boolean(stat && stat.isFile()),
      mtime: stat && stat.isFile() ? stat.mtime.toISOString() : null
    };
  });
  const missing = files.filter((file) => !file.exists).map((file) => file.path);
  const sourceFreshness = freshness ? assessSourceFreshness(projectRoot, freshness) : {
    checked: false,
    mismatches: [],
    missing: []
  };
  let status = 'missing';
  if (exists && freshness && missing.length === 0) status = freshnessAge(freshness.updated_at || freshness.generated_at);
  else if (exists) status = 'partial';
  if (status !== 'missing' && status !== 'partial' && (sourceFreshness.mismatches.length > 0 || sourceFreshness.missing.length > 0)) {
    status = 'stale';
  }

  return {
    exists,
    path: '.improve-this',
    freshness_path: '.improve-this/freshness.json',
    status,
    updated_at: freshness && freshness.updated_at || null,
    source_authority_order: freshness && Array.isArray(freshness.source_authority_order) ? freshness.source_authority_order : [],
    source_freshness: sourceFreshness,
    recommended_refresh_command: 'npm run context:improve-this:refresh',
    loaded_files: files.filter((file) => file.exists).map((file) => file.path),
    missing_files: missing
  };
}

function summarizePlanVisibility(projectRoot) {
  try {
    const { buildSummary } = require('../planning/where-plan-dashboard');
    const summary = buildSummary(projectRoot);
    return {
      generated: Boolean(summary.generated),
      freshness: summary.freshness || { status: 'missing' },
      counts: summary.counts || null,
      dashboard: '_dev/reports/analysis/plan-visibility__index.html',
      operator_brief: '_dev/reports/analysis/plan-visibility__operator-brief.md',
      commands: summary.commands || {
        regenerate: 'npm run plans:dashboard',
        locate: 'npm run plans:where'
      }
    };
  } catch (err) {
    return {
      generated: false,
      freshness: {
        status: 'unknown',
        message: `Unable to inspect plan visibility: ${err && err.message ? err.message : String(err)}`
      },
      counts: null,
      dashboard: '_dev/reports/analysis/plan-visibility__index.html',
      operator_brief: '_dev/reports/analysis/plan-visibility__operator-brief.md',
      commands: {
        regenerate: 'npm run plans:dashboard',
        locate: 'npm run plans:where'
      }
    };
  }
}

function summarizeBoundaries(projectRoot) {
  try {
    const { listPending } = require('../sessions/lib/boundary-markers.cjs');
    return listPending({ root: projectRoot }).map((marker) => ({
      scope: marker.scope,
      path: rel(projectRoot, marker.path),
      handoff_path: marker.payload.handoff_path,
      recommended_next_command: marker.payload.recommended_next_command,
      summary: marker.payload.summary || ''
    }));
  } catch (err) {
    return [{
      scope: 'unknown',
      path: '',
      handoff_path: '',
      recommended_next_command: '',
      summary: `Unable to inspect session boundaries: ${err && err.message ? err.message : String(err)}`
    }];
  }
}

function summarizeGit(projectRoot) {
  const result = spawnSync('git', ['status', '--short'], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 5000
  });
  if (result.error || result.status !== 0) {
    return {
      available: false,
      dirty: null,
      changed_count: null,
      sample: [],
      note: result.error ? result.error.message : String(result.stderr || '').trim()
    };
  }
  const lines = String(result.stdout || '').split('\n').filter(Boolean);
  return {
    available: true,
    dirty: lines.length > 0,
    changed_count: lines.length,
    sample: lines.slice(0, 40)
  };
}

function buildSnapshot(projectRoot, opts = {}) {
  const sessionId = opts.sessionId || process.env.SM_OS_SESSION_ID || process.env.CLAUDE_SESSION_ID || process.env.CODEX_SESSION_ID || `session-${Date.now()}`;
  const generatedAt = opts.generatedAt || nowIso();
  return {
    schema: SNAPSHOT_SCHEMA,
    session_id: sessionId,
    generated_at: generatedAt,
    source: opts.source || 'session-start',
    repo_root: projectRoot,
    improve_this: assessImproveThis(projectRoot),
    plan_visibility: summarizePlanVisibility(projectRoot),
    context_budget: summarizeContextBudget(projectRoot),
    pending_boundaries: summarizeBoundaries(projectRoot),
    authority_order: [
      'direct operator instruction',
      'local AGENTS.md and canonical command specs',
      'actual source files',
      'task plans, amendments, reviews, and signals',
      'next-session handoff and repo-awareness closeout delta',
      '.improve-this derived cache',
      'chat memory or compacted context'
    ],
    derived_context_notice: '.improve-this, plan dashboards, repo-awareness snapshots, memory, dream, and Obsidian surfaces are advisory/derived unless a canonical artifact explicitly promotes them.'
  };
}

function writeSnapshot(projectRoot, snapshot) {
  const dir = stateDir(projectRoot);
  ensureDir(dir);
  const target = snapshotPath(projectRoot, snapshot.session_id);
  const body = `${JSON.stringify(snapshot, null, 2)}\n`;
  fs.writeFileSync(target, body, 'utf8');
  fs.writeFileSync(latestPath(projectRoot), body, 'utf8');
  return {
    snapshot_path: rel(projectRoot, target),
    latest_path: rel(projectRoot, latestPath(projectRoot))
  };
}

function initRepoAwareness(projectRoot, opts = {}) {
  const snapshot = buildSnapshot(projectRoot, opts);
  const paths = writeSnapshot(projectRoot, snapshot);
  return { snapshot, paths };
}

function buildCloseout(projectRoot, opts = {}) {
  const sessionId = opts.sessionId || process.env.SM_OS_SESSION_ID || process.env.CLAUDE_SESSION_ID || process.env.CODEX_SESSION_ID || `session-${Date.now()}`;
  const generatedAt = opts.generatedAt || nowIso();
  const latest = safeReadJson(latestPath(projectRoot));
  const planVisibility = summarizePlanVisibility(projectRoot);
  const improveThis = assessImproveThis(projectRoot);
  const git = opts.includeGit === false ? null : summarizeGit(projectRoot);
  const scope = opts.scope || 'system';
  return {
    schema: CLOSEOUT_SCHEMA,
    scope,
    session_id: sessionId,
    generated_at: generatedAt,
    source: opts.source || 'session-end',
    handoff_path: opts.handoffPath || (latest && latest.pending_boundaries && latest.pending_boundaries[0] && latest.pending_boundaries[0].handoff_path) || '',
    recommended_next_command: opts.recommendedNextCommand || (latest && latest.pending_boundaries && latest.pending_boundaries[0] && latest.pending_boundaries[0].recommended_next_command) || '/whats-next',
    cache_status: {
      improve_this: {
        status: improveThis.status,
        updated_at: improveThis.updated_at,
        closeout_instruction: 'validate or refresh on next boot before actor dispatch'
      },
      plan_visibility: {
        status: planVisibility.freshness && planVisibility.freshness.status || 'unknown',
        message: planVisibility.freshness && planVisibility.freshness.message || '',
        recommended_refresh_command: 'npm run plans:dashboard'
      }
    },
    git,
    session_delta: {
      note: 'Bounded automatic closeout delta. This is not a full /shutdown replacement and does not promote memory.',
      completed: [],
      blocked: planVisibility.freshness && planVisibility.freshness.status === 'stale'
        ? ['plan visibility model is stale; refresh on next boot or before route decisions']
        : [],
      recommended_next_command: opts.recommendedNextCommand || '/whats-next'
    },
    authority_order: [
      'direct operator instruction',
      'local AGENTS.md and canonical command specs',
      'actual source files',
      'task plans, amendments, reviews, and signals',
      'next-session handoff and repo-awareness closeout delta',
      '.improve-this derived cache',
      'chat memory or compacted context'
    ]
  };
}

function writeCloseout(projectRoot, closeout) {
  const dir = stateDir(projectRoot);
  ensureDir(dir);
  const target = closeoutPath(projectRoot, closeout.session_id);
  fs.writeFileSync(target, `${JSON.stringify(closeout, null, 2)}\n`, 'utf8');
  return { closeout_path: rel(projectRoot, target) };
}

function closeoutRepoAwareness(projectRoot, opts = {}) {
  const closeout = buildCloseout(projectRoot, opts);
  const paths = writeCloseout(projectRoot, closeout);
  return { closeout, paths };
}

function loadLatestSnapshot(projectRoot) {
  return safeReadJson(latestPath(projectRoot));
}

function roleSections(role) {
  const normalized = String(role || '').toLowerCase();
  if (normalized.includes('review')) return ['repo-map', 'commands', 'testing', 'risks'];
  if (normalized.includes('doc')) return ['repo-map', 'commands', 'conventions'];
  if (normalized.includes('worker')) return ['repo-map', 'commands', 'conventions', 'testing'];
  if (normalized.includes('bridge')) return ['repo-map', 'commands', 'conventions', 'testing', 'risks'];
  return ['repo-map', 'commands', 'conventions', 'testing', 'risks'];
}

function buildActorAwarenessPacket(projectRoot, opts = {}) {
  const latest = loadLatestSnapshot(projectRoot) || buildSnapshot(projectRoot, {
    sessionId: opts.sessionId,
    source: 'actor-packet-fallback'
  });
  const role = opts.role || 'actor';
  const task = opts.task || opts.command || 'bounded actor work';
  const generatedAt = opts.generatedAt || nowIso();
  const pendingBoundaries = Array.isArray(latest.pending_boundaries) ? latest.pending_boundaries : [];
  const pendingBoundarySample = opts.includeBoundaryDetails
    ? pendingBoundaries.slice(0, 5)
    : pendingBoundaries.slice(0, 5).map((boundary) => ({
      scope: boundary.scope,
      path: boundary.path
    }));
  const packet = {
    schema: ACTOR_PACKET_SCHEMA,
    generated_at: generatedAt,
    source: opts.source || 'pre-agent',
    repo_root: projectRoot,
    actor: {
      id: opts.actorId || '',
      role,
      task,
      model_or_mind: opts.model || opts.mind || 'undisclosed-by-caller'
    },
    current_state: {
      repo_awareness_snapshot: '_dev/state/repo-awareness/latest.json',
      snapshot_generated_at: latest.generated_at || null,
      improve_this_status: latest.improve_this && latest.improve_this.status || 'unknown',
      plan_visibility_status: latest.plan_visibility && latest.plan_visibility.freshness && latest.plan_visibility.freshness.status || 'unknown',
      context_budget: summarizeContextBudget(projectRoot),
      pending_boundary_count: pendingBoundaries.length,
      pending_boundaries_sample: pendingBoundarySample,
      pending_boundaries_redacted: !opts.includeBoundaryDetails
    },
    question_or_work: task,
    desired_state: opts.desiredState || 'Return resulting state, changed files, commands/tests/smokes/reviews, blockers, and parent impact for delegated work.',
    recommended_cache_sections: roleSections(role),
    authority_order: latest.authority_order || buildSnapshot(projectRoot).authority_order,
    authority_boundary: 'This packet is derived startup context. Verify consequential claims against canonical command specs, task artifacts, and source files before acting.',
    return_contract: {
      required: [
        'resulting_state',
        'changed_files',
        'commands_or_tests',
        'blockers',
        'parent_impact'
      ],
      producer_cannot_validate_own_acceptance_grade_outcome: true
    }
  };
  return packet;
}

function writeActorAwarenessPacket(projectRoot, packet) {
  ensureDir(actorPacketDir(projectRoot));
  const target = actorPacketPath(projectRoot, packet);
  const body = `${JSON.stringify(packet, null, 2)}\n`;
  fs.writeFileSync(target, body, 'utf8');
  fs.writeFileSync(path.join(actorPacketDir(projectRoot), 'latest.json'), body, 'utf8');
  return {
    actor_packet_path: rel(projectRoot, target),
    latest_actor_packet_path: rel(projectRoot, path.join(actorPacketDir(projectRoot), 'latest.json'))
  };
}

function createActorAwarenessPacket(projectRoot, opts = {}) {
  const packet = buildActorAwarenessPacket(projectRoot, opts);
  const paths = writeActorAwarenessPacket(projectRoot, packet);
  return { packet, paths };
}

function formatInitSummary(result) {
  const snapshot = result.snapshot;
  const planFreshness = snapshot.plan_visibility.freshness || {};
  const lines = [
    `REPO AWARENESS: snapshot ${result.paths.snapshot_path}`,
    `  .improve-this: ${snapshot.improve_this.status}`,
    `  plan visibility: ${planFreshness.status || 'unknown'}`,
    `  context budget: ${snapshot.context_budget && snapshot.context_budget.lifecycle_state || 'unknown'}`
  ];
  if (planFreshness.message) lines.push(`  note: ${planFreshness.message}`);
  if (snapshot.pending_boundaries.length > 0) {
    lines.push(`  pending boundaries: ${snapshot.pending_boundaries.length}`);
  }
  return `${lines.join('\n')}\n`;
}

function formatCloseoutSummary(result) {
  const closeout = result.closeout;
  const lines = [
    `REPO AWARENESS CLOSEOUT: ${result.paths.closeout_path}`,
    `  .improve-this: ${closeout.cache_status.improve_this.status}`,
    `  plan visibility: ${closeout.cache_status.plan_visibility.status}`,
    `  next: ${closeout.recommended_next_command}`
  ];
  return `${lines.join('\n')}\n`;
}

function formatActorPacketSummary(result) {
  const packet = result.packet;
  const state = packet.current_state;
  return [
    `ACTOR AWARENESS: ${result.paths.actor_packet_path}`,
    `  role: ${packet.actor.role}`,
    `  task: ${packet.actor.task}`,
    `  .improve-this: ${state.improve_this_status}`,
    `  plan visibility: ${state.plan_visibility_status}`,
    `  context budget: ${state.context_budget && state.context_budget.lifecycle_state || 'unknown'}`,
    `  pending boundaries: ${state.pending_boundary_count}`
  ].join('\n') + '\n';
}

module.exports = {
  SNAPSHOT_SCHEMA,
  CLOSEOUT_SCHEMA,
  ACTOR_PACKET_SCHEMA,
  assessImproveThis,
  buildActorAwarenessPacket,
  buildCloseout,
  buildSnapshot,
  closeoutRepoAwareness,
  closeoutPath,
  createActorAwarenessPacket,
  formatActorPacketSummary,
  formatCloseoutSummary,
  formatInitSummary,
  initRepoAwareness,
  latestPath,
  snapshotPath,
  summarizeBoundaries,
  summarizeContextBudget,
  summarizePlanVisibility,
  writeCloseout,
  writeSnapshot
};
