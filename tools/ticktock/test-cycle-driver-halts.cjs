#!/usr/bin/env node
'use strict';

// tools/ticktock/test-cycle-driver-halts.cjs -- acceptance tests proving that
// cycle-driver.cjs, the mechanical call-surface a live /tt cycle actually
// drives, can fire the CEILING-EXCEEDED and MERGE-NOT-CLEAN halts through
// their real emitters (ceilings.cjs and write-review-decision.cjs).
//
// THE DEFECT THIS REPAIRS. ceilings.cjs and write-review-decision.cjs's
// MERGE-NOT-CLEAN block are correctly written and independently tested
// (test-ceilings.cjs; write-review-decision.cjs's own schema/roster checks),
// but cycle-driver.cjs -- the ONLY file with literal path arguments the
// write-boundary gate lets a live /tt cycle call -- never required or called
// either one. A halt whose only caller is a test file cannot fire in a real
// cycle. The second dry run's MERGE-NOT-CLEAN record
// (_dev/state/ticktock/journals/dryrun-002.20260806.jsonl, record_index 7) was
// produced by the coordinator hand-typing halt_state: "MERGE-NOT-CLEAN" into a
// partial JSON for cycle-driver's generic `phase` command -- an ad hoc halt
// that bypassed write-review-decision.cjs's roster/lane-mismatch check, its
// schema validation, and its atomic-write-then-reread discipline entirely.
// That is the same shape as a producer asserting its own verdict rather than a
// mechanism computing it.
//
// This file proves the repair two ways:
//   1. GREEN: cycle-driver's new `ceiling-check` and `review-decision`
//      subcommands drive the real emitters and the halt lands in the journal.
//   2. RED-THEN-GREEN for MERGE-NOT-CLEAN specifically: section 2 below
//      documents (and, where practical, exercises) that PRE-WIRING,
//      cycle-driver had no `review-decision` command at all -- invoking one
//      failed with exit 2 and usage text, and the journal stayed empty. That
//      is the failing run this file was first executed against. Section 2's
//      assertions are the passing run after the wiring landed.
//
// Run: node tools/ticktock/test-cycle-driver-halts.cjs

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const charterMod = require('./charter.cjs');
const journal = require('./journal.cjs');

const DRIVER = path.join(__dirname, 'cycle-driver.cjs');
const REPO_ROOT = path.resolve(__dirname, '..', '..');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    process.stdout.write(`  PASS  ${name}\n`);
  } else {
    failed += 1;
    process.stdout.write(`  FAIL  ${name}\n        ${detail === undefined ? '' : JSON.stringify(detail)}\n`);
  }
}
function section(title) { process.stdout.write(`\n${title}\n`); }

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
  return p;
}

