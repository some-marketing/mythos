#!/usr/bin/env node
'use strict';
//
// tools/security/vault-hygiene/move-to-automation.js
//
// THE MOVER. Relocates class-1 automation credentials into the `Automation`
// 1Password vault so the automation identity can be scoped to that one
// vault (shrinking the secret blast radius).
//
//   DRY-RUN BY DEFAULT. Prints the exact `op item move` commands it WOULD run.
//   Pass --apply to actually perform the moves.
//
// SAFETY (see lib.cjs for the enforced contract):
//   • Metadata only — NEVER reads/prints a secret value.
//   • Idempotent — items already in Automation are skipped.
//   • HARD-REFUSES to move any class-2 trust anchor (throws), even if the
//     manifest was edited to list one under class1_move.
//   • Never moves needs_classification or consolidate-flagged items.
//   • Verifies (metadata) an item is in its stated current_vault before moving;
//     if not found there, SKIPS + warns rather than guessing.
//
// Usage:
//   node tools/security/vault-hygiene/move-to-automation.js            # dry-run
//   node tools/security/vault-hygiene/move-to-automation.js --apply    # perform moves
//   node tools/security/vault-hygiene/move-to-automation.js --manifest <path>
//   node tools/security/vault-hygiene/move-to-automation.js --help
//
// Exit codes: 0 = plan/apply completed cleanly, 2 = a planned --apply move
// failed, 3 = hard-refusal (anchor in class1_move) or config error.
//
const path = require('node:path');
const {
  DESTINATION_VAULT,
  loadManifest,
  anchorTitleSet,
  itemExistsInVault,
  makeRealOpRunner,
  probeOpAvailable
} = require('./lib.cjs');

const DEFAULT_MANIFEST = path.join(__dirname, 'vault-manifest.json');

// ─── Pure planning core (unit-tested with an injected fake op runner) ────────

/**
 * Build the move plan. Performs metadata-only verification via opRunner.
 * THROWS if any class1_move title collides with a class-2 anchor title.
 *
 * @param {object} manifest
 * @param {(args:string[])=>string} opRunner  metadata-only op runner
 * @returns {{planned:Array, skipped:Array, needsDecision:Array}}
 */
function buildMovePlan(manifest, opRunner) {
  const anchors = anchorTitleSet(manifest);
  const planned = [];
  const skipped = [];
  const needsDecision = [];

  for (const entry of manifest.class1_move) {
    const title = entry.title;

    // Belt-and-suspenders hard refusal: a trust anchor must NEVER be a move
    // target, even if someone edited it into class1_move.
    if (anchors.has(title)) {
      throw new Error(
        `HARD REFUSAL: "${title}" is a class-2 trust anchor and must NEVER be moved into ${DESTINATION_VAULT}. ` +
        'Refusing the entire plan. Fix the manifest.'
      );
    }

    if (entry.needs_classification) {
      needsDecision.push({ title, reason: 'needs_classification — operator must classify before any move', entry });
      continue;
    }
    if (entry.consolidate || entry.action === 'consolidate') {
      needsDecision.push({
        title,
        reason: `consolidate — a duplicate (${entry.duplicate_of || 'existing item'}) already exists in ${DESTINATION_VAULT}; do not blind-move`,
        entry
      });
      continue;
    }

    // Idempotency: already in Automation → skip.
    const inDest = itemExistsInVault(opRunner, title, DESTINATION_VAULT);
    if (inDest.exists) {
      skipped.push({ title, reason: `already in ${DESTINATION_VAULT}`, entry });
      continue;
    }

    // Verify it is actually in its stated source vault before moving.
    const inSrc = itemExistsInVault(opRunner, title, entry.current_vault);
    if (!inSrc.exists) {
      skipped.push({
        title,
        reason: `NOT FOUND in stated current_vault "${entry.current_vault}" — refusing to guess`,
        warn: true,
        entry
      });
      continue;
    }

    planned.push({
      title,
      current_vault: entry.current_vault,
      command: ['item', 'move', title, '--current-vault', entry.current_vault, '--destination-vault', DESTINATION_VAULT],
      entry
    });
  }

  return { planned, skipped, needsDecision };
}

