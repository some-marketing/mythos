#!/usr/bin/env node
/**
 * verify-command.cjs — Mechanical validation of a single slash command .md file.
 *
 * Usage: node tools/verify/verify-command.cjs <path-to-command.md>
 *        node tools/verify/verify-command.cjs --all
 *        node tools/verify/verify-command.cjs <path> --json
 *
 * Validates: frontmatter, description quality, argument handling,
 *            tool restrictions, dynamic context, file references.
 *
 * Exit code 0 = PASS/WARN, 1 = FAIL
 */

const fs = require('fs');
const path = require('path');
const { createSignal, addCheck, writeSignal, printSummary, printJsonOutput } = require('./lib/signal.cjs');
const checks = require('./lib/checks.cjs');

// ─── Argument parsing ───────────────────────────────────────────────────

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flags = process.argv.slice(2).filter(a => a.startsWith('--'));
const runAll = flags.includes('--all');
const jsonMode = flags.includes('--json');

if (!runAll && args.length === 0) {
  console.error('Usage: node tools/verify/verify-command.cjs <path-to-command.md>');
  console.error('       node tools/verify/verify-command.cjs --all');
  process.exit(2);
}

// ─── Helpers ────────────────────────────────────────────────────────────

function getFrontmatter(content) {
  if (!content.startsWith('---')) return '';
  const endIdx = content.indexOf('---', 3);
  if (endIdx === -1) return '';
  return content.slice(3, endIdx);
}

function getBody(content) {
  const parts = content.split('---');
  if (parts.length < 3) return content;
  return parts.slice(2).join('---');
}

function extractFmField(fm, field) {
  const match = fm.match(new RegExp(`^${field}:\\s*(.+(?:\\n\\s+.+)*)$`, 'm'));
  return match ? match[1].trim() : null;
}

// ─── Single-file verification ───────────────────────────────────────────

