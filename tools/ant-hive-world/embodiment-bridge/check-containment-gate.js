#!/usr/bin/env node
/**
 * check-containment-gate.js
 *
 * Fail-closed release-oracle checker for the ant-hive-world-orwell-sim-containment plan.
 *
 * Owned and implemented by the ant-hive-world-orwell-sim-containment plan's S5 step (NOT by the
 * sibling ant-hive-world-embodiment-s2-bridge plan, which cannot safely author its own
 * precondition-checker inside its own already-gated step). The sibling plan's S3 framework_step
 * invokes this script to decide whether it may proceed past its own block.
 *
 * DEFAULT-DENY CONTRACT: this script treats every ambiguous, missing, malformed, or partially
 * satisfied condition as BLOCKED. It never infers "probably fine" from a single field. It never
 * trusts release_status alone -- it independently re-derives the release decision from every
 * other field and only agrees with release_status when the two are consistent.
 *
 * Exit code: 0  => release oracle confirms RELEASED (sibling may proceed).
 *            1  => BLOCKED (sibling must not proceed) -- includes every failure mode: missing
 *                  file, malformed JSON, schema mismatch, plan_id mismatch, any status field not
 *                  exactly "pass", missing/non-existent completion_audit_artifact, or
 *                  release_status != "released".
 *            2  => usage/invocation error (e.g. bad --receipt path argument itself malformed),
 *                  distinguished from a substantive BLOCKED verdict so callers can tell "the gate
 *                  said no" apart from "you invoked me wrong". Also treated as non-passing by any
 *                  caller checking for exit code 0.
 *
 * Usage:
 *   node check-containment-gate.js [--receipt <path>]
 *     Default --receipt path: ../../../_dev/reports/analysis/ant-hive-world-orwell-sim-containment-release-receipt.json
 *     (relative to this file, i.e. the plan's canonical receipt location).
 *
 *   node check-containment-gate.js --self-test
 *     Runs the built-in self-test suite (see SELF_TEST_CASES below) against synthetic receipt
 *     fixtures written to a temp directory, and exits 0 only if every fixture produces the
 *     EXPECTED verdict (fixtures that should read as released, and every documented way a
 *     fixture can fail, produce BLOCKED). Exits 1 if any fixture's actual verdict diverges from
 *     its expected verdict -- i.e. the self-test itself fails closed on its own correctness.
 *
 * This module can also be required() by other Node code; it exports checkReceipt() and
 * checkReceiptFile() so callers can invoke the gate programmatically instead of shelling out.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const EXPECTED_SCHEMA = 'ContainmentReleaseReceipt/1.0';
const EXPECTED_PLAN_ID = 'ant-hive-world-orwell-sim-containment';
const PASS = 'pass';
const RELEASED = 'released';

const DEFAULT_RECEIPT_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '_dev',
  'reports',
  'analysis',
  'ant-hive-world-orwell-sim-containment-release-receipt.json'
);

/**
 * Independently re-verify the cross-field invariant for an already-parsed receipt object.
 * Never trusts release_status alone.
 *
 * @param {*} receipt - parsed JSON value (may be anything, including non-object garbage).
 * @param {string} receiptPathForArtifactResolution - absolute path of the receipt file itself,
 *   used to resolve a relative completion_audit_artifact path against the receipt's own
 *   directory (falls back to process.cwd() if not provided).
 * @returns {{released: boolean, reasons: string[]}} released=true only when every check below
 *   passes; reasons lists every failing/blocking condition found (empty when released===true).
 */
