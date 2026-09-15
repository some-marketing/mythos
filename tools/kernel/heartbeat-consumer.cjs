#!/usr/bin/env node
'use strict';

/**
 * heartbeat-consumer.cjs — the CONTROLLER in the sensor -> controller -> actuator
 * self-healing loop (review finding SH3, plan step S3).
 *
 * The kernel heartbeat (tools/kernel/heartbeat.js) is the SENSOR: it is strictly
 * READ-ONLY, observes lane/host state, and writes a pulse. It builds an anomaly
 * list that nobody acts on. This tool is the CONTROLLER: it reads that pulse
 * (never mutates it, never requires the sensor module — requiring it would run
 * the sensor's main() and emit a spurious pulse), classifies anomalies into a
 * small closed set of CLASSES, and maps each class to a REGISTERED actuator with
 * explicit bounds. Actuators are the only things that touch the world.
 *
 * HARD INVARIANT — registry-only dispatch:
 *   An anomaly can ONLY ever cause the command literally registered for its class
 *   in REGISTRY. Commands are fixed constants; they are NEVER string-built from
 *   anomaly text. A class with no registry entry is REFUSED, never executed. This
 *   is what stops "observation" from silently escalating into arbitrary action.
 *
 * SAFETY (grounding A2/A3, plan gates):
 *   - DEFAULT DRY-RUN: prints/records the dispatch DECISION and runs nothing.
 *     Mutation (running a registered command) requires the explicit --apply flag.
 *   - NOTIFY-ONLY classes never exec a shell command even under --apply; they
 *     only write a receipt/notification. Promotion of any class from notify-only
 *     to an executing actuator is a deliberate REGISTRY edit, reviewed like code.
 *   - KILL-SWITCH: if _dev/state/heartbeat-consumer/disabled exists, exit 0
 *     without classifying or dispatching anything (even under --apply).
 *   - Every decision (dry or apply, dispatched/notify/refused) writes a durable
 *     lane-health receipt to _dev/reports/lifecycle/hygiene-lane-health.jsonl.
 *
 * USAGE
 *   node tools/kernel/heartbeat-consumer.cjs                # dry-run (default)
 *   node tools/kernel/heartbeat-consumer.cjs --apply        # run registered cmds
 *   node tools/kernel/heartbeat-consumer.cjs --json         # machine-readable
 *   node tools/kernel/heartbeat-consumer.cjs --pulse <path> # read an alt pulse
 *   node tools/kernel/heartbeat-consumer.cjs --help
 *
 * Exit 0 = success (including "no anomalies" and "kill-switch"); 1 = a registered
 * actuator command failed under --apply.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { appendReceipt } = require('../maintenance/lib/hygiene-lane-health.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const STATE_ROOT = path.join(PROJECT_ROOT, '_dev', 'state');
// Mirrors tools/kernel/heartbeat.js PULSE_PATH. We read this file directly and
// do NOT require the sensor module (that would trigger its main() and write a
// pulse) — keeping the sensor strictly read-only from the controller's side.
const PULSE_PATH = path.join(STATE_ROOT, 'kernel-heartbeat.json');
const KILL_SWITCH = path.join(STATE_ROOT, 'heartbeat-consumer', 'disabled');

// The consumer runs inside tools/launchd/run-hygiene-sweep.cjs (dry-run default).
// A pulse older than 2x that cadence is considered stale.
const EXPECTED_CADENCE_MS = 600 * 1000;
const STALE_PULSE_MS = 2 * EXPECTED_CADENCE_MS;

// Below this free-disk figure (GiB) we treat the host as disk-low.
const DISK_LOW_FREE_GIB = 15;

// ── The actuator REGISTRY ──────────────────────────────────────────────────
//
// The closed set of anomaly classes this controller knows how to route, each
// mapped to exactly one registered response with explicit bounds. Anything not
// present here is refused, not guessed.
//
//   type: 'command'  -> a fixed argv executed ONLY under --apply
//   type: 'notify'   -> receipt + notification only; never execs a shell command
const REGISTRY = {
  disk_low: {
    type: 'command',
    // disk-quota-guard --check is itself read-only/safe (it only reports below
    // threshold in --check mode); the escalation to --apply is a separate,
    // deliberately-not-registered decision.
    bin: 'node',
    argv: ['tools/hygiene/disk-quota-guard.cjs', '--check'],
    bounds: 'read-only disk check; never runs the purge/rotate (--apply) path from here'
  },
  stale_heartbeat: {
    type: 'notify',
    bounds: 'notify-only: a stale pulse means the sensor itself may be down; healing it is an operator/scheduler concern, not an actuator command'
  },
  lane_unreachable: {
    type: 'notify',
    bounds: 'notify-only: lane restarts are host-specific and not safe to auto-issue from the controller without a per-lane registered probe'
  }
};

function help() {
  console.log(`
heartbeat-consumer — controller that maps read-only heartbeat anomalies to
registered actuators (sensor -> controller -> actuator).

Usage:
  node tools/kernel/heartbeat-consumer.cjs [options]

Options:
  --apply          Execute registered 'command' actuators (default: dry-run)
  --json           Emit a machine-readable summary
  --pulse <path>   Read an alternate pulse file (default: ${path.relative(PROJECT_ROOT, PULSE_PATH)})
  --help           Show this help

Registered anomaly classes: ${Object.keys(REGISTRY).join(', ')}
Kill-switch: create _dev/state/heartbeat-consumer/disabled to disable.
`.trim());
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) { out._.push(tok); continue; }
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (key === 'pulse' && next && !next.startsWith('--')) { out.pulse = next; i++; }
    else out[key] = true;
  }
  return out;
}

function parseAvailableGiB(available) {
  // heartbeat writes host.disk.available as a df-style string like "45Gi" / "512Mi".
  if (typeof available !== 'string') return null;
  const m = available.match(/^([\d.]+)\s*([TGMKtgmk]?)i?B?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  const unit = (m[2] || 'G').toUpperCase();
  const factor = { T: 1024, G: 1, M: 1 / 1024, K: 1 / (1024 * 1024) }[unit] || 1;
  return n * factor;
}

/**
 * Classify a pulse object into a list of concrete anomaly detections.
 * Each detection is { class, detail, evidence }. Pure — no side effects.
 * The class values are intentionally a small closed vocabulary; only classes
 * that also appear in REGISTRY can be dispatched.
 */