function verifyCommand(cmdPath) {
  const fullPath = path.resolve(cmdPath);
  const cmdName = path.basename(fullPath, '.md');
  const signal = createSignal('verify-command', `command:${cmdName}`);

  // ── Basics ──

  addCheck(signal, checks.fileExists(fullPath, {
    id: 'cmd.exists',
    message: `Command file exists: ${cmdName}`
  }));

  if (!fs.existsSync(fullPath)) {
    return signal;
  }

  const content = fs.readFileSync(fullPath, 'utf8');
  const fm = getFrontmatter(content);
  const body = getBody(content);

  addCheck(signal, checks.fileMinSize(fullPath, 100, {
    id: 'cmd.min_size',
    severity: 'warning',
    message: 'Command file >= 100 bytes (non-trivial content)'
  }));

  // ── Frontmatter: description ──

  addCheck(signal, {
    id: 'cmd.has_frontmatter',
    category: 'frontmatter',
    severity: 'critical',
    message: 'Has YAML frontmatter',
    evidence: fullPath,
    test: () => content.startsWith('---') && content.indexOf('---', 3) > 3,
    fix_hint: 'Add YAML frontmatter delimited by ---'
  });

  addCheck(signal, {
    id: 'cmd.has_description',
    category: 'frontmatter',
    severity: 'critical',
    message: 'Has description field in frontmatter',
    evidence: fullPath,
    test: () => /^description:/m.test(fm),
    fix_hint: 'Add description: field to YAML frontmatter'
  });

  // Description quality: not vague
  addCheck(signal, {
    id: 'cmd.description_specific',
    category: 'quality',
    severity: 'warning',
    message: 'Description is specific (not vague)',
    evidence: fullPath,
    test: () => {
      const desc = extractFmField(fm, 'description');
      if (!desc) return false;
      const vague = ['helps with', 'processes data', 'handles things', 'does stuff'];
      return !vague.some(v => desc.toLowerCase().includes(v));
    },
    fix_hint: 'Replace vague description with specific action verb + what the command does'
  });

  // ── Argument handling ──

  const usesArguments = body.includes('$ARGUMENTS') || body.includes('$1') || body.includes('$2');

  addCheck(signal, {
    id: 'cmd.argument_hint',
    category: 'arguments',
    severity: 'warning',
    message: 'Has argument-hint when command uses arguments',
    evidence: fullPath,
    test: () => {
      if (!usesArguments) return true; // No arguments used, hint not needed
      return /^argument-hint:/m.test(fm);
    },
    fix_hint: 'Add argument-hint: field to frontmatter since command uses $ARGUMENTS or positional args'
  });

  // Check argument integration — if argument-hint exists, $ARGUMENTS should be used
  addCheck(signal, {
    id: 'cmd.argument_used',
    category: 'arguments',
    severity: 'warning',
    message: 'Arguments referenced in body when argument-hint declared',
    evidence: fullPath,
    test: () => {
      const hasHint = /^argument-hint:/m.test(fm);
      if (!hasHint) return true; // No hint, no requirement
      return usesArguments;
    },
    fix_hint: 'argument-hint declared but $ARGUMENTS/$1/$2 not used in command body'
  });

  // ── Tool restrictions ──

  const hasAllowedTools = /^allowed-tools:/m.test(fm);

  addCheck(signal, {
    id: 'cmd.allowed_tools_present',
    category: 'tools',
    severity: 'warning',
    message: 'Has allowed-tools restriction (recommended for most commands)',
    evidence: fullPath,
    test: () => hasAllowedTools,
    fix_hint: 'Add allowed-tools: field to restrict tool access for this command'
  });

  // Security-sensitive commands should have tool restrictions
  addCheck(signal, {
    id: 'cmd.security_tools',
    category: 'security',
    severity: 'warning',
    message: 'Security-sensitive operations have tool restrictions',
    evidence: fullPath,
    test: () => {
      const securityTerms = ['git push', 'git reset', 'deploy', 'delete', 'remove', 'drop'];
      const isSecuritySensitive = securityTerms.some(t => body.toLowerCase().includes(t));
      if (!isSecuritySensitive) return true; // Not security-sensitive
      return hasAllowedTools;
    },
    fix_hint: 'This command involves security-sensitive operations — add allowed-tools restrictions'
  });

  // ── Dynamic context ──

  // Commands that reference git should load git status
  addCheck(signal, {
    id: 'cmd.dynamic_context',
    category: 'context',
    severity: 'warning',
    message: 'State-dependent commands load dynamic context',
    evidence: fullPath,
    test: () => {
      const isGitCommand = body.toLowerCase().includes('git ') || body.toLowerCase().includes('commit');
      if (!isGitCommand) return true;
      // Check for backtick-command syntax (dynamic context loading)
      return body.includes('`git ') || body.includes('!`') || body.includes('git status') || body.includes('git diff') || body.includes('git log');
    },
    fix_hint: 'Add dynamic context loading (e.g., `git status`) for state-dependent commands'
  });

  // ── File references ──

  // Check @ references resolve
  addCheck(signal, {
    id: 'cmd.file_refs_resolve',
    category: 'references',
    severity: 'warning',
    message: 'File references (@path) resolve to existing files',
    evidence: fullPath,
    test: () => {
      const refs = [...body.matchAll(/@([^\s,)}\]]+\.(md|json|yaml|yml|js|cjs))/g)];
      if (refs.length === 0) return true;
      const projectRoot = path.resolve(__dirname, '../..');
      return refs.every(ref => {
        const refPath = path.join(projectRoot, ref[1]);
        return fs.existsSync(refPath);
      });
    },
    fix_hint: 'Fix broken file references — ensure @path targets exist on disk'
  });

  // ── Content quality ──

  addCheck(signal, {
    id: 'cmd.has_process',
    category: 'content',
    severity: 'warning',
    message: 'Has structured process or steps',
    evidence: fullPath,
    test: () => {
      // Check for numbered steps, bullet lists, or section structure
      return /^\d+\.\s/m.test(body) || /^[-*]\s/m.test(body) || /<process/i.test(body);
    },
    fix_hint: 'Add numbered steps or structured process to the command body'
  });

  addCheck(signal, {
    id: 'cmd.has_success_criteria',
    category: 'content',
    severity: 'warning',
    message: 'Defines success criteria or expected output',
    evidence: fullPath,
    test: () => {
      const terms = ['success', 'criteria', 'output', 'result', 'produce', 'artifact', 'expected'];
      const lower = body.toLowerCase();
      return terms.filter(t => lower.includes(t)).length >= 2;
    },
    fix_hint: 'Add success criteria or expected output section'
  });

  return signal;
}