function runDriver(args, opts) {
  try {
    const out = execFileSync('node', [DRIVER, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: REPO_ROOT,
      ...opts
    });
    return { status: 0, stdout: out };
  } catch (err) {
    return { status: err.status === undefined ? null : err.status, stdout: err.stdout || '', stderr: err.stderr || '', error: err };
  }
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-cycle-driver-halts-'));

// T1 (tt-charter-template-and-spend-ledger, round-2 coordinator design
// decision): the canonical template's floors ({36440 lines, 77 files, 9
// external actions}) make it impossible to build a small-ceiling charter
// through createCharter() -- which section 1 below needs, to test
// CEILING-EXCEEDED through the REAL readCharter()-validated cycle-driver
// pipeline rather than only ceilings.cjs's own math. fixtureCharter() now
// passes { templatePath: MINIMAL_TEMPLATE } -- charter.cjs's opt-in,
// module-level-only override (see its "Template override" comment) -- to
// bind against __fixtures__/charter-template-test-minimal.json instead,
// whose floors are 0. That template is permissive, not absent: the spec
// below still has to satisfy it, it is just undemanding enough that these
// small, boundary-readable ceiling values (5 lines / 2 files / 1 external
// action) pass. Production is unaffected: cycle-driver.cjs's create-charter
// command never passes opts, so a live /tt cycle stays bound to the
// canonical template regardless of what any test file does.
const MINIMAL_TEMPLATE = path.join(__dirname, '__fixtures__', 'charter-template-test-minimal.json');

function fixtureCharter(id) {
  return charterMod.createCharter({
    charter_id: id,
    created_at: '2026-08-11T06:00:00.000Z',
    target: { description: 'cycle-driver halt-wiring fixture', repo_root: REPO_ROOT, subject: 'unit test' },
    cycle_ceiling: 5,
    evaluator_versions: { journal: '1.0' },
    allowed_write_surfaces: ['tools/ticktock/**'],
    max_cumulative_diff: { lines_changed: 5, files_changed: 2 },
    max_external_actions: 1,
    resource_ceilings: { wall_clock_seconds_per_cycle: 60, wall_clock_seconds_total: 600, max_subagent_dispatches: 1 },
    reviewer_roster: {
      locked_at: '2026-08-11T06:00:00.000Z',
      lanes: [
        { lane_id: 'codex-1', family: 'codex', model_pin: 'gpt-5-codex', assignment_order: 0, role: 'adversarial', availability: { reachable: true, checked_at: '2026-08-11T06:00:00.000Z', check_method: 'bridge-ping' } },
        { lane_id: 'gemini-1', family: 'gemini', model_pin: 'gemini-2.5-pro', assignment_order: 1, role: 'context', availability: { reachable: true, checked_at: '2026-08-11T06:00:00.000Z', check_method: 'bridge-ping' } }
      ]
    },
    stopping_rules: { until_kind: 'cycle_ceiling', halt_conditions: ['CEILING-EXCEEDED', 'MERGE-NOT-CLEAN'] },
    benchmark: {
      colony_spec_path: 'tools/ticktock/benchmark-colony-v1.json',
      colony_spec_version: 'v1',
      fingerprint_path: '_dev/state/ticktock/benchmark-fingerprint-v1.json',
      fingerprint_hash: 'a'.repeat(64),
      rebaseline_detector: { enabled: true, n_threshold: 2, m_window: 5 }
    }
  }, { templatePath: MINIMAL_TEMPLATE });
}

// ---------------------------------------------------------------------------
section('1. CEILING-EXCEEDED fires through cycle-driver, not just ceilings.cjs directly');
// ---------------------------------------------------------------------------
{
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'ceiling-'));
  const charter = fixtureCharter('cd-ceiling-fixture');
  const charterPath = writeJson(path.join(dir, 'charter.json'), charter);
  const journalPath = path.join(dir, 'journal.jsonl');
  const ledgerPath = path.join(dir, 'ledger.json');

  // T1 (tt-charter-template-and-spend-ledger): the deltas below used to be
  // hardcoded (2 under / 10 over) against the old fixture's tiny 5-line
  // ceiling. createCharter() now refuses a spec with a ceiling that small
  // (below the template floor), so the fixture's ceiling is now the large
  // template floor -- these deltas are read off it dynamically instead, the
  // same S3-g-style fix already applied in dryrun-s3.cjs and test-ceilings.cjs.
  const LINES = charter.max_cumulative_diff.lines_changed;

  // Under ceiling: well within the limit. No halt.
  const under = runDriver(['ceiling-check', charterPath, ledgerPath,
    writeJson(path.join(dir, 'delta-under.json'), { lines_changed: LINES - 1, files: ['a.js'], phase_id: 'tt.tick', cycle_index: 0 }),
    journalPath]);
  check('a within-ceiling delta does not halt (exit 0)', under.status === 0, under.stdout + under.stderr);
  check('a within-ceiling delta writes no journal record', !fs.existsSync(journalPath) || journal.readJournal(journalPath).length === 0);

  // Over ceiling: pushes cumulative past the limit by 2 (LINES - 1 already
  // spent, + 2 more = LINES + 1). tt.tock is a PURE phase (charter.cjs
  // PURE_PHASES) -- journal.appendRecord refuses an EFFECTFUL phase record
  // with no idempotency_key, a separate invariant this test does not need to
  // exercise to prove the ceiling halt fires.
  const over = runDriver(['ceiling-check', charterPath, ledgerPath,
    writeJson(path.join(dir, 'delta-over.json'), { lines_changed: 2, files: ['b.js'], phase_id: 'tt.tock', cycle_index: 0 }),
    journalPath]);
  check('an over-ceiling delta halts (nonzero exit)', over.status !== 0, over.stdout + over.stderr);

  const records = journal.readJournal(journalPath);
  const halted = records.find((r) => r.halt_state === 'CEILING-EXCEEDED');
  check('the journal, read back from disk, carries a CEILING-EXCEEDED record', Boolean(halted), JSON.stringify(records));
  check('the halt is attributed to the phase boundary that tripped it', halted && halted.phase_id === 'tt.tock');

  // Cross-charter ledger reuse: codex review finding — loadLedger() must
  // refuse a persisted ledger that was opened against a DIFFERENT charter,
  // rather than silently re-stamping it with the current charter's identity.
  const otherCharter = fixtureCharter('cd-ceiling-fixture-OTHER');
  const otherCharterPath = writeJson(path.join(dir, 'charter-other.json'), otherCharter);
  const crossCharter = runDriver(['ceiling-check', otherCharterPath, ledgerPath,
    writeJson(path.join(dir, 'delta-cross.json'), { lines_changed: 1, files: ['c.js'], phase_id: 'tt.tock', cycle_index: 0 }),
    journalPath]);
  check('a ledger opened against a different charter is refused, not silently reused',
    crossCharter.status !== 0 && /CEILING-LEDGER-REFUSED/.test(crossCharter.stdout + crossCharter.stderr),
    crossCharter.stdout + crossCharter.stderr);
}

