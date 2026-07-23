#!/usr/bin/env node
'use strict';

/**
 * phase-question-loop-cli.cjs — thin JSON CLI over phase-question-loop.js.
 *
 * The lib is authority-free bookkeeping for the v3 "until DRY" planning-phase
 * loop (see phase-question-loop.js header + the Loop Convergence Bounding Law v3).
 * This CLI is an equally authority-free surface: it initializes a loop, registers
 * open questions, records executed legs (the coordinator dispatches; this only
 * records), and reports status / terminal evaluation. It NEVER dispatches a leg,
 * closes an objection it did not have custody for, or arms anything — every
 * mutation goes through the lib's custody-enforcing writers.
 *
 * Every subcommand prints ONE JSON object to stdout and exits 0 on success; on
 * error it prints { ok:false, error } to stderr and exits 1 (2 for usage). The
 * terminal subcommands (status / evaluate) exit 0 regardless of the loop's
 * terminal_state — a truthful FAILURE_INCOMPLETE is a successful REPORT.
 *
 * Usage:
 *   node phase-question-loop-cli.cjs init --plan-id P --phase-id PH --defending-family F [--cap N]
 *   node phase-question-loop-cli.cjs init --plan-id P --phase-id PH --operator-gated-only [--cap N]
 *   node phase-question-loop-cli.cjs add-question (--instance I | --plan-id P --phase-id PH)
 *        --id Q1 --actor A --harness H --family F [--role R] [--summary S] [--operator-gated]
 *   node phase-question-loop-cli.cjs next-leg  --instance I
 *   node phase-question-loop-cli.cjs record-leg --instance I [--mind M] [--note N]
 *   node phase-question-loop-cli.cjs close-question --instance I --id Q1
 *        --actor A --harness H --family F [--role R] --signature SIG
 *   node phase-question-loop-cli.cjs status   --instance I
 *   node phase-question-loop-cli.cjs evaluate --instance I [--M n] [--operator-downgrade]
 *
 * `--instance` may always be given directly; init returns it, and any command
 * that accepts (--plan-id, --phase-id) derives the same deterministic instance id.
 */

const qloop = require('./phase-question-loop.js');

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      // boolean flags
      if (key === 'operator-gated' || key === 'operator-downgrade' || key === 'json' || key === 'operator-gated-only') {
        opts[key] = true;
      } else {
        opts[key] = argv[++i];
      }
    } else {
      opts._.push(a);
    }
  }
  return opts;
}

function out(obj) {
  process.stdout.write(JSON.stringify({ ok: true, ...obj }, null, 2) + '\n');
  return 0;
}

function fail(message, code) {
  process.stderr.write(JSON.stringify({ ok: false, error: message }, null, 2) + '\n');
  return typeof code === 'number' ? code : 1;
}

/** Resolve an instance id from --instance or (--plan-id, --phase-id). */
function resolveInstance(opts) {
  if (opts.instance) return opts.instance;
  if (opts['plan-id'] && opts['phase-id']) {
    return qloop.deriveInstance(opts['plan-id'], opts['phase-id']);
  }
  throw new Error('provide --instance, or both --plan-id and --phase-id');
}

/** Build a roster { actor, harness, family, role? } from flags. */
function who(opts) {
  return {
    actor: opts.actor,
    harness: opts.harness,
    family: opts.family,
    role: opts.role || undefined,
  };
}

const COMMANDS = {
  init(opts) {
    if (!opts['plan-id'] || !opts['phase-id']) {
      return fail('init requires --plan-id and --phase-id', 2);
    }
    const defendingFamily = opts['defending-family'];
    const operatorGatedOnly = opts['operator-gated-only'] === true;
    // Fail-closed at the CLI boundary, mirroring the lib's intake contract: a
    // question-accepting loop MUST declare its defending family (the coordinating
    // side that CANNOT hold an open question). An operator opts out explicitly with
    // --operator-gated-only, creating a loop where LOOP questions are refused and
    // only operator-gated questions route out to the operator.
    if (!defendingFamily && !operatorGatedOnly) {
      return fail(
        'init requires --defending-family <family> for a question-accepting loop ' +
          '(the coordinating/defending side that cannot be the custodian of an open question). ' +
          'Pass --operator-gated-only instead to create an operator-gated-only loop ' +
          '(loop questions are then refused fail-closed; only operator-gated questions route out).',
        2
      );
    }
    // Mirror the lib's symmetric identity invariants at the CLI boundary: a
    // confusable/empty --defending-family is a usage error (reject non-ASCII and
    // no-token anchors before init runs).
    const dfCheck = qloop.checkDefendingFamily(defendingFamily);
    if (!dfCheck.ok) {
      return fail(`init --defending-family invalid: ${dfCheck.reason}`, 2);
    }
    const cap = opts.cap !== undefined ? parseInt(opts.cap, 10) : undefined;
    const res = qloop.init({
      plan_id: opts['plan-id'],
      phase_id: opts['phase-id'],
      cap,
      defending_family: defendingFamily,
    });
    return out({ command: 'init', instance: res.instance, cap: res.cap, state: res.state });
  },

  'add-question': function addQuestion(opts) {
    const instance = resolveInstance(opts);
    if (!opts.id) return fail('add-question requires --id', 2);
    const res = qloop.addQuestion(instance, {
      id: opts.id,
      summary: opts.summary || '',
      raised_by: who(opts),
      operator_gated: opts['operator-gated'] === true,
    });
    return out({ command: 'add-question', instance, result: res });
  },

  'next-leg': function nextLeg(opts) {
    const instance = resolveInstance(opts);
    return out({ command: 'next-leg', instance, next_leg: qloop.nextLeg(instance) });
  },

  'record-leg': function recordLeg(opts) {
    const instance = resolveInstance(opts);
    const res = qloop.recordLeg(instance, { mind: opts.mind, note: opts.note });
    return out({ command: 'record-leg', instance, result: res });
  },

  'close-question': function closeQuestion(opts) {
    const instance = resolveInstance(opts);
    if (!opts.id) return fail('close-question requires --id', 2);
    if (!opts.signature) return fail('close-question requires --signature', 2);
    const res = qloop.closeQuestion(instance, opts.id, {
      closed_by: who(opts),
      close_signature: opts.signature,
    });
    return out({ command: 'close-question', instance, objection: res });
  },

  status(opts) {
    const instance = resolveInstance(opts);
    return out({ command: 'status', instance, status: qloop.status(instance) });
  },

  evaluate(opts) {
    const instance = resolveInstance(opts);
    const evalOpts = {};
    if (opts.M !== undefined) evalOpts.M = parseInt(opts.M, 10);
    if (opts['operator-downgrade'] === true) evalOpts.operatorDowngrade = true;
    return out({ command: 'evaluate', instance, evaluation: qloop.evaluate(instance, evalOpts) });
  },
};

function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(
      'phase-question-loop-cli: init | add-question | next-leg | record-leg | ' +
        'close-question | status | evaluate\n' +
        '\n' +
        'init requires --defending-family <family> (the coordinating/defending side that\n' +
        'cannot hold an open question) for any loop that will accept questions. To create\n' +
        'an operator-gated-only loop, pass --operator-gated-only: loop questions are then\n' +
        'refused fail-closed and only operator-gated questions route out to the operator.\n'
    );
    return command ? 0 : 2;
  }
  const handler = COMMANDS[command];
  if (!handler) return fail(`unknown command "${command}"`, 2);
  try {
    return handler(parseArgs(argv.slice(1)));
  } catch (err) {
    return fail(err.message);
  }
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { parseArgs, resolveInstance, COMMANDS };
