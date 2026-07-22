#!/usr/bin/env node
'use strict';

/**
 * launcher-stub.js — bare launch primitive from the harness-launcher pattern
 * described in README.md.
 *
 * This is a STUB, not a port of the private smos-launcher.js. It demonstrates
 * only the innermost primitive: given a command name (an external binary,
 * configurable — not hardcoded to any one CLI harness) and an argument list,
 * spawn it synchronously and capture stdout/stderr/exit code.
 *
 * No hook-lifecycle emulation, no managed-command registry, no session
 * state, no bridge dispatch — those all stay out of scope (see README.md).
 */

const { spawnSync } = require('child_process');

/**
 * Spawn an external binary with the given args and capture its output.
 *
 * @param {string} binary - Name or path of the external CLI to run (e.g.
 *   the operator's own harness binary — "codex", "gemini", or any other
 *   external tool). Never hardcoded by this stub.
 * @param {string[]} args - Argument list to pass to the binary.
 * @param {object} [opts]
 * @param {string} [opts.cwd] - Working directory for the spawned process.
 * @param {object} [opts.env] - Environment for the spawned process
 *   (defaults to inheriting process.env).
 * @param {string} [opts.input] - Optional stdin to feed the process.
 * @returns {{ exitCode: number, stdout: string, stderr: string }}
 */
function launch(binary, args, opts = {}) {
  if (!binary) throw new Error('launch requires a binary name');
  const spawned = spawnSync(binary, args || [], {
    cwd: opts.cwd || process.cwd(),
    env: opts.env || process.env,
    input: opts.input,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });

  if (spawned.error) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: spawned.error.message
    };
  }

  return {
    exitCode: spawned.status === null ? 1 : spawned.status,
    stdout: spawned.stdout || '',
    stderr: spawned.stderr || ''
  };
}

function main() {
  const [binary, ...args] = process.argv.slice(2);
  if (!binary) {
    process.stderr.write('Usage: node launcher-stub.js <binary> [args...]\n');
    process.exit(1);
  }
  const result = launch(binary, args);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}

module.exports = { launch };

if (require.main === module) {
  main();
}
