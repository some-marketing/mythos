#!/usr/bin/env node
'use strict';

/**
 * mythos-status.js — Consolidated operator status surface.
 *
 * Aggregates: next-step resolution, maintenance conditions,
 * live signal summary, planning staleness, and system inventory.
 *
 * Usage:
 *   node tools/status/mythos-status.js [--json]
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

// ── Imports from existing modules ──

const { resolveNextStep, listActiveTaskPlans, listCompletedTaskPlans } = require('../signals/lib/decision-tree');
const { scanLiveHandoffSignals } = require('../signals/lib/pipeline-loop');
const { listAllTaskPlans } = require('../planning/lib/resolve-task-plan');

let analyzeAndApplyCloseoutMaintenance;
try {
  analyzeAndApplyCloseoutMaintenance = require('../maintenance/lib/closeout-maintenance').analyzeAndApplyCloseoutMaintenance;
} catch {
  analyzeAndApplyCloseoutMaintenance = null;
}

// ── Helpers ──

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function fileAge(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return Date.now() - stat.mtimeMs;
  } catch {
    return Infinity;
  }
}

const DAY_MS = 86400000;

function rel(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).replace(/\\/g, '/');
}

function listFiles(dirPath, predicate = () => true) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => path.join(dirPath, entry.name))
      .filter(predicate)
      .sort();
  } catch {
    return [];
  }
}

// ── Section: Next Step ──

function getNextStep(projectRoot = PROJECT_ROOT) {
  return resolveNextStep(projectRoot);
}

// ── Section: Maintenance ──

function getMaintenanceSummary(projectRoot = PROJECT_ROOT) {
  if (!analyzeAndApplyCloseoutMaintenance) {
    return { available: false, conditions: [], clearance: 'unknown' };
  }
  try {
    const report = analyzeAndApplyCloseoutMaintenance(projectRoot, {
      execute: false,
      scope: 'latest',
      ageDays: 7,
      emitDispatch: false
    });
    return {
      available: true,
      clearance: report.clearance,
      conditions: report.conditions.map(c => ({
        severity: c.severity,
        id: c.id,
        label: c.message || c.label,
        auto_fixable: c.auto_fixable || false
      }))
    };
  } catch (err) {
    return { available: false, error: err.message, conditions: [], clearance: 'error' };
  }
}

function getMaintenanceTopologySummary(projectRoot = PROJECT_ROOT) {
  const analysisDir = path.join(projectRoot, '_dev', 'reports', 'analysis');
  const ledgers = listFiles(
    analysisDir,
    filePath => /^maintenance-ledger__.*\.json$/.test(path.basename(filePath))
  );
  const candidates = ledgers
    .map(filePath => ({ filePath, ledger: safeReadJson(filePath) }))
    .filter(item => item.ledger && item.ledger.schema === 'MaintenanceTopologyLedger/1.0')
    .sort((a, b) => String(b.ledger.timestamp || '').localeCompare(String(a.ledger.timestamp || '')));

  if (candidates.length === 0) {
    return {
      available: false,
      latest_path: null,
      total_findings: 0,
      next_command: 'node tools/maintenance/topology-scout.js'
    };
  }

  const latest = candidates[0];
  const ledger = latest.ledger;
  return {
    available: true,
    latest_path: rel(projectRoot, latest.filePath),
    timestamp: ledger.timestamp || null,
    fingerprint: ledger.fingerprint || null,
    total_findings: ledger.summary?.total || 0,
    by_diet_class: ledger.summary?.by_diet_class || ledger.summary?.by_type || {},
    next_command: ledger.next_command || '/review-progress maintenance-topology-scout',
    authority: ledger.authority || 'report-only'
  };
}

// ── Section: Live Signals ──

function getLiveSignalSummary(projectRoot = PROJECT_ROOT) {
  const signalDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  const signals = scanLiveHandoffSignals(signalDir);
  return signals.map(s => ({
    scope: s.signal.signal_scope || s.signal.scope,
    type: s.signal.signal_type,
    actor: s.signal.recommended_next_actor,
    command: s.signal.recommended_next_command,
    file: path.basename(s.filePath)
  }));
}

// ── Section: Planning Staleness ──

function getPlaningStaleness(projectRoot = PROJECT_ROOT) {
  const staleThresholdMs = 3 * DAY_MS;
  const surfaces = [
    {
      name: 'plan-active-workstreams',
      path: path.join(projectRoot, '_dev', 'reports', 'analysis', 'plan-active-workstreams.md')
    },
    {
      name: 'plan-active-workstreams.next-step',
      path: path.join(projectRoot, '_dev', 'reports', 'analysis', 'plan-active-workstreams.next-step.json')
    },
    {
      name: 'plan-pipeline.next-step',
      path: path.join(projectRoot, '_dev', 'reports', 'analysis', 'plan-pipeline.next-step.json')
    }
  ];

  const results = [];
  for (const surface of surfaces) {
    const age = fileAge(surface.path);
    const ageDays = Math.round(age / DAY_MS * 10) / 10;
    results.push({
      name: surface.name,
      age_days: ageDays,
      stale: age > staleThresholdMs,
      exists: age !== Infinity
    });
  }
  return results;
}

// ── Section: System Inventory ──

function getSystemInventory(projectRoot = PROJECT_ROOT) {
  const systemPath = path.join(projectRoot, 'instructions', 'canonical', 'system.yaml');
  let frameworkCount = 0;
  try {
    const system = JSON.parse(fs.readFileSync(systemPath, 'utf8'));
    frameworkCount = system?.frameworks?.length || 0;
  } catch { /* fallback */ }

  let clientCount = 0;
  const clientsDir = path.join(projectRoot, 'clients');
  try {
    clientCount = fs.readdirSync(clientsDir).filter(d => {
      return fs.statSync(path.join(clientsDir, d)).isDirectory() && !d.startsWith('.');
    }).length;
  } catch { /* no clients dir */ }

  const commandCount = (() => {
    try {
      return fs.readdirSync(path.join(projectRoot, '.claude', 'commands')).filter(f => f.endsWith('.md')).length;
    } catch { return 0; }
  })();

  return { frameworks: frameworkCount, clients: clientCount, commands: commandCount };
}

