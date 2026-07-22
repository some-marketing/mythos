'use strict';

const { spawn } = require('child_process');

const { resolveAdapter } = require('./adapters');

/**
 * spawnSlot — run one convene slot to completion.
 *
 * Two dispatch modes:
 *   1. Subprocess mode (default): spawn adapter.command with adapter.argv,
 *      write the prompt to its stdin, capture stdout as the response.
 *   2. Manual mode (adapter.manual === true): no subprocess is spawned. The
 *      prompt is already written to prompts/<slot>__<actor>.md by
 *      writeArtifacts (lib/artifacts.js) regardless of dispatch mode, so this
 *      just returns a 'manual' status pointing the operator at that file and
 *      at the reply file they should create alongside it.
 */
function spawnSlot(slot, promptText, timeoutSeconds) {
  const adapter = resolveAdapter(slot.actor, slot);
  slot.pinned_model = adapter.pinned_model;

  if (adapter.manual) {
    return Promise.resolve({
      slot_id: slot.id,
      slot_label: slot.label,
      slot_function: slot.function,
      actor: slot.actor,
      status: 'manual',
      output: '',
      error: `Manual dispatch — paste prompts/${slot.id}__${slot.actor}.md into ${slot.actor} and save the reply over ${slot.id}__${slot.actor}.md in the same run directory.`,
      duration_ms: 0,
      exit_code: null,
      timed_out: false
    });
  }

  return new Promise((resolve) => {
    const started = Date.now();
    const result = {
      slot_id: slot.id,
      slot_label: slot.label,
      slot_function: slot.function,
      actor: slot.actor,
      status: 'unknown',
      output: '',
      error: null,
      duration_ms: 0,
      exit_code: null,
      timed_out: false
    };
    let stdout = '';
    let stderr = '';
    const spawnEnv = adapter.env ? { ...process.env, ...adapter.env } : { ...process.env };
    const child = spawn(adapter.command, adapter.argv, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: spawnEnv,
      cwd: adapter.cwd
    });
    const timer = setTimeout(() => {
      result.timed_out = true;
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    }, timeoutSeconds * 1000);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

    child.on('error', (err) => {
      clearTimeout(timer);
      result.status = 'error';
      result.error = err.message;
      result.duration_ms = Date.now() - started;
      resolve(result);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      result.exit_code = code;
      result.duration_ms = Date.now() - started;
      result.output = stdout;
      if (result.timed_out) {
        result.status = 'timeout';
        result.error = `slot exceeded ${timeoutSeconds}s timeout`;
      } else if (code === 0 && stdout.trim().length > 0) {
        result.status = 'success';
      } else if (code === 0) {
        result.status = 'empty';
        result.error = 'exit 0 but no stdout';
      } else {
        result.status = 'failed';
        result.error = `exit code ${code}${stderr ? ': ' + stderr.trim().slice(0, 500) : ''}`;
      }
      resolve(result);
    });

    try {
      child.stdin.write(promptText);
      child.stdin.end();
    } catch (err) {
      clearTimeout(timer);
      result.status = 'error';
      result.error = 'stdin write failed: ' + err.message;
      resolve(result);
    }
  });
}

module.exports = {
  spawnSlot
};
