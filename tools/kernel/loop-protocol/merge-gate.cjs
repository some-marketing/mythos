#!/usr/bin/env node
'use strict';
// merge-gate.cjs — PROMOTION merge-gate (capability-confinement, git-native).
//
// This is the "promotion = operator-gated merge" logic from the enforcement
// architecture. A loop principal owns only its own worktree/L0 draft surface;
// the canonical checkout is operator-owned. Promotion is a MERGE performed by
// the operator, and THIS gate is the review chokepoint on that merge.
//
// Given a set of changed paths, it classifies each via the SHARED policy module
// (the same classifier the advisory hook uses) and BLOCKS the merge (exit
// non-zero) if any changed path lands on a protected layer (L1 / L2 / floor) —
// i.e. touches governance, an exec-trust path, or a floor tripwire — UNLESS an
// operator override is presented (a marker file or --operator-confirm). Draft
// (L0) and granted-substrate (L0.5) changes pass.
//
// Change sources (pick one):
//   --paths a,b,c                       explicit comma list (testing / CI)
//   --base <ref> --head <ref>           git diff --name-only <base>..<head>
//   (positional paths)                  node merge-gate.cjs a b c
//
// Options:
//   --instance <id>       classify with a loop instance's grant (so its legit
//                         L0/L0.5 surface is recognized; physics still wins).
//   --operator-confirm    operator override — allow protected changes to merge.
//   --operator-marker <p> operator override iff file <p> exists.
//   --json                machine-readable result on stdout.
//
// Exit: 0 = merge may proceed; 1 = BLOCKED (protected paths without override);
//       2 = usage / internal error.

const fs = require('fs');
const { execFileSync } = require('child_process');
const policy = require('./policy');

function parseArgs(argv) {
  const out = { paths: [], positionals: [], instance: null, base: null, head: null,
    operatorConfirm: false, operatorMarker: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--paths') out.paths = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--instance') out.instance = argv[++i] || null;
    else if (a === '--base') out.base = argv[++i] || null;
    else if (a === '--head') out.head = argv[++i] || null;
    else if (a === '--operator-confirm') out.operatorConfirm = true;
    else if (a === '--operator-marker') out.operatorMarker = argv[++i] || null;
    else if (a === '--json') out.json = true;
    else if (a === '--') { while (++i < argv.length) out.positionals.push(argv[i]); }
    else if (a.startsWith('--')) throw new Error('unknown flag: ' + a);
    else out.positionals.push(a);
  }
  return out;
}

function gitDiffPaths(base, head) {
  const range = head ? base + '..' + head : base;
  const raw = execFileSync('git', ['diff', '--name-only', range], {
    cwd: policy.ROOT, encoding: 'utf8'
  });
  return raw.split('\n').map((s) => s.trim()).filter(Boolean);
}

// Pure: classify a list of paths, split into blocked vs allowed.
function evaluatePaths(manifest, paths, instanceId) {
  const results = paths.map((p) => {
    const cls = policy.classifyPath(manifest, { file_path: p, instanceId });
    return { path: p, layer: cls.layer, reason: cls.reason, protected: policy.isProtectedLayer(cls.layer) };
  });
  return { results, blocked: results.filter((r) => r.protected) };
}

function main(argv) {
  let args;
  try { args = parseArgs(argv); } catch (e) {
    process.stderr.write('merge-gate: ' + e.message + '\n');
    return 2;
  }

  let manifest;
  try { manifest = policy.loadManifest(); } catch (e) {
    process.stderr.write('merge-gate: cannot load manifest: ' + e.message + '\n');
    return 2;
  }

  let paths = [];
  if (args.paths.length) paths = args.paths;
  else if (args.base) {
    try { paths = gitDiffPaths(args.base, args.head); } catch (e) {
      process.stderr.write('merge-gate: git diff failed: ' + e.message + '\n');
      return 2;
    }
  } else if (args.positionals.length) paths = args.positionals;

  if (!paths.length) {
    process.stderr.write('merge-gate: no changed paths supplied (use --paths, --base/--head, or positionals)\n');
    return 2;
  }

  const { results, blocked } = evaluatePaths(manifest, paths, args.instance);

  const override = args.operatorConfirm ||
    (args.operatorMarker && fs.existsSync(args.operatorMarker));

  const decision = blocked.length === 0 ? 'PASS'
    : override ? 'PASS-OPERATOR-OVERRIDE' : 'BLOCK';
  const exit = decision === 'BLOCK' ? 1 : 0;

  if (args.json) {
    process.stdout.write(JSON.stringify({ decision, exit, instance: args.instance, results }, null, 2) + '\n');
  } else {
    for (const r of results) {
      process.stdout.write(
        (r.protected ? 'BLOCK ' : 'ok    ') + r.layer.padEnd(5) + ' ' + r.path + '  (' + r.reason + ')\n'
      );
    }
    if (decision === 'BLOCK') {
      process.stdout.write('\nMERGE BLOCKED — ' + blocked.length + ' protected path(s) changed. ' +
        'Operator promotion required (--operator-confirm or an operator-marker file).\n');
    } else if (decision === 'PASS-OPERATOR-OVERRIDE') {
      process.stdout.write('\nMERGE ALLOWED (OPERATOR-OVERRIDE) — operator override present (' + blocked.length + ' protected path(s) promoted).\n');
    } else {
      process.stdout.write('\nMERGE ALLOWED — no protected paths changed.\n');
    }
  }
  return exit;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { parseArgs, evaluatePaths, main };
