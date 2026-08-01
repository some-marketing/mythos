#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
  formatText,
  getHarnessCapabilitySummary
} = require('../mythos-status');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function withTempProject(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smos-status-'));
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('getHarnessCapabilitySummary reads generated dashboard model', () => {
  withTempProject((root) => {
    writeJson(path.join(root, '_dev/reports/analysis/harness-capability-dashboard.json'), {
      schema: 'HarnessCapabilityDashboard/1.0',
      timestamp: '2026-06-24T21:27:53.349Z',
      inventory_timestamp: '2026-06-24T21:27:39.269Z',
      next_actions_timestamp: '2026-06-24T21:27:46.837Z',
      summary: {
        harnesses: 7,
        capabilities: 14,
        rows: 98,
        queue: {
          package_script_reviews: 1,
          exposed_tool_reviews: 2,
          adapter_capability_reviews: 3,
          capability_inventory_reviews: 4,
          documented_unsupported_adapter_capabilities: 6
        }
      }
    });
    fs.mkdirSync(path.join(root, '_dev/reports/analysis'), { recursive: true });
    fs.writeFileSync(path.join(root, '_dev/reports/analysis/harness-capability-dart-breadcrumb.md'), 'breadcrumb\n');

    const summary = getHarnessCapabilitySummary(root);
    assert.equal(summary.available, true);
    assert.equal(summary.dashboard_path, '_dev/reports/analysis/harness-capability-dashboard.html');
    assert.equal(summary.model_path, '_dev/reports/analysis/harness-capability-dashboard.json');
    assert.equal(summary.harnesses, 7);
    assert.equal(summary.capabilities, 14);
    assert.equal(summary.rows, 98);
    assert.equal(summary.open_reviews, 10);
    assert.equal(summary.documented_unsupported_adapter_capabilities, 6);
    assert.equal(summary.dart_breadcrumb_path, '_dev/reports/analysis/harness-capability-dart-breadcrumb.md');
    assert.match(summary.dart_preflight_command, /--preflight --json/);
    assert.match(summary.dart_retry_command, /dart:plan:comment/);
  });
});

test('getHarnessCapabilitySummary reports generation command when missing', () => {
  withTempProject((root) => {
    const summary = getHarnessCapabilitySummary(root);
    assert.equal(summary.available, false);
    assert.equal(summary.next_command, 'npm run harness:capability:dashboard');
  });
});

test('formatText surfaces harness capability dashboard link', () => {
  const output = formatText({
    next_step: {
      command: '/next-step',
      reason: 'test',
      source: 'test',
      blocked_by: [],
      context: {
        pipeline_complete: true,
        has_active_workstreams: false,
        system_verified: true,
        live_signal_count: 0
      }
    },
    trinity: { doc_exists: true, manifestations: 0, nodes: [] },
    maintenance: { available: false, conditions: [], clearance: 'unknown' },
    maintenance_topology: { available: false, next_command: 'node tools/maintenance/topology-scout.js' },
    verify_system: { available: false },
    task_plans: { total: 0, active: 0, completed: 0, active_plans: [] },
    live_signals: [],
    planning_staleness: [],
    harness_capabilities: {
      available: true,
      dashboard_path: '_dev/reports/analysis/harness-capability-dashboard.html',
      harnesses: 7,
      capabilities: 14,
      open_reviews: 0,
      documented_unsupported_adapter_capabilities: 6,
      dart_breadcrumb_path: '_dev/reports/analysis/harness-capability-dart-breadcrumb.md'
    },
    live_ads: { available: false },
    inventory: { frameworks: 1, clients: 2, commands: 3 }
  });

  assert.match(output, /Harness capabilities: 7 harnesses, 14 capabilities, 0 open reviews/);
  assert.match(output, /_dev\/reports\/analysis\/harness-capability-dashboard\.html/);
  assert.match(output, /Documented unsupported adapter capabilities: 6/);
  assert.match(output, /Dart breadcrumb: _dev\/reports\/analysis\/harness-capability-dart-breadcrumb\.md/);
});