// ── Section: Trinity Alignment ──

function getTrinityAlignment(projectRoot = PROJECT_ROOT) {
  const trinityPath = path.join(projectRoot, 'instructions', 'canonical', 'kernel', 'manifestation-trinity.yaml');
  const systemPath = path.join(projectRoot, 'instructions', 'canonical', 'system.yaml');
  
  const hasTrinityDoc = fs.existsSync(trinityPath);
  const manifestationsDir = path.join(projectRoot, 'instructions', 'canonical', 'kernel', 'manifestations');
  const manifestationCount = fs.existsSync(manifestationsDir) ? fs.readdirSync(manifestationsDir).filter(f => f.endsWith('.png')).length : 0;

  const nodes = [];
  try {
    const system = JSON.parse(fs.readFileSync(systemPath, 'utf8'));
    if (system?.identity?.coordinator) {
      nodes.push({ id: system.identity.coordinator.id, status: system.identity.coordinator.trinity_status });
    }
    if (system?.identity?.nodes) {
      for (const node of system.identity.nodes) {
        nodes.push({ id: node.id, status: node.status || node.trinity_status });
      }
    }
  } catch { /* ignore */ }

  return {
    doc_exists: hasTrinityDoc,
    manifestations: manifestationCount,
    nodes
  };
}

// ── Section: Task Plan Summary ──

/**
 * Aggregate task-plan completion status using the shared resolver and
 * the decision-tree completion classifier. Distinguishes active vs.
 * completed plans so the operator sees only actionable work.
 *
 * @returns {{ total: number, active: number, completed: number, active_plans: object[], completed_plans: object[] }}
 */
function getTaskPlanSummary(projectRoot = PROJECT_ROOT) {
  try {
    const allPlans = listAllTaskPlans(projectRoot);
    const active = listActiveTaskPlans(projectRoot);
    const completed = listCompletedTaskPlans(projectRoot);
    return {
      total: allPlans.length,
      active: active.length,
      completed: completed.length,
      active_plans: active.map(p => ({
        task_id: p.taskId,
        scope_type: p.scopeType,
        client_code: p.clientCode
      })),
      completed_plans: completed.map(p => ({
        task_id: p.taskId,
        scope_type: p.scopeType,
        client_code: p.clientCode
      }))
    };
  } catch {
    return { total: 0, active: 0, completed: 0, active_plans: [], completed_plans: [] };
  }
}

