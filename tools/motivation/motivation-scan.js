#!/usr/bin/env node
'use strict';

/**
 * motivation-scan.js — Read-only homeostatic motivation scanner (S2 of the
 * human-system-analogue governor plan).
 *
 * STRICTLY READ-ONLY with respect to everything EXCEPT its own two output files:
 *   - _dev/state/motivation/homeostasis.json        (the ledger; validates against homeostasis.schema.json)
 *   - _dev/state/motivation/last-scan-report.md      (human-readable report)
 *
 * It reads durable artifacts only:
 *   - task plans:        _dev/reports/analysis/task-plans/*__plan.json
 *   - live signals:      _dev/reports/signals/*.json   (HandoffSignal/1.0 + /2.0, lifecycle_state === 'live')
 *   - debriefs:          _dev/reports/analysis/run-debrief__*.md
 *   - validation reports: _dev/reports/analysis/closeout-validation__*.json
 *
 * It derives mechanical pressures and classifies each as artifact_countable or
 * interpretive_assessment per the S1 schema. It does NOT:
 *   - write/edit/delete/execute anything else,
 *   - emit proposed-goal artifacts (that is S3, out of scope),
 *   - route or trigger any command.
 *
 * Fail-safe: if it cannot read an input, it logs and continues, incrementing
 * uncategorized_signal_count where appropriate.
 *
 * Usage:
 *   node tools/motivation/motivation-scan.js [--dry-run] [--verbose] [--help]
 *
 * Programmatic:
 *   const { scan } = require('./motivation-scan');
 *   const { ledger, report, validation } = scan({ dryRun: true });
 *
 * See:
 *   _dev/reports/analysis/task-plans/human-system-analogue-governor-v0__plan.json (S1, S2)
 *   instructions/canonical/commands/motivation-scan.yaml
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const DIRS = {
  taskPlans: path.join(PROJECT_ROOT, '_dev', 'reports', 'analysis', 'task-plans'),
  signals: path.join(PROJECT_ROOT, '_dev', 'reports', 'signals'),
  analysis: path.join(PROJECT_ROOT, '_dev', 'reports', 'analysis')
};

const OUTPUT_DIR = path.join(PROJECT_ROOT, '_dev', 'state', 'motivation');
const LEDGER_PATH = path.join(OUTPUT_DIR, 'homeostasis.json');
const REPORT_PATH = path.join(OUTPUT_DIR, 'last-scan-report.md');
const SCHEMA_PATH = path.join(__dirname, 'homeostasis.schema.json');

const SCHEMA_ID = 'MotivationHomeostasisLedger/1.0';
const SCHEMA_VERSION = '1.0.0';

// A live signal is "stale" if older than this many days.
const STALE_SIGNAL_DAYS = 7;
const DECAY = { model: 'exponential', half_life_days: 14, notes: 'Age component halves every half_life_days; recent_progress acts as the falling counter-force.' };

// ---------------------------------------------------------------------------
// Fail-safe IO helpers (read-only)
// ---------------------------------------------------------------------------

function safeReadJson(filePath, diag) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (diag) diag.push(`read-fail(json): ${path.relative(PROJECT_ROOT, filePath)} :: ${err.message}`);
    return null;
  }
}

function safeListDir(dir, predicate, diag) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && predicate(e.name))
      .map((e) => path.join(dir, e.name));
  } catch (err) {
    if (diag) diag.push(`list-fail: ${path.relative(PROJECT_ROOT, dir)} :: ${err.message}`);
    return [];
  }
}

function clamp01(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function ageDays(isoOrMs) {
  const t = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
}

// Normalize an age in days to 0..1 via the exponential decay half-life.
// age component RISES with age (older => closer to 1).
function ageScore(days) {
  if (days == null || days < 0) return 0;
  return clamp01(1 - Math.pow(0.5, days / DECAY.half_life_days));
}

// ---------------------------------------------------------------------------
// Pressure builder
// ---------------------------------------------------------------------------

function buildPressure({ id, label, pressureClass, inputs, rawComponents, keepOpen }) {
  const i = {
    severity: clamp01(inputs.severity),
    age: clamp01(inputs.age),
    recurrence: clamp01(inputs.recurrence),
    authority_weight: clamp01(inputs.authority_weight),
    recent_progress: clamp01(inputs.recent_progress)
  };
  // Mechanical combine: rising drivers minus the recent_progress counter-force.
  const rising = (i.severity * 0.35) + (i.age * 0.2) + (i.recurrence * 0.2) + (i.authority_weight * 0.25);
  const preSuppression = clamp01(rising * (1 - i.recent_progress));
  const keep_open = Boolean(keepOpen);
  const computed_pressure = keep_open ? 0 : preSuppression;
  const now = new Date().toISOString();
  return {
    id,
    label,
    pressure_class: pressureClass,
    inputs: i,
    computed_pressure,
    keep_open,
    raw_components: Object.assign(
      { source_kind: rawComponents.source_kind, observed_count: rawComponents.observed_count },
      rawComponents.sample_refs ? { sample_refs: rawComponents.sample_refs } : {},
      { pre_suppression_pressure: preSuppression },
      rawComponents.notes ? { notes: rawComponents.notes } : {}
    ),
    last_updated: now
  };
}

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

const STEP_DONE_RE = /^(done|complete)$/i;

function deriveOpenLoops(diag) {
  // artifact_countable: incomplete plans (any plan whose steps carry status
  // markers and at least one step is not done/complete). Plans whose steps have
  // no status markers cannot be assessed -> counted as uncategorized.
  const files = safeListDir(DIRS.taskPlans, (n) => n.endsWith('__plan.json'), diag);
  let incomplete = 0;
  let uncategorized = 0;
  const samples = [];
  for (const f of files) {
    const o = safeReadJson(f, diag);
    if (!o) { uncategorized += 1; continue; }
    const steps = (o.bounded_plan && Array.isArray(o.bounded_plan.steps) && o.bounded_plan.steps) ||
      (Array.isArray(o.steps) && o.steps) || [];
    const statused = steps.filter((s) => s && typeof s.status === 'string');
    if (statused.length === 0) {
      // No machine-readable completion markers on this plan; cannot judge.
      uncategorized += 1;
      continue;
    }
    const hasOpen = statused.some((s) => !STEP_DONE_RE.test(s.status));
    if (hasOpen) {
      incomplete += 1;
      if (samples.length < 15) samples.push(path.relative(PROJECT_ROOT, f));
    }
  }
  const pressure = buildPressure({
    id: 'open_loops',
    label: 'Open loops (incomplete status-tracked plans)',
    pressureClass: 'artifact_countable',
    inputs: {
      severity: Math.min(1, incomplete / 10),
      age: 0.3,
      recurrence: Math.min(1, incomplete / 20),
      authority_weight: 0.6,
      recent_progress: 0
    },
    rawComponents: {
      source_kind: 'task-plans',
      observed_count: incomplete,
      sample_refs: samples,
      notes: `Scanned ${files.length} *__plan.json; ${incomplete} have >=1 non-done status-tracked step; ${uncategorized} had no status markers and were counted uncategorized.`
    }
  });
  return { pressure, uncategorized };
}

function deriveStaleSignals(diag) {
  // artifact_countable: live HandoffSignal files older than STALE_SIGNAL_DAYS.
  // Also counts total live signals. Non-coordination JSON (schemas etc.) that
  // cannot be classified contributes to uncategorized.
  const files = safeListDir(DIRS.signals, (n) => n.endsWith('.json'), diag);
  let live = 0;
  let stale = 0;
  let uncategorized = 0;
  let oldestDays = 0;
  const samples = [];
  for (const f of files) {
    const o = safeReadJson(f, diag);
    if (!o || typeof o !== 'object') { uncategorized += 1; continue; }
    const schema = typeof o.schema === 'string' ? o.schema : '';
    const isCoordination = /^HandoffSignal\//.test(schema);
    if (!isCoordination) {
      // e.g. *.schema.json / migration-signal.schema.json — not a live signal.
      uncategorized += 1;
      continue;
    }
    if (o.lifecycle_state !== 'live') continue;
    live += 1;
    const ts = o.timestamp || o.created_at || o.emitted_at || null;
    const days = ageDays(ts);
    if (days != null && days > STALE_SIGNAL_DAYS) {
      stale += 1;
      if (days > oldestDays) oldestDays = days;
      if (samples.length < 15) samples.push(path.relative(PROJECT_ROOT, f));
    }
  }
  const pressure = buildPressure({
    id: 'stale_signals',
    label: `Stale live coordination signals (> ${STALE_SIGNAL_DAYS}d)`,
    pressureClass: 'artifact_countable',
    inputs: {
      severity: Math.min(1, stale / 10),
      age: ageScore(oldestDays),
      recurrence: Math.min(1, stale / 15),
      authority_weight: 0.5,
      recent_progress: stale === 0 ? 1 : 0
    },
    rawComponents: {
      source_kind: 'signals',
      observed_count: stale,
      sample_refs: samples,
      notes: `Scanned ${files.length} *.json; ${live} live HandoffSignal; ${stale} stale (> ${STALE_SIGNAL_DAYS}d, oldest ~${oldestDays.toFixed(1)}d); ${uncategorized} non-coordination JSON counted uncategorized.`
    }
  });
  return { pressure, uncategorized, live };
}

function deriveUnpairedDebriefs(diag) {
  // artifact_countable: debrief markdowns. Heuristic pairing: a debrief is
  // "paired" if a plan or task-outcome artifact shares its slug. Unpaired
  // debriefs indicate closeout work that may not be reconciled into a plan.
  const debriefs = safeListDir(DIRS.analysis, (n) => /^run-debrief__.+\.md$/.test(n), diag);
  const planFiles = safeListDir(DIRS.taskPlans, (n) => n.endsWith('__plan.json'), diag)
    .map((f) => path.basename(f).replace(/__plan\.json$/, ''));
  const planSlugs = new Set(planFiles);
  let unpaired = 0;
  const samples = [];
  for (const d of debriefs) {
    const slug = path.basename(d).replace(/^run-debrief__/, '').replace(/\.md$/, '');
    // strip leading date prefix like 2026-05-26__
    const normalized = slug.replace(/^\d{4}-\d{2}-\d{2}__/, '');
    const paired = planSlugs.has(slug) || planSlugs.has(normalized) ||
      [...planSlugs].some((p) => p.includes(normalized) || normalized.includes(p));
    if (!paired) {
      unpaired += 1;
      if (samples.length < 15) samples.push(path.relative(PROJECT_ROOT, d));
    }
  }
  const pressure = buildPressure({
    id: 'unpaired_debriefs',
    label: 'Unpaired debriefs (no matching plan slug)',
    pressureClass: 'artifact_countable',
    inputs: {
      severity: Math.min(1, unpaired / 8),
      age: 0.2,
      recurrence: Math.min(1, unpaired / 12),
      authority_weight: 0.4,
      recent_progress: unpaired === 0 ? 1 : 0
    },
    rawComponents: {
      source_kind: 'debriefs',
      observed_count: unpaired,
      sample_refs: samples,
      notes: `Scanned ${debriefs.length} run-debrief__*.md against ${planSlugs.size} plan slugs; ${unpaired} had no slug match (heuristic).`
    }
  });
  return { pressure, unpaired };
}

function deriveFailingTests(diag) {
  // artifact_countable: failing tests, IF discoverable from validation reports.
  // We do NOT execute tests (read-only). We inspect closeout-validation__*.json
  // for any recorded failures. If none discoverable, observed_count is 0 with a
  // note that no signal was found (not assumed-green).
  const reports = safeListDir(DIRS.analysis, (n) => /^closeout-validation__.+\.json$/.test(n), diag);
  let failing = 0;
  let inspected = 0;
  const samples = [];
  for (const f of reports) {
    const o = safeReadJson(f, diag);
    if (!o) continue;
    inspected += 1;
    const text = JSON.stringify(o).toLowerCase();
    const failingCount = (o.failing_tests || o.failures || o.failed || null);
    if (typeof failingCount === 'number' && failingCount > 0) {
      failing += failingCount;
      if (samples.length < 15) samples.push(path.relative(PROJECT_ROOT, f));
    } else if (/"status"\s*:\s*"fail"/.test(text) || /"result"\s*:\s*"fail"/.test(text)) {
      failing += 1;
      if (samples.length < 15) samples.push(path.relative(PROJECT_ROOT, f));
    }
  }
  const discoverable = reports.length > 0;
  const pressure = buildPressure({
    id: 'failing_tests',
    label: 'Failing tests (from validation reports; not executed)',
    pressureClass: 'artifact_countable',
    inputs: {
      severity: Math.min(1, failing / 5),
      age: 0.1,
      recurrence: Math.min(1, failing / 10),
      authority_weight: 0.8,
      recent_progress: failing === 0 ? 1 : 0
    },
    rawComponents: {
      source_kind: 'validation-reports',
      observed_count: failing,
      sample_refs: samples,
      notes: discoverable
        ? `Inspected ${inspected} closeout-validation__*.json (read-only, no test execution); ${failing} recorded failures.`
        : 'No validation reports discoverable; failing-test pressure could not be derived from artifacts (NOT assumed green).'
    }
  });
  return { pressure, failingDiscoverable: discoverable };
}

function deriveOperatorWaiting(diag) {
  // artifact_countable: live signals that are blocked_by something or whose
  // recommended_next_actor/ready_for_clear indicates the operator is awaited.
  const files = safeListDir(DIRS.signals, (n) => n.endsWith('.json'), diag);
  let waiting = 0;
  const samples = [];
  for (const f of files) {
    const o = safeReadJson(f, diag);
    if (!o || typeof o !== 'object') continue;
    if (!/^HandoffSignal\//.test(String(o.schema || ''))) continue;
    if (o.lifecycle_state !== 'live') continue;
    const blocked = Array.isArray(o.blocked_by) ? o.blocked_by.length > 0 : Boolean(o.blocked_by);
    const actor = String(o.recommended_next_actor || '').toLowerCase();
    const awaitsOperator = /operator|human|sam/.test(actor) || o.ready_for_clear === false && o.next_step_detail && /operator/i.test(JSON.stringify(o.next_step_detail || ''));
    if (blocked || awaitsOperator) {
      waiting += 1;
      if (samples.length < 15) samples.push(path.relative(PROJECT_ROOT, f));
    }
  }
  const pressure = buildPressure({
    id: 'operator_waiting_items',
    label: 'Items awaiting operator (blocked or operator-addressed live signals)',
    pressureClass: 'artifact_countable',
    inputs: {
      severity: Math.min(1, waiting / 6),
      age: 0.3,
      recurrence: Math.min(1, waiting / 10),
      authority_weight: 0.9,
      recent_progress: waiting === 0 ? 1 : 0
    },
    rawComponents: {
      source_kind: 'signals',
      observed_count: waiting,
      sample_refs: samples,
      notes: `Live signals that are blocked_by-set or operator-addressed: ${waiting}.`
    }
  });
  return { pressure };
}

function deriveCoverageGap(uncategorizedTotal) {
  // interpretive_assessment: a judgement that ledger coverage may be narrow.
  // MAY NEVER drive auto-execution. Surfaced as evidence only. Tied to the
  // uncategorized count so it cannot be hidden.
  return buildPressure({
    id: 'coverage_gaps',
    label: 'Coverage gaps (interpretive; evidence-only, never auto-executes)',
    pressureClass: 'interpretive_assessment',
    inputs: {
      severity: Math.min(1, uncategorizedTotal / 50),
      age: 0,
      recurrence: 0,
      authority_weight: 0.2,
      recent_progress: 0
    },
    rawComponents: {
      source_kind: 'signals',
      observed_count: uncategorizedTotal,
      notes: 'Interpretive assessment derived from the uncategorized-signal count. Quarantined from auto-execution per kernel-crystallization 5.6.'
    }
  });
}

// ---------------------------------------------------------------------------
// Minimal schema validator (no ajv dependency in node_modules).
// Validates the subset of JSON Schema this ledger uses: required, type,
// enum, const, integer/minimum, nested objects/arrays.
// ---------------------------------------------------------------------------

function typeOf(v) {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function validateAgainst(schema, value, pathStr, errors) {
  if (!schema || typeof schema !== 'object') return;
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${pathStr}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${pathStr}: ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum)}`);
  }
  if (schema.type) {
    const t = typeOf(value);
    const want = schema.type;
    const ok = want === 'number' ? (t === 'number' || t === 'integer')
      : want === 'integer' ? t === 'integer'
        : t === want;
    if (!ok) {
      errors.push(`${pathStr}: expected type ${want}, got ${t}`);
      return;
    }
  }
  if (typeof value === 'number' && typeof schema.minimum === 'number' && value < schema.minimum) {
    errors.push(`${pathStr}: ${value} < minimum ${schema.minimum}`);
  }
  if (typeof value === 'string' && typeof schema.minLength === 'number' && value.length < schema.minLength) {
    errors.push(`${pathStr}: string shorter than minLength ${schema.minLength}`);
  }
  if (schema.type === 'object' && value && typeof value === 'object') {
    const req = schema.required || [];
    for (const key of req) {
      if (!(key in value)) errors.push(`${pathStr}.${key}: required property missing`);
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(value)) {
        if (!(key in schema.properties)) errors.push(`${pathStr}.${key}: additional property not allowed`);
      }
    }
    if (schema.properties) {
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (key in value) validateAgainst(sub, value[key], `${pathStr}.${key}`, errors);
      }
    }
  }
  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    value.forEach((item, idx) => {
      const itemSchema = schema.items.$ref ? resolveRef(schema.items.$ref) : schema.items;
      validateAgainst(itemSchema, item, `${pathStr}[${idx}]`, errors);
    });
  }
}

let LOADED_SCHEMA = null;
function loadSchema(diag) {
  if (LOADED_SCHEMA) return LOADED_SCHEMA;
  LOADED_SCHEMA = safeReadJson(SCHEMA_PATH, diag);
  return LOADED_SCHEMA;
}
function resolveRef(ref) {
  // only supports local "#/$defs/<name>"
  const m = /^#\/\$defs\/(.+)$/.exec(ref);
  if (m && LOADED_SCHEMA && LOADED_SCHEMA.$defs) return LOADED_SCHEMA.$defs[m[1]];
  return {};
}

function validateLedger(ledger, diag) {
  const schema = loadSchema(diag);
  if (!schema) return { valid: false, errors: ['schema-not-loadable'] };
  const errors = [];
  validateAgainst(schema, ledger, '$', errors);
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function renderReport(ledger, diag, validation) {
  const lines = [];
  lines.push('# Motivation scan — last-scan report');
  lines.push('');
  lines.push(`Generated: ${ledger.generated_at}`);
  lines.push(`Schema: ${ledger.schema} (v${ledger.schema_version})`);
  lines.push(`Ledger schema-valid: ${validation.valid ? 'YES' : 'NO'}`);
  lines.push(`Uncategorized signal count: ${ledger.uncategorized_signal_count}`);
  lines.push('');
  lines.push('> Read-only ledger. This scan never executes, never emits proposals, never routes.');
  lines.push('> Interpretive-assessment pressures are surfaced as evidence ONLY and may never drive auto-execution.');
  lines.push('');
  lines.push('## Pressures');
  lines.push('');
  lines.push('| id | class | computed | keep_open | observed | source |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const p of ledger.pressures) {
    lines.push(`| ${p.id} | ${p.pressure_class} | ${p.computed_pressure.toFixed(3)} | ${p.keep_open} | ${p.raw_components.observed_count} | ${p.raw_components.source_kind} |`);
  }
  lines.push('');
  lines.push('## Notes per pressure');
  lines.push('');
  for (const p of ledger.pressures) {
    lines.push(`- **${p.id}** (${p.pressure_class}): ${(p.raw_components.notes || '').trim()}`);
  }
  lines.push('');
  lines.push('## Decay params');
  lines.push('');
  lines.push(`- model: ${ledger.decay.model}`);
  lines.push(`- half_life_days: ${ledger.decay.half_life_days}`);
  lines.push('');
  lines.push('## Read diagnostics (fail-safe log)');
  lines.push('');
  if (diag.length === 0) {
    lines.push('- No read failures.');
  } else {
    for (const d of diag) lines.push(`- ${d}`);
  }
  if (!validation.valid) {
    lines.push('');
    lines.push('## SCHEMA VALIDATION ERRORS');
    for (const e of validation.errors) lines.push(`- ${e}`);
  }
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Core scan (pure: builds artifacts, performs no writes)
// ---------------------------------------------------------------------------

function scan() {
  const diag = [];
  const pressures = [];
  let uncategorized = 0;

  const openLoops = deriveOpenLoops(diag);
  pressures.push(openLoops.pressure);
  uncategorized += openLoops.uncategorized;

  const stale = deriveStaleSignals(diag);
  pressures.push(stale.pressure);
  uncategorized += stale.uncategorized;

  const debriefs = deriveUnpairedDebriefs(diag);
  pressures.push(debriefs.pressure);

  const tests = deriveFailingTests(diag);
  pressures.push(tests.pressure);

  const operator = deriveOperatorWaiting(diag);
  pressures.push(operator.pressure);

  // Interpretive pressure derived AFTER artifact-countable totals are known so
  // it reflects coverage. Quarantined from auto-execution.
  pressures.push(deriveCoverageGap(uncategorized));

  const ledger = {
    schema: SCHEMA_ID,
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    uncategorized_signal_count: uncategorized,
    decay: DECAY,
    pressures
  };

  const validation = validateLedger(ledger, diag);
  const report = renderReport(ledger, diag, validation);
  return { ledger, report, validation, diag };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(
      'motivation-scan.js — read-only homeostatic motivation scanner\n' +
        'Usage: node tools/motivation/motivation-scan.js [--dry-run] [--verbose]\n' +
        '  --dry-run   compute and print what would be written; write nothing\n' +
        '  --verbose   print full ledger JSON\n'
    );
    return 0;
  }
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose');

  const { ledger, report, validation, diag } = scan();

  if (verbose) {
    process.stdout.write(JSON.stringify(ledger, null, 2) + '\n');
  }

  if (dryRun) {
    process.stdout.write('[motivation-scan] DRY-RUN — no files written.\n');
    process.stdout.write(`[motivation-scan] would write: ${path.relative(PROJECT_ROOT, LEDGER_PATH)}\n`);
    process.stdout.write(`[motivation-scan] would write: ${path.relative(PROJECT_ROOT, REPORT_PATH)}\n`);
    process.stdout.write(`[motivation-scan] pressures: ${ledger.pressures.map((p) => p.id).join(', ')}\n`);
    process.stdout.write(`[motivation-scan] uncategorized_signal_count: ${ledger.uncategorized_signal_count}\n`);
    process.stdout.write(`[motivation-scan] schema-valid: ${validation.valid}\n`);
    if (!validation.valid) process.stdout.write(`[motivation-scan] errors: ${validation.errors.join('; ')}\n`);
    if (diag.length) process.stdout.write(`[motivation-scan] read diagnostics: ${diag.length}\n`);
    return validation.valid ? 0 : 1;
  }

  if (!validation.valid) {
    process.stderr.write('[motivation-scan] REFUSING TO WRITE: ledger failed schema validation.\n');
    for (const e of validation.errors) process.stderr.write(`  - ${e}\n`);
    return 1;
  }

  try {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n', 'utf8');
    fs.writeFileSync(REPORT_PATH, report, 'utf8');
  } catch (err) {
    process.stderr.write(`[motivation-scan] write failed: ${err.message}\n`);
    return 1;
  }
  process.stdout.write(`[motivation-scan] wrote ${path.relative(PROJECT_ROOT, LEDGER_PATH)} and ${path.relative(PROJECT_ROOT, REPORT_PATH)}\n`);
  process.stdout.write(`[motivation-scan] pressures: ${ledger.pressures.map((p) => p.id).join(', ')}\n`);
  process.stdout.write(`[motivation-scan] uncategorized_signal_count: ${ledger.uncategorized_signal_count}\n`);
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = {
  scan,
  validateLedger,
  PROJECT_ROOT,
  LEDGER_PATH,
  REPORT_PATH,
  SCHEMA_PATH
};
