#!/usr/bin/env node
'use strict';

/**
 * declared-trigger-lint.cjs
 *
 * REPORT MODE ONLY — exits 0 regardless of findings. Enforcement is a
 * separately-gated slice; this tool is read-only and advisory until that gate
 * passes. Convene approval: 20260610T175230Z, item L7.
 *
 * Rule: every command spec that declares a cadence_triggers or bridge_signal
 * key must have a mechanical driver (launchd plist, settings.json hook entry,
 * npm script, or explicit driver field). Every *.cjs file directly in
 * tools/kernel/hooks/ must be referenced in .claude/settings.json OR required
 * by a dispatch-*.cjs file in the same directory OR carry an UNWIRED: marker
 * in its header comment with a reason. Violations are flagged but do NOT fail
 * the process in this report-only mode.
 */

const fs   = require('fs');
const path = require('path');

// ─── helpers ─────────────────────────────────────────────────────────────────

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

/** Recursively collect all keys in an object into a flat set. */
function collectKeys(obj, out = new Set()) {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      out.add(k);
      collectKeys(v, out);
    }
  }
  return out;
}

/** True if the spec object contains cadence_triggers or bridge_signal at any depth. */
function hasTriggerKey(spec) {
  const keys = collectKeys(spec);
  return keys.has('cadence_triggers') || keys.has('bridge_signal');
}

/** True when a manual driver is fully compliant (has owner + reason + workflow). */
function manualDriverCompliant(driverField) {
  return driverField.type === 'manual' &&
    driverField.owner && driverField.reason && driverField.workflow;
}

// ─── Part A: command-spec trigger audit ──────────────────────────────────────

function auditCommandSpecs(root) {
  const commandsDir = path.join(root, 'instructions/canonical/commands');
  const plistDir    = path.join(root, 'tools/launchd');
  const settingsPath = path.join(root, '.claude/settings.json');
  const packagePath  = path.join(root, 'package.json');

  const settingsText = readText(settingsPath);
  const packageJson  = readJson(packagePath) || {};
  const npmScriptsText = JSON.stringify(packageJson.scripts || '');

  // Collect plist file texts once
  let plistText = '';
  if (fs.existsSync(plistDir)) {
    for (const f of fs.readdirSync(plistDir)) {
      if (f.endsWith('.plist')) {
        plistText += readText(path.join(plistDir, f)) + '\n';
      }
    }
  }

  const findings = [];

  if (!fs.existsSync(commandsDir)) {
    return { findings, scanned: 0 };
  }

  const files = fs.readdirSync(commandsDir).filter(f => f.endsWith('.yaml'));
  let scanned = 0;

  for (const file of files) {
    const spec = readJson(path.join(commandsDir, file));
    if (!spec) continue;
    if (!hasTriggerKey(spec)) continue;

    scanned++;
    const id = spec.id || file.replace('.yaml', '');
    const driverField = spec.driver;

    // Check 1: explicit driver field
    if (driverField && typeof driverField === 'object') {
      const validTypes = ['launchd', 'hook', 'listener', 'npm-script', 'manual'];
      if (validTypes.includes(driverField.type)) {
        if (driverField.type === 'manual') {
          if (!manualDriverCompliant(driverField)) {
            findings.push({
              type: 'orphaned-trigger',
              file,
              id,
              reason: 'driver.type=manual but missing one or more of: owner, reason, workflow'
            });
          }
          // else: compliant manual driver — pass
        }
        // non-manual valid type: pass
        continue;
      }
    }

    // Check 2: heuristic — does any external artifact mention this command id?
    const needle = id;
    if (
      plistText.includes(needle) ||
      settingsText.includes(needle) ||
      npmScriptsText.includes(needle)
    ) {
      continue; // heuristic match — has driver
    }

    // No driver found
    findings.push({
      type: 'orphaned-trigger',
      file,
      id,
      reason: 'cadence_triggers / bridge_signal declared but no mechanical driver found'
    });
  }

  return { findings, scanned };
}

// ─── Part B: hook wiring audit ───────────────────────────────────────────────

function auditHooks(root) {
  const hooksDir     = path.join(root, 'tools/kernel/hooks');
  const settingsPath = path.join(root, '.claude/settings.json');
  const settingsText = readText(settingsPath);

  const findings = [];

  if (!fs.existsSync(hooksDir)) {
    return { findings, scanned: 0 };
  }

  // Collect dispatch-*.cjs text
  let dispatchText = '';
  for (const f of fs.readdirSync(hooksDir)) {
    if (f.startsWith('dispatch-') && f.endsWith('.cjs')) {
      dispatchText += readText(path.join(hooksDir, f)) + '\n';
    }
  }

  // Only files directly in hooksDir (no subdirs)
  const hooks = fs.readdirSync(hooksDir).filter(f => {
    if (!f.endsWith('.cjs')) return false;
    const full = path.join(hooksDir, f);
    return fs.statSync(full).isFile();
  });

  for (const hook of hooks) {
    const full = path.join(hooksDir, hook);
    // Read first 30 lines for header check
    const text  = readText(full);
    const lines = text.split('\n').slice(0, 30).join('\n');

    // Check UNWIRED: marker
    if (lines.includes('UNWIRED:')) continue;

    // Check settings.json
    if (settingsText.includes(hook)) continue;

    // Check dispatch requires
    if (dispatchText.includes(hook)) continue;

    findings.push({
      type: 'unwired-hook',
      file: path.relative(root, full),
      hook,
      reason: 'not in settings.json, not required by dispatch-*.cjs, no UNWIRED: marker'
    });
  }

  return { findings, scanned: hooks.length };
}