// ── Section: Verify System ──

function getVerifySystemStatus(projectRoot = PROJECT_ROOT) {
  const signal = safeReadJson(path.join(projectRoot, '_dev', 'reports', 'signals', 'verify-system.signal.json'));
  if (!signal) return { available: false };
  return {
    available: true,
    verdict: signal.verdict,
    total: signal.summary?.total || 0,
    passed: signal.summary?.passed || 0,
    warned: signal.summary?.warned || 0,
    failed: signal.summary?.failed || 0
  };
}

// ── Aggregate ──

function getLiveAdsSummary(projectRoot = PROJECT_ROOT) {
  const trackerPath = path.join(
    projectRoot,
    'clients', '{CLIENT_CODE}', 'projects', 'meta-creative-iteration',
    'outputs', '06-live-tracker', 'index.json'
  );
  const tracker = safeReadJson(trackerPath);
  if (!tracker || !Array.isArray(tracker.ads)) {
    return { available: false, ads: [] };
  }
  const active = tracker.ads.filter(a => (a.effective_status || a.status) === 'ACTIVE');
  return {
    available: true,
    client_code: tracker.client_code || '{CLIENT_CODE}',
    total: tracker.ads.length,
    active_count: active.length,
    last_refreshed_at: tracker.ads.reduce((acc, a) => a.last_refreshed_at && (!acc || a.last_refreshed_at > acc) ? a.last_refreshed_at : acc, null),
    ads: tracker.ads.map(a => ({
      ad_id: a.ad_id,
      name: a.name,
      effective_status: a.effective_status || a.status || 'UNKNOWN',
      spend: a.last_insights ? a.last_insights.spend : null,
      conversions: a.last_insights ? a.last_insights.conversions : null
    }))
  };
}

function getHarnessCapabilitySummary(projectRoot = PROJECT_ROOT) {
  const dashboardPath = path.join(projectRoot, '_dev', 'reports', 'analysis', 'harness-capability-dashboard.html');
  const modelPath = path.join(projectRoot, '_dev', 'reports', 'analysis', 'harness-capability-dashboard.json');
  const dartBreadcrumbPath = path.join(projectRoot, '_dev', 'reports', 'analysis', 'harness-capability-dart-breadcrumb.md');
  const model = safeReadJson(modelPath);
  if (!model || model.schema !== 'HarnessCapabilityDashboard/1.0') {
    return {
      available: false,
      dashboard_path: rel(projectRoot, dashboardPath),
      model_path: rel(projectRoot, modelPath),
      dart_breadcrumb_path: fs.existsSync(dartBreadcrumbPath) ? rel(projectRoot, dartBreadcrumbPath) : null,
      next_command: 'npm run harness:capability:dashboard'
    };
  }

  const queue = model.summary?.queue || {};
  const openReviews = (queue.package_script_reviews || 0)
    + (queue.exposed_tool_reviews || 0)
    + (queue.adapter_capability_reviews || 0)
    + (queue.capability_inventory_reviews || 0);

  return {
    available: true,
    dashboard_path: rel(projectRoot, dashboardPath),
    model_path: rel(projectRoot, modelPath),
    timestamp: model.timestamp || null,
    inventory_timestamp: model.inventory_timestamp || null,
    next_actions_timestamp: model.next_actions_timestamp || null,
    harnesses: model.summary?.harnesses || 0,
    capabilities: model.summary?.capabilities || 0,
    rows: model.summary?.rows || 0,
    open_reviews: openReviews,
    documented_unsupported_adapter_capabilities: queue.documented_unsupported_adapter_capabilities || 0,
    dart_breadcrumb_path: fs.existsSync(dartBreadcrumbPath) ? rel(projectRoot, dartBreadcrumbPath) : null,
    dart_preflight_command: 'npm run dart:plan:comment -- --plan harness-capability-inventory-refresh --comment-file _dev/reports/analysis/harness-capability-dart-breadcrumb.md --preflight --json',
    dart_retry_command: 'npm run dart:plan:comment -- --plan harness-capability-inventory-refresh --comment-file _dev/reports/analysis/harness-capability-dart-breadcrumb.md'
  };
}

