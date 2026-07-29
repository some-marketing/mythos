#!/usr/bin/env node
/**
 * verify-all-frameworks.cjs — Run verify-framework for every registered framework.
 *
 * Reads framework IDs from instructions/canonical/system.yaml (the canonical registry)
 * so that no framework list is hardcoded.
 *
 * Usage: node tools/verify/verify-all-frameworks.cjs
 *
 * Exit code 0 = all frameworks pass, 1 = any framework failed
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '../..');
const systemPath = path.join(projectRoot, 'instructions/canonical/system.yaml');
const jsonMode = process.argv.includes('--json');

let system;
try {
  system = JSON.parse(fs.readFileSync(systemPath, 'utf8'));
} catch (e) {
  console.error(`Failed to read system registry: ${e.message}`);
  process.exit(1);
}

const frameworkIds = (system.frameworks || []).map(fw => fw.id);

if (frameworkIds.length === 0) {
  console.error('No frameworks registered in system.yaml');
  process.exit(1);
}

if (!jsonMode) console.log(`Verifying ${frameworkIds.length} registered frameworks...\n`);

const verifyScript = path.join(__dirname, 'verify-framework.cjs');
let anyFailed = false;
const results = [];
const childResults = [];

for (const id of frameworkIds) {
  try {
    if (jsonMode) {
      const stdout = execFileSync('node', [verifyScript, id, '--json'], { encoding: 'utf8' });
      let parsed;
      try { parsed = JSON.parse(stdout); } catch { parsed = null; }
      results.push({ id, status: 'PASS' });
      childResults.push(parsed || { verifier: 'verify-framework', scope: `framework:${id}`, verdict: 'PASS' });
    } else {
      execFileSync('node', [verifyScript, id], { stdio: 'inherit' });
      results.push({ id, status: 'PASS' });
    }
  } catch (e) {
    anyFailed = true;
    results.push({ id, status: 'FAIL' });
    if (jsonMode) {
      // Try to parse JSON from stdout even on non-zero exit
      let parsed = null;
      if (e.stdout) {
        try { parsed = JSON.parse(e.stdout.toString()); } catch {}
      }
      childResults.push(parsed || { verifier: 'verify-framework', scope: `framework:${id}`, verdict: 'FAIL' });
    }
  }
  if (!jsonMode) console.log(''); // separator between frameworks
}

if (jsonMode) {
  const passCount = results.filter(r => r.status === 'PASS').length;
  const failCount = results.filter(r => r.status === 'FAIL').length;
  const output = {
    verifier: 'verify-all-frameworks',
    scope: `all-frameworks (${results.length} registered)`,
    timestamp: new Date().toISOString(),
    verdict: anyFailed ? 'FAIL' : 'PASS',
    summary: {
      total: results.length,
      passed: passCount,
      failed: failCount,
      warned: 0
    },
    findings: results.map(r => ({
      id: `framework.${r.id.replace(/\//g, '_')}`,
      severity: r.status === 'FAIL' ? 'error' : 'info',
      status: r.status,
      message: `Framework ${r.id}: ${r.status}`
    })),
    frameworks: childResults
  };
  console.log(JSON.stringify(output, null, 2));
} else {
  console.log('── All Frameworks Summary ──');
  for (const r of results) {
    console.log(`  ${r.status === 'PASS' ? 'PASS' : 'FAIL'}: ${r.id}`);
  }
  console.log(`\n${results.filter(r => r.status === 'PASS').length}/${results.length} frameworks passed.`);
}

process.exit(anyFailed ? 1 : 0);