function checkReceipt(receipt, receiptPathForArtifactResolution) {
  const reasons = [];

  if (receipt === null || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return { released: false, reasons: ['receipt is not a JSON object'] };
  }

  if (receipt.schema !== EXPECTED_SCHEMA) {
    reasons.push(
      `schema mismatch: expected "${EXPECTED_SCHEMA}", got ${JSON.stringify(receipt.schema)}`
    );
  }

  if (receipt.plan_id !== EXPECTED_PLAN_ID) {
    reasons.push(
      `plan_id mismatch: expected "${EXPECTED_PLAN_ID}", got ${JSON.stringify(receipt.plan_id)}`
    );
  }

  if (receipt.s4_verification_status !== PASS) {
    reasons.push(
      `s4_verification_status is not "pass" (got ${JSON.stringify(receipt.s4_verification_status)})`
    );
  }

  if (receipt.completion_audit_status !== PASS) {
    reasons.push(
      `completion_audit_status is not "pass" (got ${JSON.stringify(receipt.completion_audit_status)})`
    );
  }

  const artifact = receipt.completion_audit_artifact;
  if (typeof artifact !== 'string' || artifact.trim() === '') {
    reasons.push('completion_audit_artifact is missing or not a non-empty string');
  } else {
    const baseDir = receiptPathForArtifactResolution
      ? path.dirname(receiptPathForArtifactResolution)
      : process.cwd();
    const resolvedArtifactPath = path.isAbsolute(artifact)
      ? artifact
      : path.resolve(baseDir, artifact);
    let artifactExists = false;
    try {
      artifactExists = fs.existsSync(resolvedArtifactPath) && fs.statSync(resolvedArtifactPath).isFile();
    } catch (_err) {
      artifactExists = false;
    }
    if (!artifactExists) {
      reasons.push(
        `completion_audit_artifact does not point to an existing file: ${resolvedArtifactPath}`
      );
    }
  }

  if (receipt.release_status !== RELEASED) {
    reasons.push(
      `release_status is not "released" (got ${JSON.stringify(receipt.release_status)})`
    );
  }

  // Cross-field invariant, re-derived independently: release_status may only be "released" when
  // BOTH status fields are "pass". Even if every other field above happened to look right, this
  // script does not accept release_status=="released" as sufficient on its own -- it re-derives
  // the expected value and flags any divergence, including the case where release_status claims
  // "released" but the two status fields do not both say "pass" (a forged/corrupted receipt).
  const bothStatusesPass =
    receipt.s4_verification_status === PASS && receipt.completion_audit_status === PASS;
  if (receipt.release_status === RELEASED && !bothStatusesPass) {
    reasons.push(
      'cross-field invariant violated: release_status is "released" but s4_verification_status ' +
        'and completion_audit_status are not both "pass" -- release_status is not trusted alone'
    );
  }

  const released = reasons.length === 0;
  return { released, reasons };
}

/**
 * Fail-closed file-level check: reads and parses the receipt file, then delegates to
 * checkReceipt(). Any I/O or parse failure is itself a BLOCKED verdict, never an exception that
 * escapes to a caller expecting a boolean-shaped result (programmatic callers should still be
 * prepared for this to throw only on truly unexpected internal errors, not on ordinary missing-
 * file/malformed-JSON conditions, which are folded into the returned reasons list).
 *
 * @param {string} receiptPath
 * @returns {{released: boolean, reasons: string[]}}
 */
function checkReceiptFile(receiptPath) {
  if (!fs.existsSync(receiptPath)) {
    return { released: false, reasons: [`receipt file does not exist: ${receiptPath}`] };
  }

  let raw;
  try {
    raw = fs.readFileSync(receiptPath, 'utf8');
  } catch (err) {
    return { released: false, reasons: [`failed to read receipt file: ${err.message}`] };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { released: false, reasons: [`receipt file is not valid JSON: ${err.message}`] };
  }

  return checkReceipt(parsed, receiptPath);
}

// ---------------------------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------------------------

function buildValidPassReceipt(overrides) {
  return Object.assign(
    {
      schema: EXPECTED_SCHEMA,
      plan_id: EXPECTED_PLAN_ID,
      s4_verification_status: PASS,
      completion_audit_status: PASS,
      completion_audit_artifact: '__SELF_TEST_ARTIFACT__',
      release_status: RELEASED,
    },
    overrides || {}
  );
}