// ─── Discover all commands ──────────────────────────────────────────────

function discoverCommands() {
  const projectRoot = path.resolve(__dirname, '../..');
  const commands = [];

  // System commands
  const systemDir = path.join(projectRoot, '.claude', 'commands');
  if (fs.existsSync(systemDir)) {
    for (const file of fs.readdirSync(systemDir)) {
      if (file.endsWith('.md')) {
        commands.push({ path: path.join(systemDir, file), type: 'system' });
      }
    }
  }

  // Framework commands
  const fwRoot = path.join(projectRoot, 'frameworks');
  if (fs.existsSync(fwRoot)) {
    for (const service of fs.readdirSync(fwRoot)) {
      const serviceDir = path.join(fwRoot, service);
      if (!fs.statSync(serviceDir).isDirectory()) continue;
      for (const fw of fs.readdirSync(serviceDir)) {
        const cmdDir = path.join(serviceDir, fw, '.claude', 'commands');
        if (fs.existsSync(cmdDir) && fs.statSync(cmdDir).isDirectory()) {
          for (const file of fs.readdirSync(cmdDir)) {
            if (file.endsWith('.md')) {
              commands.push({ path: path.join(cmdDir, file), type: `framework:${service}/${fw}` });
            }
          }
        }
      }
    }
  }

  return commands;
}

// ─── Main ───────────────────────────────────────────────────────────────

if (runAll) {
  const commands = discoverCommands();
  let totalPass = 0;
  let totalFail = 0;
  let totalWarn = 0;
  const results = [];

  for (const cmd of commands) {
    const signal = verifyCommand(cmd.path);
    const projectRoot = path.resolve(__dirname, '../..');
    const scratchDir = path.join(projectRoot, '_dev', 'reports', 'signals');
    const cmdName = path.basename(cmd.path, '.md');
    const outputPath = path.join(scratchDir, `verify-command__${cmdName}.signal.json`);
    writeSignal(signal, outputPath);

    const verdict = signal.gate_decision.proceed ? (signal.summary.warnings > 0 ? 'WARN' : 'PASS') : 'FAIL';
    if (verdict === 'PASS') totalPass++;
    else if (verdict === 'WARN') totalWarn++;
    else totalFail++;

    results.push({ name: cmdName, type: cmd.type, verdict, checks: signal.summary });
  }

  if (jsonMode) {
    console.log(JSON.stringify({ commands: results, summary: { total: commands.length, pass: totalPass, warn: totalWarn, fail: totalFail } }, null, 2));
  } else {
    console.log(`\n── Command Verification Summary ──`);
    for (const r of results) {
      const icon = r.verdict === 'PASS' ? 'PASS' : r.verdict === 'WARN' ? 'WARN' : 'FAIL';
      console.log(`  ${icon}: ${r.name} (${r.type}) — ${r.checks.passed}/${r.checks.total} checks`);
    }
    console.log(`\n${totalPass + totalWarn}/${commands.length} commands passed (${totalFail} failed, ${totalWarn} warnings).`);
  }

  process.exit(totalFail > 0 ? 1 : 0);
} else {
  const cmdPath = args[0];
  const signal = verifyCommand(cmdPath);

  if (!printJsonOutput(signal)) {
    const projectRoot = path.resolve(__dirname, '../..');
    const scratchDir = path.join(projectRoot, '_dev', 'reports', 'signals');
    const cmdName = path.basename(path.resolve(cmdPath), '.md');
    const outputPath = path.join(scratchDir, `verify-command__${cmdName}.signal.json`);
    writeSignal(signal, outputPath);
    printSummary(signal);
    console.log(`\nSignal: ${outputPath}`);
  }

  process.exit(signal.gate_decision.proceed ? 0 : 1);
}