function buildStatus(projectRoot = PROJECT_ROOT) {
  return {
    timestamp: new Date().toISOString(),
    next_step: getNextStep(projectRoot),
    maintenance: getMaintenanceSummary(projectRoot),
    maintenance_topology: getMaintenanceTopologySummary(projectRoot),
    live_signals: getLiveSignalSummary(projectRoot),
    task_plans: getTaskPlanSummary(projectRoot),
    planning_staleness: getPlaningStaleness(projectRoot),
    verify_system: getVerifySystemStatus(projectRoot),
    harness_capabilities: getHarnessCapabilitySummary(projectRoot),
    trinity: getTrinityAlignment(projectRoot),
    live_ads: getLiveAdsSummary(projectRoot),
    inventory: getSystemInventory(projectRoot)
  };
}

// ── Output ──

function formatText(status) {
  const lines = [];
  lines.push('Mythos System Status');
  lines.push('===================\n');

  // Next step
  const ns = status.next_step;
  lines.push(`Next command:  ${ns.command || '(none)'}`);
  lines.push(`Why:           ${ns.reason}`);
  lines.push(`Source:        ${ns.source}`);
  if (ns.blocked_by.length > 0) {
    lines.push(`Blocked by:    ${ns.blocked_by.join('; ')}`);
  }
  lines.push('');

  // Trinity Alignment
  const t = status.trinity;
  lines.push(`Trinity Alignment: ${t.doc_exists ? 'DOC_OK' : 'DOC_MISSING'} (${t.manifestations} manifestations)`);
  for (const node of t.nodes) {
    lines.push(`  [${node.id}] ${node.status}`);
  }
  lines.push('');

  // Context
  const ctx = ns.context;

  lines.push('System context:');
  lines.push(`  Pipeline complete:    ${ctx.pipeline_complete}`);
  lines.push(`  Active workstreams:   ${ctx.has_active_workstreams}`);
  lines.push(`  System verified:      ${ctx.system_verified}`);
  lines.push(`  Live signals:         ${ctx.live_signal_count}`);
  lines.push('');

  // Maintenance
  const m = status.maintenance;
  if (m.available) {
    lines.push(`Maintenance:   ${m.clearance} (${m.conditions.length} condition${m.conditions.length !== 1 ? 's' : ''})`);
    for (const c of m.conditions) {
      lines.push(`  [${c.severity}] ${c.label}${c.auto_fixable ? ' (auto-fixable)' : ''}`);
    }
  } else {
    lines.push('Maintenance:   unavailable');
  }
  const mt = status.maintenance_topology;
  if (mt && mt.available) {
    lines.push(`Topology scout: ${mt.total_findings} finding${mt.total_findings !== 1 ? 's' : ''} (${mt.authority}, ${mt.latest_path})`);
    for (const [dietClass, count] of Object.entries(mt.by_diet_class)) {
      lines.push(`  [${dietClass}] ${count}`);
    }
    if (mt.total_findings > 0) {
      lines.push(`  Next: ${mt.next_command}`);
    }
  } else {
    lines.push(`Topology scout: no ledger (run ${mt?.next_command || 'node tools/maintenance/topology-scout.js'})`);
  }
  lines.push('');

  // Verify system
  const vs = status.verify_system;
  if (vs.available) {
    lines.push(`Verify system: ${vs.verdict} (${vs.passed}/${vs.total} pass${vs.warned > 0 ? `, ${vs.warned} warn` : ''}${vs.failed > 0 ? `, ${vs.failed} fail` : ''})`);
  } else {
    lines.push('Verify system: no signal');
  }
  lines.push('');

  // Task plans
  const tp = status.task_plans;
  if (tp.total > 0) {
    lines.push(`Task plans:    ${tp.active} active, ${tp.completed} completed (${tp.total} total)`);
    if (tp.active_plans.length > 0) {
      for (const p of tp.active_plans) {
        const scope = p.client_code ? `client:${p.client_code}` : 'system';
        lines.push(`  [active] ${p.task_id} (${scope})`);
      }
    }
  } else {
    lines.push('Task plans:    none');
  }
  lines.push('');

  // Live signals
  if (status.live_signals.length > 0) {
    lines.push(`Live signals (${status.live_signals.length}):`);
    for (const s of status.live_signals) {
      lines.push(`  [${s.type}] ${s.scope} → ${s.actor}: ${s.command}`);
    }
  } else {
    lines.push('Live signals:  none');
  }
  lines.push('');

  // Planning staleness
  const stale = status.planning_staleness.filter(p => p.stale);
  if (stale.length > 0) {
    lines.push('Stale planning surfaces:');
    for (const s of stale) {
      lines.push(`  ${s.name}: ${s.age_days}d old (>3d threshold)`);
    }
  } else {
    lines.push('Planning surfaces: all fresh');
  }
  lines.push('');

  // Harness capability dashboard
  const hc = status.harness_capabilities;
  if (hc && hc.available) {
    lines.push(`Harness capabilities: ${hc.harnesses} harnesses, ${hc.capabilities} capabilities, ${hc.open_reviews} open reviews (${hc.dashboard_path})`);
    if (hc.documented_unsupported_adapter_capabilities > 0) {
      lines.push(`  Documented unsupported adapter capabilities: ${hc.documented_unsupported_adapter_capabilities}`);
    }
    if (hc.dart_breadcrumb_path) {
      lines.push(`  Dart breadcrumb: ${hc.dart_breadcrumb_path}`);
    }
  } else {
    lines.push(`Harness capabilities: no dashboard (run ${hc?.next_command || 'npm run harness:capability:dashboard'})`);
    if (hc?.dart_breadcrumb_path) {
      lines.push(`  Dart breadcrumb: ${hc.dart_breadcrumb_path}`);
    }
  }
  lines.push('');

  // Live ads
  const la = status.live_ads;
  if (la && la.available) {
    const refreshed = la.last_refreshed_at ? la.last_refreshed_at : 'never';
    lines.push(`Live ads (${la.active_count} active${la.total !== la.active_count ? `/${la.total}` : ''}) [${la.client_code}, last refreshed: ${refreshed}]:`);
    for (const ad of la.ads) {
      const spend = ad.spend != null ? `$${ad.spend}` : '$—';
      const conv = ad.conversions != null ? ad.conversions : '—';
      lines.push(`  [${ad.effective_status}] ${ad.ad_id} ${ad.name} — spend ${spend}, conv ${conv}`);
    }
    lines.push('');
  }

  // Inventory
  const inv = status.inventory;
  lines.push(`Inventory: ${inv.frameworks} frameworks, ${inv.clients} clients, ${inv.commands} commands`);

  return lines.join('\n');
}