function runSelfTest() {
  const os = require('os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-containment-gate-selftest-'));
  const artifactPath = path.join(tmpDir, 'fake-completion-audit.json');
  fs.writeFileSync(artifactPath, JSON.stringify({ verdict: 'pass' }), 'utf8');

  const cases = [
    {
      name: 'fully valid released receipt -> RELEASED',
      receipt: buildValidPassReceipt({ completion_audit_artifact: artifactPath }),
      expectedReleased: true,
    },
    {
      name: 'pre-audit receipt (this plan\'s actual current state) -> BLOCKED',
      receipt: buildValidPassReceipt({
        completion_audit_status: 'pending',
        completion_audit_artifact: '',
        release_status: 'blocked',
      }),
      expectedReleased: false,
    },
    {
      name: 'wrong schema -> BLOCKED',
      receipt: buildValidPassReceipt({ schema: 'ContainmentReleaseReceipt/0.9', completion_audit_artifact: artifactPath }),
      expectedReleased: false,
    },
    {
      name: 'wrong plan_id -> BLOCKED',
      receipt: buildValidPassReceipt({ plan_id: 'ant-hive-world-embodiment-s2-bridge', completion_audit_artifact: artifactPath }),
      expectedReleased: false,
    },
    {
      name: 's4_verification_status not pass -> BLOCKED',
      receipt: buildValidPassReceipt({ s4_verification_status: 'fail', completion_audit_artifact: artifactPath }),
      expectedReleased: false,
    },
    {
      name: 'completion_audit_status not pass -> BLOCKED',
      receipt: buildValidPassReceipt({ completion_audit_status: 'fail', completion_audit_artifact: artifactPath }),
      expectedReleased: false,
    },
    {
      name: 'completion_audit_artifact missing -> BLOCKED',
      receipt: buildValidPassReceipt({ completion_audit_artifact: undefined }),
      expectedReleased: false,
    },
    {
      name: 'completion_audit_artifact points to nonexistent file -> BLOCKED',
      receipt: buildValidPassReceipt({ completion_audit_artifact: path.join(tmpDir, 'does-not-exist.json') }),
      expectedReleased: false,
    },
    {
      name: 'release_status not released even though both statuses pass -> BLOCKED (still correct: caller declared blocked deliberately)',
      receipt: buildValidPassReceipt({ completion_audit_artifact: artifactPath, release_status: 'blocked' }),
      expectedReleased: false,
    },
    {
      name: 'FORGED: release_status says released but statuses do not both say pass -> BLOCKED (never trust release_status alone)',
      receipt: buildValidPassReceipt({
        completion_audit_artifact: artifactPath,
        s4_verification_status: 'pass',
        completion_audit_status: 'fail',
        release_status: 'released',
      }),
      expectedReleased: false,
    },
    {
      name: 'malformed JSON file -> BLOCKED',
      writeRaw: '{ this is not json',
      expectedReleased: false,
    },
    {
      name: 'missing file -> BLOCKED',
      missingFile: true,
      expectedReleased: false,
    },
    {
      name: 'receipt is a JSON array, not an object -> BLOCKED',
      writeRaw: '[1,2,3]',
      expectedReleased: false,
    },
  ];

  let allPassed = true;
  const results = [];

  for (const testCase of cases) {
    const fixturePath = path.join(
      tmpDir,
      `fixture__${testCase.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`
    );

    let verdict;
    if (testCase.missingFile) {
      verdict = checkReceiptFile(path.join(tmpDir, 'this-file-does-not-exist.json'));
    } else if (typeof testCase.writeRaw === 'string') {
      fs.writeFileSync(fixturePath, testCase.writeRaw, 'utf8');
      verdict = checkReceiptFile(fixturePath);
    } else {
      fs.writeFileSync(fixturePath, JSON.stringify(testCase.receipt, null, 2), 'utf8');
      verdict = checkReceiptFile(fixturePath);
    }

    const ok = verdict.released === testCase.expectedReleased;
    allPassed = allPassed && ok;
    results.push({
      name: testCase.name,
      expectedReleased: testCase.expectedReleased,
      actualReleased: verdict.released,
      reasons: verdict.reasons,
      ok,
    });
  }

  // Cleanup fixtures/tmp dir best-effort; a leftover temp dir is not a correctness problem.
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_err) {
    // non-fatal
  }

  for (const r of results) {
    const mark = r.ok ? 'PASS' : 'FAIL';
    console.log(`[${mark}] ${r.name} -> released=${r.actualReleased} (expected ${r.expectedReleased})`);
    if (!r.ok || !r.actualReleased) {
      for (const reason of r.reasons) {
        console.log(`       reason: ${reason}`);
      }
    }
  }

  if (allPassed) {
    console.log(`\nSELF_TEST_OK (${results.length}/${results.length} fixtures matched expected verdict)`);
  } else {
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\nSELF_TEST_FAILED (${failed}/${results.length} fixtures diverged from expected verdict)`);
  }

  return allPassed;
}

// ---------------------------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { receiptPath: DEFAULT_RECEIPT_PATH, selfTest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--self-test') {
      args.selfTest = true;
    } else if (arg === '--receipt') {
      const value = argv[i + 1];
      if (!value) {
        args.usageError = '--receipt requires a path argument';
        break;
      }
      args.receiptPath = path.resolve(value);
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      args.usageError = `unrecognized argument: ${arg}`;
      break;
    }
  }
  return args;
}

function printUsage() {
  console.log(
    [
      'check-containment-gate.js — fail-closed release-oracle checker for',
      '  ant-hive-world-orwell-sim-containment',
      '',
      'Usage:',
      '  node check-containment-gate.js [--receipt <path>]   Check the release receipt (default: canonical plan path). Exit 0 = released, 1 = blocked.',
      '  node check-containment-gate.js --self-test           Run the built-in fixture self-test. Exit 0 = all fixtures matched expected verdict.',
      '  node check-containment-gate.js --help                Print this message.',
    ].join('\n')
  );
}

function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.help) {
    printUsage();
    process.exit(0);
    return;
  }

  if (args.usageError) {
    console.error(`usage error: ${args.usageError}`);
    printUsage();
    process.exit(2);
    return;
  }

  if (args.selfTest) {
    const ok = runSelfTest();
    process.exit(ok ? 0 : 1);
    return;
  }

  const verdict = checkReceiptFile(args.receiptPath);

  console.log(`check-containment-gate: receipt = ${args.receiptPath}`);
  if (verdict.released) {
    console.log('VERDICT: RELEASED — sibling plan may proceed past its S3 block.');
    process.exit(0);
  } else {
    console.log('VERDICT: BLOCKED — sibling plan must NOT proceed. Reasons:');
    for (const reason of verdict.reasons) {
      console.log(`  - ${reason}`);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { checkReceipt, checkReceiptFile, EXPECTED_SCHEMA, EXPECTED_PLAN_ID };