function classifyAnomalies(pulse, now = Date.now()) {
  const detections = [];
  if (!pulse || typeof pulse !== 'object') {
    detections.push({
      class: 'stale_heartbeat',
      detail: 'pulse file missing or unparseable',
      evidence: { pulse: null }
    });
    return detections;
  }

  // Stale pulse.
  const t = pulse.timestamp ? Date.parse(pulse.timestamp) : NaN;
  if (Number.isNaN(t)) {
    detections.push({
      class: 'stale_heartbeat',
      detail: 'pulse has no parseable timestamp',
      evidence: { timestamp: pulse.timestamp || null }
    });
  } else if (now - t > STALE_PULSE_MS) {
    detections.push({
      class: 'stale_heartbeat',
      detail: `pulse is ${Math.round((now - t) / 60000)}m old (> ${Math.round(STALE_PULSE_MS / 60000)}m threshold)`,
      evidence: { timestamp: pulse.timestamp, age_ms: now - t, threshold_ms: STALE_PULSE_MS }
    });
  }

  // Disk-low from the structured host.disk reading.
  const disk = pulse.host && pulse.host.disk;
  if (disk && disk.available != null) {
    const freeGiB = parseAvailableGiB(disk.available);
    if (freeGiB != null && freeGiB < DISK_LOW_FREE_GIB) {
      detections.push({
        class: 'disk_low',
        detail: `host reports ${disk.available} free (< ${DISK_LOW_FREE_GIB}GiB threshold)`,
        evidence: { available: disk.available, free_gib: Number(freeGiB.toFixed(2)), used_percent: disk.used_percent || null }
      });
    }
  }

  // Unreachable / errored lanes.
  const lanes = Array.isArray(pulse.lanes) ? pulse.lanes : [];
  for (const lane of lanes) {
    if (lane && (lane.state === 'not-reachable' || lane.state === 'error')) {
      detections.push({
        class: 'lane_unreachable',
        detail: `lane ${lane.name} is ${lane.state}${lane.detail ? ' — ' + lane.detail : ''}`,
        evidence: { lane: lane.name, state: lane.state }
      });
    }
  }

  return detections;
}

/**
 * Resolve a single anomaly class to a dispatch decision. This is the ONLY place
 * that consults REGISTRY, and it is the choke-point that guarantees registry-only
 * dispatch: an unregistered class returns { registered: false, command: null }
 * and can therefore never be executed.
 */
function decideDispatch(anomalyClass, { apply = false } = {}) {
  const entry = REGISTRY[anomalyClass];
  if (!entry) {
    return {
      class: anomalyClass,
      registered: false,
      actuator_type: null,
      command: null,
      decision: 'refused-unregistered',
      bounds: null
    };
  }
  if (entry.type === 'notify') {
    return {
      class: anomalyClass,
      registered: true,
      actuator_type: 'notify',
      command: null,
      decision: 'notify-only',
      bounds: entry.bounds
    };
  }
  // type === 'command'
  return {
    class: anomalyClass,
    registered: true,
    actuator_type: 'command',
    // Fixed constant — copied straight from the registry, never from anomaly text.
    command: { bin: entry.bin, argv: entry.argv.slice() },
    decision: apply ? 'dispatched' : 'would-dispatch',
    bounds: entry.bounds
  };
}