// ─── report generation ───────────────────────────────────────────────────────

function formatMarkdownReport(specResult, hookResult, runDate) {
  const allFindings = [...specResult.findings, ...hookResult.findings];
  const orphaned = specResult.findings.length;
  const unwired  = hookResult.findings.length;

  const lines = [
    `# Declared-Trigger Lint Report`,
    ``,
    `**Date:** ${runDate}  `,
    `**Mode:** REPORT ONLY (exit 0) — enforcement gated separately (convene 20260610T175230Z item L7)  `,
    `**Specs scanned (with trigger keys):** ${specResult.scanned}  `,
    `**Hooks scanned:** ${hookResult.scanned}  `,
    ``,
    `## Summary`,
    ``,
    `| Category | Count |`,
    `|---|---|`,
    `| Orphaned triggers (A) | ${orphaned} |`,
    `| Unwired hooks (B)     | ${unwired}  |`,
    `| Total findings        | ${allFindings.length} |`,
    ``
  ];

  if (orphaned > 0) {
    lines.push(`## A — Orphaned Triggers`);
    lines.push(``);
    lines.push(`These command specs declare \`cadence_triggers\` or \`bridge_signal\` but have no mechanical driver.`);
    lines.push(``);
    for (const f of specResult.findings) {
      lines.push(`### \`${f.id}\``);
      lines.push(`- **File:** \`instructions/canonical/commands/${f.file}\``);
      lines.push(`- **Reason:** ${f.reason}`);
      lines.push(``);
    }
  } else {
    lines.push(`## A — Orphaned Triggers`);
    lines.push(``);
    lines.push(`No orphaned triggers found.`);
    lines.push(``);
  }

  if (unwired > 0) {
    lines.push(`## B — Unwired Hooks`);
    lines.push(``);
    lines.push(`These hook files in \`tools/kernel/hooks/\` are not wired in \`settings.json\`, not required by any \`dispatch-*.cjs\`, and carry no \`UNWIRED:\` marker.`);
    lines.push(``);
    for (const f of hookResult.findings) {
      lines.push(`### \`${f.hook}\``);
      lines.push(`- **File:** \`${f.file}\``);
      lines.push(`- **Reason:** ${f.reason}`);
      lines.push(``);
    }
  } else {
    lines.push(`## B — Unwired Hooks`);
    lines.push(``);
    lines.push(`No unwired hooks found.`);
    lines.push(``);
  }

  if (allFindings.length === 0) {
    lines.push(`---`);
    lines.push(`_All declared mechanisms have mechanical drivers. No action required._`);
  } else {
    lines.push(`---`);
    lines.push(`_To resolve: add a \`driver\` field to the spec, wire the hook in \`settings.json\`, add a \`require()\` in a dispatch file, or add an \`UNWIRED:\` marker with reason._`);
  }

  return lines.join('\n');
}

// ─── main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const jsonMode   = args.includes('--json');
  // --enforce: exit 1 on any finding. Authorized 2026-06-10 after the first
  // CLEAN inventory (0 orphaned triggers, 0 unwired hooks) per the convene's
  // rollout condition: "lint/report first, enforcement once existing specs
  // have explicit driver or manual markers."
  const enforce    = args.includes('--enforce');
  const reportIdx  = args.indexOf('--report');
  const rootIdx    = args.indexOf('--root');
  const today      = new Date().toISOString().slice(0, 10);

  // Resolve repo root: --root override, else two levels up from tools/maintenance/
  const root = rootIdx !== -1
    ? path.resolve(args[rootIdx + 1])
    : path.resolve(__dirname, '../..');

  const defaultReport = path.join(
    root, '_dev/reports/analysis',
    `declared-trigger-lint__${today}.md`
  );
  const reportPath = reportIdx !== -1 ? args[reportIdx + 1] : defaultReport;

  const specResult = auditCommandSpecs(root);
  const hookResult = auditHooks(root);

  const allFindings = [...specResult.findings, ...hookResult.findings];

  if (jsonMode) {
    process.stdout.write(JSON.stringify({
      date: today,
      mode: enforce ? 'enforce' : 'report-only',
      convene_ref: '20260610T175230Z item L7',
      specs_scanned_with_triggers: specResult.scanned,
      hooks_scanned: hookResult.scanned,
      orphaned_triggers: specResult.findings.length,
      unwired_hooks: hookResult.findings.length,
      findings: allFindings
    }, null, 2) + '\n');
  } else {
    const md = formatMarkdownReport(specResult, hookResult, today);
    // Write report
    const dir = path.dirname(reportPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(reportPath, md, 'utf8');
    console.log(`Declared-trigger lint complete.`);
    console.log(`  Orphaned triggers (A): ${specResult.findings.length}`);
    console.log(`  Unwired hooks (B):     ${hookResult.findings.length}`);
    console.log(`  Report: ${reportPath}`);
  }

  if (enforce && allFindings.length > 0) {
    console.error(`ENFORCE: ${allFindings.length} declared mechanism(s) without a driver — see report.`);
    process.exit(1);
  }
  // REPORT MODE: exit 0
  process.exit(0);
}

main();