/** Render an op argv as a copy-pasteable shell command (metadata only). */
function renderOpCommand(args) {
  return 'op ' + args.map((a) => (/[\s"]/.test(a) ? JSON.stringify(a) : a)).join(' ');
}

// ─── CLI ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { apply: false, manifest: DEFAULT_MANIFEST, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') opts.apply = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--manifest') opts.manifest = path.resolve(argv[++i]);
    else if (a.startsWith('--manifest=')) opts.manifest = path.resolve(a.slice('--manifest='.length));
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

const HELP = `move-to-automation.js — relocate class-1 automation credentials into the "${DESTINATION_VAULT}" 1Password vault.

  DRY-RUN BY DEFAULT. Nothing is moved without --apply.

Usage:
  node tools/security/vault-hygiene/move-to-automation.js [--apply] [--manifest <path>]

Options:
  --apply             Actually run the planned \`op item move\` commands.
                      (Omit to only print what WOULD run.)
  --manifest <path>   Manifest to read (default: ./vault-manifest.json).
  -h, --help          Show this help.

Safety:
  • Metadata only — never reads or prints a secret value.
  • Idempotent — items already in ${DESTINATION_VAULT} are skipped.
  • Hard-refuses to move any class-2 trust anchor.
  • Skips needs_classification and consolidate-flagged items (reports them as
    "needs operator decision").
  • Verifies each item exists in its stated current_vault before moving.

OPERATOR: verify vault-manifest.json against live 1Password before --apply.`;

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    console.error('\n' + HELP);
    process.exit(3);
  }
  if (opts.help) {
    console.log(HELP);
    process.exit(0);
  }

  let manifest;
  try {
    manifest = loadManifest(opts.manifest);
  } catch (err) {
    console.error(`Failed to load manifest: ${err.message}`);
    process.exit(3);
  }

  const opRunner = makeRealOpRunner();

  if (!probeOpAvailable(opRunner)) {
    console.error(
      '\n✖ `op` is not reachable/authenticated in this shell — cannot verify item placement.\n' +
      '  Run this from an operator terminal with an unlocked 1Password CLI (or OP_SERVICE_ACCOUNT_TOKEN set).\n'
    );
    process.exit(3);
  }

  let plan;
  try {
    plan = buildMovePlan(manifest, opRunner);
  } catch (err) {
    console.error(`\n✖ ${err.message}\n`);
    process.exit(3);
  }

  const mode = opts.apply ? 'APPLY' : 'DRY-RUN';
  console.log(`\n=== vault-hygiene mover [${mode}] → destination vault: ${DESTINATION_VAULT} ===`);
  console.log(`Manifest: ${opts.manifest}`);
  if (!opts.apply) {
    console.log('(dry-run — no items will be moved; pass --apply to perform)\n');
  } else {
    console.log('');
  }

  // Planned moves.
  const moved = [];
  const moveFailed = [];
  if (plan.planned.length === 0) {
    console.log('No moves planned.');
  } else {
    for (const p of plan.planned) {
      const cmd = renderOpCommand(p.command);
      if (!opts.apply) {
        console.log(`  WOULD MOVE  ${p.title}  (${p.current_vault} → ${DESTINATION_VAULT})`);
        console.log(`              ${cmd}`);
      } else {
        process.stdout.write(`  MOVING      ${p.title}  (${p.current_vault} → ${DESTINATION_VAULT}) ... `);
        try {
          opRunner(p.command);
          console.log('done');
          moved.push(p.title);
        } catch (err) {
          console.log('FAILED');
          console.error(`              ${err.message.split('\n')[0]}`);
          moveFailed.push({ title: p.title, error: err.message.split('\n')[0] });
        }
      }
    }
  }

  // Skips.
  if (plan.skipped.length) {
    console.log('\n  Skipped:');
    for (const s of plan.skipped) {
      console.log(`    ${s.warn ? 'WARN ' : 'skip '} ${s.title} — ${s.reason}`);
    }
  }

  // Needs operator decision.
  if (plan.needsDecision.length) {
    console.log('\n  Needs operator decision (NOT moved):');
    for (const d of plan.needsDecision) {
      console.log(`    DECIDE ${d.title} — ${d.reason}`);
    }
  }

  // Summary.
  console.log('\n--- summary ---');
  if (opts.apply) {
    console.log(`  moved:                 ${moved.length}`);
    if (moveFailed.length) console.log(`  FAILED:                ${moveFailed.length}`);
  } else {
    console.log(`  would move:            ${plan.planned.length}`);
  }
  console.log(`  skipped:               ${plan.skipped.length}`);
  console.log(`  needs operator decision: ${plan.needsDecision.length}`);
  console.log('');

  process.exit(moveFailed.length ? 2 : 0);
}

if (require.main === module) {
  main();
}

module.exports = { buildMovePlan, renderOpCommand, parseArgs };