// A2 lane-health receipt: one durable line per apply-mode decision. Delegates to
// the shared canonical writer so every hygiene lane emits the identical schema
// (schema/timestamp/tool/decision/verification/outcome, optional target).
function writeLaneHealthReceipt(fields, opts) {
  return appendReceipt({ tool: 'heartbeat-consumer', ...fields }, opts);
}

function readPulse(pulsePath) {
  try {
    return JSON.parse(fs.readFileSync(pulsePath, 'utf8'));
  } catch {
    return null;
  }
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { help(); process.exit(0); }

  const apply = Boolean(args.apply);
  const json = Boolean(args.json);
  const pulsePath = args.pulse ? path.resolve(args.pulse) : PULSE_PATH;

  const summary = {
    schema: 'HeartbeatConsumerRun/1.0',
    ts: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry-run',
    pulse: path.relative(PROJECT_ROOT, pulsePath),
    kill_switch: false,
    detections: [],
    dispatches: [],
    success: true
  };

  // Kill-switch.
  if (fs.existsSync(KILL_SWITCH)) {
    summary.kill_switch = true;
    if (json) console.log(JSON.stringify(summary, null, 2));
    else console.log(`heartbeat-consumer: kill-switch present (${path.relative(PROJECT_ROOT, KILL_SWITCH)}). No classification or dispatch.`);
    process.exit(0);
  }

  const pulse = readPulse(pulsePath);
  const detections = classifyAnomalies(pulse);
  summary.detections = detections;

  if (!json) {
    console.log(apply ? 'heartbeat-consumer — APPLY MODE' : 'heartbeat-consumer — DRY RUN (default; use --apply to run registered actuators)');
    console.log('='.repeat(60));
    console.log(`Pulse: ${summary.pulse}`);
    console.log(`Anomaly detections: ${detections.length}\n`);
  }

  let failures = 0;
  for (const det of detections) {
    const decision = decideDispatch(det.class, { apply });
    const record = { ...decision, detail: det.detail, evidence: det.evidence };

    if (decision.actuator_type === 'command' && apply && decision.registered) {
      const bin = decision.command.bin;
      const argv = decision.command.argv;
      const child = spawnSync(bin, argv, { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 120000 });
      record.exit_code = child.status == null ? -1 : child.status;
      if (record.exit_code !== 0) { failures++; record.decision = 'dispatched-failed'; }
    }

    summary.dispatches.push(record);
    const outcome = record.exit_code != null
      ? (record.exit_code === 0 ? 'success' : 'failed')
      : record.actuator_type === 'notify' ? 'noop'
        : !record.registered ? 'refused'
          : 'dry-run';
    writeLaneHealthReceipt({
      decision: record.decision,
      target: record.class,
      verification: {
        anomaly_class: record.class,
        registered: record.registered,
        actuator_type: record.actuator_type,
        mode: apply ? 'apply' : 'dry-run',
        command: record.command ? `${record.command.bin} ${record.command.argv.join(' ')}` : null,
        detail: record.detail,
        evidence: record.evidence,
        exit_code: record.exit_code != null ? record.exit_code : null
      },
      outcome
    });

    if (!json) {
      const cmdStr = record.command ? `${record.command.bin} ${record.command.argv.join(' ')}` : '(none)';
      console.log(`  [${record.class}] ${record.decision}`);
      console.log(`     ${record.detail}`);
      console.log(`     registered=${record.registered} actuator=${record.actuator_type || 'none'} cmd=${cmdStr}`);
      if (record.exit_code != null) console.log(`     exit_code=${record.exit_code}`);
    }
  }

  summary.success = failures === 0;

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    if (detections.length === 0) console.log('  No anomalies. Nothing to dispatch.');
    const refused = summary.dispatches.filter((d) => !d.registered).length;
    console.log(`\nDispatches: ${summary.dispatches.length} (${refused} refused-unregistered). ${apply ? `Failures: ${failures}` : 'Dry run — nothing executed.'}`);
  }

  process.exit(summary.success ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = {
  REGISTRY,
  classifyAnomalies,
  decideDispatch,
  parseAvailableGiB,
  writeLaneHealthReceipt,
  STALE_PULSE_MS,
  EXPECTED_CADENCE_MS,
  DISK_LOW_FREE_GIB,
  PULSE_PATH,
  PROJECT_ROOT
};
