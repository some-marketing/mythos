#!/usr/bin/env node
'use strict';

/**
 * ledger-ratchet.cjs — W3 — OPERATOR-ONLY CLI to perform a legitimate
 * down-layer (L1 -> L0/L0.5) reclassification.
 *
 * Loop-protocol law candidate §2: "Down-layer reclassification is a fail->pass
 * ratchet event (L1 -> L0/L0.5 needs an operator)." This tool writes a SIGNED
 * `reclassify` entry into the per-instance ledger. Without such an entry, a
 * down-layer change MUST be treated as a ratchet VIOLATION by consumers (the
 * PreToolUse hook BLOCKs).
 *
 * The --operator-confirm flag stands in for the human gate: this tool REFUSES
 * to run without it. No secrets are ever passed in argv — `--reason` and
 * `--operator` are provenance strings, not credentials; the "signature" is a
 * non-secret content digest binding the entry fields together.
 *
 * Usage:
 *   node ledger-ratchet.cjs \
 *     --instance <id> --path <repo-relative-path> \
 *     --from <L1> --to <L0|L0.5> \
 *     --reason "<why this down-layer is legitimate>" \
 *     [--operator <name>] \
 *     --operator-confirm
 *
 * Exit codes: 0 = reclassify entry written; non-zero = refused / invalid.
 */

const crypto = require('crypto');
const ledger = require('./ledger.js');

const LAYER_RANK = { L0: 0, 'L0.5': 1, L1: 2, L2: 3 };

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) continue;
    const key = tok.slice(2);
    if (key === 'operator-confirm') {
      args[key] = true;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true; // bare flag
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function fail(msg) {
  process.stderr.write(`ledger-ratchet: REFUSED — ${msg}\n`);
  process.exit(1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  // The human gate: refuse without explicit confirmation.
  if (args['operator-confirm'] !== true) {
    fail('missing --operator-confirm (operator gate). No reclassify entry written.');
  }

  const instance = args.instance;
  const targetPath = args.path;
  const from = args.from;
  const to = args.to;
  const reason = args.reason;
  const operator = args.operator || process.env.MYTHOS_OPERATOR || 'operator';

  if (!instance || instance === true) fail('--instance <id> is required');
  if (!targetPath || targetPath === true) fail('--path <repo-relative-path> is required');
  if (!from || from === true) fail('--from <layer> is required');
  if (!to || to === true) fail('--to <layer> is required');
  if (!reason || reason === true) {
    fail('--reason "<justification>" is required (a signed reclassify needs a recorded reason)');
  }

  if (!(from in LAYER_RANK)) fail(`--from has unknown layer "${from}"`);
  if (!(to in LAYER_RANK)) fail(`--to has unknown layer "${to}"`);

  // This tool ONLY performs DOWN-layer moves (the ratchet-guarded direction).
  if (LAYER_RANK[to] >= LAYER_RANK[from]) {
    fail(
      `not a down-layer reclassification (from=${from} to=${to}). ` +
        'Up-layer / same-layer tightening does not require the operator ratchet tool.'
    );
  }
  // The down-layer target must be an autonomous tier.
  if (to !== 'L0' && to !== 'L0.5') {
    fail(`--to must be L0 or L0.5 for a down-layer reclassification, got ${to}`);
  }

  const ts = new Date().toISOString();
  const reclassify = { from, to, operator, reason, confirmed: true };

  // Non-secret content digest binding the entry fields — provenance, not a credential.
  const signature =
    'sha256:' +
    crypto
      .createHash('sha256')
      .update([instance, targetPath, from, to, operator, reason, ts].join('\n'))
      .digest('hex');

  const entry = ledger.append(instance, {
    path: targetPath,
    layer: to,
    classified_by: {
      actor: operator,
      harness: 'ledger-ratchet.cjs',
      family: 'operator',
    },
    ts,
    change_ref: args['change-ref'] || null,
    kind: 'reclassify',
    reclassify,
    signature,
  });

  process.stdout.write(
    `ledger-ratchet: OK — signed reclassify written for instance="${instance}" ` +
      `path="${targetPath}" ${from} -> ${to}\n`
  );
  process.stdout.write(JSON.stringify(entry, null, 2) + '\n');
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, LAYER_RANK };