// ---------------------------------------------------------------------------
section('2. MERGE-NOT-CLEAN fires through cycle-driver — the operator\'s named path');
// ---------------------------------------------------------------------------
//
// PRE-WIRING (the run this file was first executed against): cycle-driver.cjs
// had no `review-decision` subcommand. `commands['review-decision']` was
// undefined, main() fell through to the usage branch, and the process exited
// 2 printing "usage: cycle-driver.cjs <create-charter|benchmark|idem|...>" --
// review-decision was not even in the list. Nothing was journalled. That is
// the RED run: reproduce it by checking out this file against the pre-wiring
// cycle-driver.cjs and it fails every assertion below with exit 2 and an
// empty journal.
{
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'merge-'));
  const charter = fixtureCharter('cd-merge-not-clean-fixture');
  const charterPath = writeJson(path.join(dir, 'charter.json'), charter);
  const journalPath = path.join(dir, 'journal.jsonl');

  // One clean lane, one lane with an unresolved finding -- not clean overall,
  // and NOT hand-typed: this is what write-review-decision.cjs's own
  // conjunction (laneIsClean) computes from the lane records below.
  const lanes = [
    { lane_id: 'codex-1', family: 'codex', model_pin_requested: 'gpt-5-codex', model_pin_observed: 'gpt-5-codex', pin_verified: true, status: 'clean', verdict: 'APPROVE', unresolved_findings: 0, review_artifact_path: 'fixture' },
    { lane_id: 'gemini-1', family: 'gemini', model_pin_requested: 'gemini-2.5-pro', model_pin_observed: 'gemini-2.5-pro', pin_verified: true, status: 'findings', verdict: 'AMEND_REQUIRED', unresolved_findings: 2, review_artifact_path: 'fixture' }
  ];
  const lanesPath = writeJson(path.join(dir, 'lanes.json'), lanes);
  const decisionOut = path.join(dir, 'decision.json');

  const result = runDriver(['review-decision', charterPath, lanesPath, 'test-harness', '2026-08-11T06:05:00.000Z',
    '--out', decisionOut, '--journal', journalPath, '--cycle', '0']);

  check('the wired review-decision command runs to completion (exit 0)', result.status === 0, result.stdout + result.stderr);

  const decision = fs.existsSync(decisionOut) ? JSON.parse(fs.readFileSync(decisionOut, 'utf8')) : null;
  check('the decision artifact itself is NOT cleared -- computed, not asserted', Boolean(decision) && decision.decision.cleared === false, JSON.stringify(decision && decision.decision));

  const records = journal.readJournal(journalPath);
  const halted = records.find((r) => r.halt_state === 'MERGE-NOT-CLEAN');
  check('cycle-driver drove the record into the journal -- read back from disk, not trusted from stdout', Boolean(halted), JSON.stringify(records));
  check('the halt names the phase it guards', halted && halted.phase_id === 'tt.ship');
  check('the halt detail names the not-clean lane', halted && /gemini-1/.test(halted.halt_detail || ''), halted && halted.halt_detail);

  // Differential control: a genuinely clean roster must NOT halt. Proves the
  // wiring didn't just hardcode a halt -- it carries the real conjunction.
  const cleanLanes = lanes.map((l) => ({ ...l, status: 'clean', verdict: 'APPROVE', unresolved_findings: 0 }));
  const cleanLanesPath = writeJson(path.join(dir, 'lanes-clean.json'), cleanLanes);
  const cleanJournalPath = path.join(dir, 'journal-clean.jsonl');
  const cleanResult = runDriver(['review-decision', charterPath, cleanLanesPath, 'test-harness', '2026-08-11T06:06:00.000Z',
    '--out', path.join(dir, 'decision-clean.json'), '--journal', cleanJournalPath, '--cycle', '0', '--cleared']);
  check('a genuinely clean roster passes --cleared and runs to completion', cleanResult.status === 0, cleanResult.stdout + cleanResult.stderr);
  const cleanRecords = fs.existsSync(cleanJournalPath) ? journal.readJournal(cleanJournalPath) : [];
  check('a clean roster writes NO halt record (MERGE-NOT-CLEAN never fires when the roster is actually clean)', cleanRecords.length === 0, JSON.stringify(cleanRecords));

  // Codex review finding: write-review-decision.cjs itself returns exit 0
  // whenever the decision artifact was written and validated, REGARDLESS of
  // whether the not-clean halt reached the journal (a journalling exception
  // there is caught, logged, and the exit code left at 0 -- "the decision
  // STANDS; only the halt record is missing"). cycle-driver's review-decision
  // command must not blindly trust that exit code for exactly this reason.
  const omitted = runDriver(['review-decision', charterPath, lanesPath, 'test-harness', '2026-08-11T06:07:00.000Z',
    '--out', path.join(dir, 'decision-no-journal.json')]);
  check('omitting --journal (and --dry-run) is REFUSED outright, before the halt can ever go missing',
    omitted.status !== 0 && /--journal/.test(omitted.stdout + omitted.stderr), omitted.stdout + omitted.stderr);

  const journalFailed = runDriver(['review-decision', charterPath, lanesPath, 'test-harness', '2026-08-11T06:08:00.000Z',
    '--out', path.join(dir, 'decision-journal-fails.json'), '--journal', '/dev/null/journal.jsonl', '--cycle', '0']);
  check('a not-clean decision whose journal write fails is refused, not silently exit-0',
    journalFailed.status !== 0 && /NOT confirmed in the journal/.test(journalFailed.stdout + journalFailed.stderr),
    journalFailed.stdout + journalFailed.stderr);
}