// ── Commands taxonomy ──

function formatCommands() {
  const taxonomyPath = path.join(PROJECT_ROOT, 'instructions', 'canonical', 'command-taxonomy.json');
  const taxonomy = safeReadJson(taxonomyPath);
  if (!taxonomy) return 'Command taxonomy not found.';

  const lines = [];
  lines.push('Mythos Command Reference');
  lines.push('=======================\n');

  // Quick start
  if (taxonomy.operator_quick_start) {
    lines.push('Quick start:');
    for (const qs of taxonomy.operator_quick_start) {
      lines.push(`  ${qs}`);
    }
    lines.push('');
  }

  // Categories
  for (const [key, cat] of Object.entries(taxonomy.categories)) {
    lines.push(`${cat.label}`);
    for (const cmd of cat.commands) {
      const display = cmd.invocation || `/${cmd.id}`;
      const prefix = cmd.role === 'primary' ? '* ' :
                     cmd.role === 'legacy' ? '  (legacy) ' :
                     cmd.role === 'specialist' ? '  [specialist] ' : '  ';
      lines.push(`${prefix}${display} — ${cmd.note}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Main ──

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node tools/status/mythos-status.js [--json] [--commands] [--help]

Consolidated operator status: next step, maintenance, signals, planning, inventory.

Options:
  --json       Output structured JSON
  --commands   Show command taxonomy organized by intent
  --help       Show this help`);
    process.exit(0);
  }

  if (args.includes('--commands')) {
    console.log(formatCommands());
    process.exit(0);
  }

  const status = buildStatus();

  if (args.includes('--json')) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    console.log(formatText(status));
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildStatus,
  formatText,
  getHarnessCapabilitySummary,
  getMaintenanceTopologySummary
};
