'use strict';

/**
 * telemetry-status.js — Managed command adapter for subagent telemetry.
 *
 * Sections:
 *   1. Rollup summary (P2 span economics via rollup.cjs)
 *   2. Detectors section (P4 passive sensor findings via detect-cascade.cjs)
 *
 * DETECTORS SECTION: pure read-only, passive sensor — findings are evidence,
 * not a failing gate. The detectors section is appended only when the
 * detect-cascade.cjs script is present at the expected path (graceful degradation).
 * Each finding carries a stability_label ('experimental' | 'routine') sourced
 * from the operator-set corpus thresholds at
 *   _dev/state/detectors/corpus-thresholds.json
 * An UNSET threshold keeps all findings 'experimental'.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function telemetryStatus(projectRoot, argsText, options = {}) {
  const rollupScript = path.join(projectRoot, 'tools', 'telemetry', 'dispatches', 'rollup.cjs');
  const detectScript = path.join(projectRoot, 'tools', 'telemetry', 'dispatches', 'detect-cascade.cjs');

  // Parse simple args (scope, since, no-detectors)
  const args = argsText ? argsText.split(/\s+/) : [];
  const scriptArgs = [];
  let skipDetectors = false;
  let traceArg = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scope' || args[i] === '--since') {
      scriptArgs.push(args[i]);
      if (args[i+1]) scriptArgs.push(args[++i]);
    } else if (args[i] === '--no-detectors') {
      skipDetectors = true;
    } else if (args[i] === '--trace' && args[i + 1]) {
      traceArg = args[++i];
    }
  }

  // --- Section 1: Rollup ---
  const child = spawnSync(process.execPath, [rollupScript, ...scriptArgs], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot }
  });

  let combinedStdout = child.stdout || '';
  let combinedStderr = child.stderr || '';

  // --- Section 2: Detectors ---
  if (!skipDetectors && fs.existsSync(detectScript)) {
    const detectArgs = ['--json'];
    if (traceArg) {
      detectArgs.push('--trace', traceArg);
    }

    const detectChild = spawnSync(process.execPath, [detectScript, ...detectArgs], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot }
    });

    if (detectChild.stdout) {
      let detectSection = '\n\n--- P4 Cascade Detectors ---\n';

      try {
        const parsed = JSON.parse(detectChild.stdout.trim());
        const findings = parsed.findings || [];
        const thresholdsSet = parsed.thresholds_set || false;

        detectSection += `trace_id: ${parsed.trace_id || 'none'}\n`;
        detectSection += `thresholds: ${thresholdsSet ? 'set' : 'UNSET (all findings experimental)'}\n`;
        detectSection += `findings: ${findings.length}\n`;

        if (findings.length === 0) {
          detectSection += 'All detectors clean — no findings.\n';
        } else {
          for (let i = 0; i < findings.length; i++) {
            const f = findings[i];
            detectSection += `\n[${i + 1}] ${f.detector} [${f.stability_label}]\n`;
            detectSection += `  span: ${f.span_ref.span_id || 'null'} / ${f.span_ref.trace_id || 'null'}\n`;
            detectSection += `  ${f.observation}\n`;
            detectSection += `  ${f.hypothesis}\n`;
            detectSection += `  Evidence Locations:\n`;
            for (const loc of (f.evidence_locations || [])) {
              detectSection += `    - ${loc}\n`;
            }
          }
        }
      } catch (_) {
        // Fallback: render raw output if JSON parse fails
        detectSection += detectChild.stdout;
      }

      combinedStdout += detectSection;
    }

    if (detectChild.stderr) {
      combinedStderr += detectChild.stderr;
    }
  } else if (!skipDetectors && !fs.existsSync(detectScript)) {
    combinedStdout += '\n\n--- P4 Cascade Detectors ---\n[detectors not available — detect-cascade.cjs not found]\n';
  }

  return {
    exitCode: child.status || 0,
    stdout: combinedStdout,
    stderr: combinedStderr
  };
}

module.exports = { telemetryStatus };