// ---------------------------------------------------------------------------
section('3. GATE-BLOCKED fires through cycle-driver — pretooluse-live / G-TICKTOCK-REVIEW');
// ---------------------------------------------------------------------------
//
// Unlike sections 1 and 2, this exercises the REAL live gates (pretooluse-live
// and G-TICKTOCK-REVIEW), which read this repo's actual .claude/settings.json
// wiring and the actual shared decision artifact at
// _dev/state/ticktock/g-ticktock-review-decision.json -- not a fixture. That
// decision artifact's decision.cleared is false today (S4-B's trial did not
// clear), so a non-dry-run invocation whose resolved phases include tt.tick
// deterministically refuses at G-TICKTOCK-REVIEW *provided* pretooluse-live
// itself does not refuse first. This test states that dependency rather than
// hiding it, exactly as test-preflight-live-probe.cjs already does for the
// same gate.
{
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'gate-blocked-'));
  const charter = fixtureCharter('cd-gate-blocked-fixture');
  const charterPath = writeJson(path.join(dir, 'charter.json'), charter);
  const journalPath = path.join(dir, 'journal.jsonl');

  // Bare form: resolves to all NINE_PHASES including tt.tick, not attended
  // (unattended requires --until or N>1), so it is remote-capable and
  // pretooluse-live applies; G-TICKTOCK-REVIEW also applies because tt.tick
  // is in its resolved phases and the invocation is not --dry-run.
  const result = runDriver(['preflight', charterPath, journalPath, '0']);
  let verdict = null;
  try { verdict = JSON.parse(result.stdout); } catch { /* handled by the checks below */ }

  if (result.status === 0) {
    // A PROCEED is only a legitimate skip if BOTH gates genuinely evaluated
    // and cleared -- not merely "the process happened to exit 0". Parsing
    // stdout here is what stops a broken G-TICKTOCK-REVIEW wiring (one that
    // silently no-ops instead of reading the real decision artifact) from
    // hiding behind a pretooluse-live PROCEED and this branch.
    check('a PROCEED verdict is parseable and names both gates as PROCEED (not a swallowed refusal)',
      Boolean(verdict) && verdict.verdict === 'PROCEED'
      && Array.isArray(verdict.gates) && verdict.gates.every((g) => g.verdict === 'PROCEED'),
      result.stdout + result.stderr);
    process.stdout.write('  SKIP  GATE-BLOCKED live-gate case: pretooluse-live and G-TICKTOCK-REVIEW both PROCEEDed against live repo state this run (expected only if the shared decision artifact has since cleared) -- the wiring itself (subcommand exists, exit code and stdout propagate) is still exercised by every PASS above and by section 3\'s own successful spawn.\n');
  } else {
    // Confirm G-TICKTOCK-REVIEW specifically refused, rather than accepting
    // any refusal (e.g. pretooluse-live alone, which would pass even if the
    // G-TICKTOCK-REVIEW wiring were broken).
    check('the parsed verdict attributes the refusal to G-TICKTOCK-REVIEW',
      Boolean(verdict) && Array.isArray(verdict.refused_by) && verdict.refused_by.includes('G-TICKTOCK-REVIEW'),
      result.stdout + result.stderr);

    const records = journal.readJournal(journalPath);
    const halted = records.find((r) => r.halt_state === 'GATE-BLOCKED');
    check('a live preflight refusal reaches the journal as GATE-BLOCKED, driven through cycle-driver', Boolean(halted), JSON.stringify(records));
    check('the halt is recorded at tt.orient, the phase-entry boundary', halted && halted.phase_id === 'tt.orient');
    check('the halt detail names G-TICKTOCK-REVIEW', halted && /G-TICKTOCK-REVIEW/.test(halted.halt_detail || ''), halted && halted.halt_detail);
  }
}

