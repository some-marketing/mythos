#!/usr/bin/env node
'use strict';

/**
 * spawn-coordinator.cjs — fractal descent, structurally (concept:
 * spawn-coordinator-descent; operator correction 2026-06-12: the frontier
 * session coordinates, it does not build inline).
 *
 * Spawns a CHILD TERMINAL SESSION (claude -p headless by default; codex exec
 * supported) with a bounded contract. The child is a full coordinator — own
 * context window, own subagent budget — and reports back exclusively through
 * durable artifacts (Actor Continuity Contract): a closeout file at a path
 * this wrapper names in the contract, plus its commits and ledger entries.
 * The parent's cost is O(artifacts), never O(child-context).
 *
 * Contract carried to the child:
 *   - Current State / Question-Work / Desired State (continuity contract)
 *   - tier expectation (advisory, from tier-routing)
 *   - closeout path the child MUST write (_dev/state/spawned-coordinators/)
 *   - scoped-commit + test-exit-code disciplines
 *
 * Usage:
 *   node tools/sessions/spawn-coordinator.cjs \
 *     --task "<bounded work>" --scope <slug> [--mind claude|codex] \
 *     [--contract <file.md>] [--background]
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const STATE_DIR = path.join(PROJECT_ROOT, '_dev', 'state', 'spawned-coordinators');

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
}

function buildPrompt(opts, closeoutPath, route) {
  const contractBody = opts.contractFile
    ? fs.readFileSync(opts.contractFile, 'utf8')
    : opts.task;
  return [
    `You are a SPAWNED COORDINATOR session (repo: ${PROJECT_ROOT}).`,
    `Work in that repo. Advisory tier for this work: ${route.tier} (${route.justification}).`,
    '',
    '## Question / Work (bounded — do not expand scope)',
    contractBody,
    '',
    '## Contract (Actor Continuity)',
    '- Scoped commits only: files of THIS workstream, conventional message naming the scope.',
    '- Tests: run with captured exit codes (node --test > file; check $?) — never pipe-masked.',
    '- You may spawn your own subagents/children; your context is yours to budget.',
    `- MANDATORY closeout: write ${closeoutPath} as JSON {schema:"SpawnedCoordinatorCloseout/1.0", scope, resulting_state, commits:[], changed_files:[], tests:"<counts + exit code>", blockers:[], parent_impact}. The parent reads ONLY this file and your commits — your final message is not read.`,
    '- Do not touch instructions/canonical/, .claude/, tools/signals/, tests outside your scope, or any always-escalate surface; if the work requires it, STOP and record the blocker in the closeout.'
  ].join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : '';
  };
  const task = get('--task');
  const scope = get('--scope');
  const mind = get('--mind') || 'claude';
  const contractFile = get('--contract');
  if (!task && !contractFile) {
    process.stderr.write('Usage: spawn-coordinator.cjs --task "<work>" --scope <slug> [--mind claude|codex] [--contract file] [--background]\n');
    process.exit(2);
  }

  let route = { tier: 'scaffold', justification: 'default' };
  try {
    route = require('../signals/lib/tier-routing.cjs').routeTier({ task: task || fs.readFileSync(contractFile, 'utf8').slice(0, 500) });
  } catch { /* advisory only */ }

  fs.mkdirSync(STATE_DIR, { recursive: true });
  const id = `${stamp()}__${scope || 'unscoped'}`;
  const closeoutPath = path.join(STATE_DIR, `${id}.closeout.json`);
  const logPath = path.join(STATE_DIR, `${id}.log`);
  const prompt = buildPrompt({ task, contractFile }, closeoutPath, route);

  // Dispatch record BEFORE spawning (durable artifact precedes the actor).
  fs.writeFileSync(path.join(STATE_DIR, `${id}.dispatch.json`), JSON.stringify({
    schema: 'SpawnedCoordinatorDispatch/1.0',
    id, scope, mind, advisory_tier: route.tier,
    dispatched_at: new Date().toISOString(),
    closeout_expected: path.relative(PROJECT_ROOT, closeoutPath),
    task_preview: (task || contractFile).slice(0, 300)
  }, null, 2) + '\n');

  const cmd = mind === 'codex'
    ? { bin: 'codex', args: ['exec', '--cd', PROJECT_ROOT, '-'], stdin: prompt }
    : { bin: 'claude', args: ['-p', prompt, '--permission-mode', 'acceptEdits'], stdin: null };

  if (args.includes('--background')) {
    const out = fs.openSync(logPath, 'a');
    const child = spawn(cmd.bin, cmd.args, {
      cwd: PROJECT_ROOT, detached: true, stdio: [cmd.stdin ? 'pipe' : 'ignore', out, out]
    });
    if (cmd.stdin) { child.stdin.write(cmd.stdin); child.stdin.end(); }
    child.unref();
    process.stdout.write(`spawned ${mind} coordinator (pid ${child.pid}) scope=${scope}\n  closeout: ${path.relative(PROJECT_ROOT, closeoutPath)}\n  log: ${path.relative(PROJECT_ROOT, logPath)}\n`);
  } else {
    const res = spawnSync(cmd.bin, cmd.args, {
      cwd: PROJECT_ROOT, encoding: 'utf8',
      input: cmd.stdin || undefined, timeout: 1000 * 60 * 30
    });
    fs.writeFileSync(logPath, (res.stdout || '') + (res.stderr || ''));
    const done = fs.existsSync(closeoutPath);
    process.stdout.write(`coordinator exited ${res.status}; closeout ${done ? 'WRITTEN' : 'MISSING'}: ${path.relative(PROJECT_ROOT, closeoutPath)}\n`);
    process.exit(done ? 0 : 1);
  }
}

main();