// ---------------------------------------------------------------------------
section('4. T1 round-2: the create-charter CLI has no template-override path');
// ---------------------------------------------------------------------------
//
// THE CLAIM THIS PROVES: charter.cjs's { templatePath } override (used by
// fixtureCharter() above, and nowhere in production) is module-level only --
// cycle-driver.cjs's create-charter subcommand, the ONE call path a live /tt
// cycle can reach (per this file's own header comment), is unconditionally
// bound to the canonical charter-template-run.json. Proven two ways: a
// static check that the command's own source never threads a second argument
// to createCharter(), and a behavioral check that no amount of extra argv can
// make the live CLI accept a spec that only the PERMISSIVE test template
// would allow.
{
  const driverSrc = fs.readFileSync(DRIVER, 'utf8');
  const createCharterCmdMatch = driverSrc.match(/'create-charter':\s*\(specPath,\s*outPath\)\s*=>\s*\{([\s\S]*?)\n {2}\},/);
  check('the create-charter command signature takes exactly (specPath, outPath) -- no third argv-derived template parameter',
    Boolean(createCharterCmdMatch), 'command block not found at the expected shape -- source may have moved');
  if (createCharterCmdMatch) {
    const body = createCharterCmdMatch[1];
    check('createCharter() is called with exactly one argument inside the command (readJson(specPath), no opts)',
      body.includes('charterMod.createCharter(readJson(specPath))')
        && !body.includes('charterMod.createCharter(readJson(specPath),'),
      body);
  }

  // Behavioral: a spec whose ceilings satisfy ONLY the permissive test
  // template (5 lines / 2 files / 1 action, far below the canonical
  // template's {36440, 77, 9} floors) is fed to the LIVE CLI, with an extra,
  // made-up flag appended after the two positional arguments -- an attempt
  // to smuggle a template override through argv the command does not define.
  // If the CLI were reachable by any override, this spec would succeed; it
  // must instead refuse exactly as it would with no extra argv at all.
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'no-override-'));
  const smallSpec = {
    charter_id: 'tt-cli-no-override-probe',
    created_at: '2026-08-14T06:00:00.000Z',
    target: { description: 'CLI template-override probe', repo_root: REPO_ROOT, subject: 'unit test' },
    cycle_ceiling: 5,
    evaluator_versions: { journal: '1.0' },
    allowed_write_surfaces: ['tools/ticktock/**'],
    max_cumulative_diff: { lines_changed: 5, files_changed: 2 },
    max_external_actions: 1,
    resource_ceilings: { wall_clock_seconds_per_cycle: 60, wall_clock_seconds_total: 600, max_subagent_dispatches: 1 },
    reviewer_roster: {
      locked_at: '2026-08-14T06:00:00.000Z',
      lanes: [
        { lane_id: 'codex-1', family: 'codex', model_pin: 'gpt-5-codex', assignment_order: 0, role: 'adversarial', availability: { reachable: true, checked_at: '2026-08-14T06:00:00.000Z', check_method: 'bridge-ping' } },
        { lane_id: 'gemini-1', family: 'gemini', model_pin: 'gemini-2.5-pro', assignment_order: 1, role: 'context', availability: { reachable: true, checked_at: '2026-08-14T06:00:00.000Z', check_method: 'bridge-ping' } }
      ]
    },
    stopping_rules: { until_kind: 'cycle_ceiling', halt_conditions: ['CEILING-EXCEEDED'] },
    benchmark: {
      colony_spec_path: 'tools/ticktock/benchmark-colony-v1.json',
      colony_spec_version: 'v1',
      fingerprint_path: '_dev/state/ticktock/benchmark-fingerprint-v1.json',
      fingerprint_hash: 'a'.repeat(64),
      rebaseline_detector: { enabled: true, n_threshold: 2, m_window: 5 }
    }
  };
  const specPath = writeJson(path.join(dir, 'small-spec.json'), smallSpec);
  const outPath = path.join(dir, 'out-charter.json');
  const attempt = runDriver(['create-charter', specPath, outPath,
    '--template', MINIMAL_TEMPLATE,
    '--template-path', MINIMAL_TEMPLATE]);
  check('the live CLI refuses a small-ceiling spec even with extra argv attempting to name the permissive template',
    attempt.status !== 0, attempt.stdout + attempt.stderr);
  // Refuses against the CANONICAL template -- TEMPLATE-SURFACE-DROPPED (the
  // spec's single tools/ticktock/** surface is missing the canonical
  // template's other mandated surfaces) or TEMPLATE-CEILING-UNDERSIZED (the
  // 5/2/1 ceilings are below the canonical 36440/77/9 floors) are both proof
  // of the same fact: the live CLI is bound to the DEMANDING canonical
  // template, never the permissive test one, no matter what argv follows the
  // two positional arguments it actually reads.
  check('the refusal is against the CANONICAL template, not the permissive test template (TEMPLATE-SURFACE-DROPPED or TEMPLATE-CEILING-UNDERSIZED, naming run-charter-template-v1)',
    /TEMPLATE-(SURFACE-DROPPED|CEILING-UNDERSIZED)/.test(attempt.stdout + attempt.stderr)
      && /run-charter-template-v1/.test(attempt.stdout + attempt.stderr),
    attempt.stdout + attempt.stderr);
  check('no charter file was written', !fs.existsSync(outPath));
}

// ---------------------------------------------------------------------------
process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
