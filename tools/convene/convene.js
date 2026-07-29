#!/usr/bin/env node
// tools/convene/convene.js
//
// Convene a triadic profile on a single task. The invoking harness is the
// origin slot/actor; this runner fans prompts out to the other slots in
// parallel, collects responses, and writes a synthesis skeleton for the origin
// slot/actor to complete.

'use strict';

const fs = require('fs');
const path = require('path');

const { REPO_ROOT, resolveAdapter } = require('./lib/adapters');
const { listProfiles, resolveTriad } = require('./lib/profiles');
const { buildPrompts } = require('./lib/prompt');
const { spawnSlot } = require('./lib/run');
const { writeArtifacts } = require('./lib/artifacts');

const ARTIFACT_ROOT = path.join(REPO_ROOT, '_dev', 'reports', 'analysis', 'convene-runs');

function parseArgs(argv) {
  const args = {
    task: null,
    scope: null,
    origin: process.env.MYTHOS_CONVENE_ORIGIN || 'local-qwen',
    profile: process.env.MYTHOS_CONVENE_PROFILE || 'local-council',
    contextFiles: [],
    actorOverrides: [],
    timeoutSeconds: 180,
    only: null,
    dryRun: false,
    listProfiles: false,
    help: false,
    localOnly: process.env.MYTHOS_CONVENE_ALLOW_FRONTIER === '1' ? false : true,
    riskTier: null,
    taskShape: null,
    scopeTier: null
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    if (a === '--dry-run') { args.dryRun = true; continue; }
    if (a === '--list-profiles') { args.listProfiles = true; continue; }
    if (a === '--allow-frontier') { args.localOnly = false; continue; }
    if (a === '--local-only') { args.localOnly = true; continue; }
    if (a === '--task') { args.task = argv[++i]; continue; }
    if (a === '--scope') { args.scope = argv[++i]; continue; }
    if (a === '--origin') { args.origin = String(argv[++i] || '').trim().toLowerCase(); continue; }
    if (a === '--profile') { args.profile = String(argv[++i] || '').trim().toLowerCase(); continue; }
    if (a === '--context') { args.contextFiles.push(argv[++i]); continue; }
    if (a === '--timeout') { args.timeoutSeconds = parseInt(argv[++i], 10) || 180; continue; }
    if (a === '--only') { args.only = String(argv[++i] || '').trim().toLowerCase(); continue; }
    if (a === '--actor') { args.actorOverrides.push(argv[++i]); continue; }
    if (a === '--risk-tier') { args.riskTier = String(argv[++i] || '').trim().toLowerCase(); continue; }
    if (a === '--task-shape') { args.taskShape = String(argv[++i] || '').trim().toLowerCase(); continue; }
    if (a === '--scope-tier') { args.scopeTier = String(argv[++i] || '').trim().toLowerCase(); continue; }
  }

  return args;
}

function printHelp() {
  process.stdout.write(`tools/convene/convene.js — convene a triad

Usage:
  node tools/convene/convene.js --task "<task text>" --scope "<scope>" [options]

Required:
  --task <text>           Prompt to send to participant slots
  --scope <slug>          Short name for artifact directory

Options:
  --origin <slot|actor>   Invoking slot or actor (default local-qwen)
  --profile <id>          Triad profile: local-council, kernel, code-review, local-leaf (default local-council)
  --actor <slot=actor>    Override actor for a slot. Repeatable.
  --context <file>        File to include as shared context (repeatable)
  --timeout <seconds>     Per-slot timeout in seconds (default 180)
  --only <slot|actor>     Only call one participant slot or actor
  --dry-run               Print prompts without calling participant slots
  --list-profiles         Show available triad profiles
  --local-only            Block frontier/cloud actors (default)
  --allow-frontier        Permit Claude/Codex/Gemini/OpenRouter actors for this run
  --risk-tier <tier>      Risk tier for model-tiering (high|low)
  --task-shape <shape>    Complexity shape (deliberation|mechanical|verify-local)
  --scope-tier <tier>     Scope tier (system|client|project|task|leaf)
  --help                  Show this message

Examples:
  node tools/convene/convene.js --task "review this plan" --scope plan-review
  node tools/convene/convene.js --profile local-council --origin local-qwen --task "review this patch" --scope patch-review
  node tools/convene/convene.js --allow-frontier --profile kernel --actor now=codex --actor omega=gemini --task "..." --scope ...

Artifacts land in: _dev/reports/analysis/convene-runs/<timestamp>-<scope>/
`);
}

function printProfiles() {
  for (const profile of listProfiles()) {
    process.stdout.write(`${profile.id}: ${profile.label}\n`);
    process.stdout.write(`  ${profile.description}\n`);
    process.stdout.write(`  consequence_grade: ${profile.consequence_grade ? 'yes' : 'no'}\n`);
    for (const slot of profile.slots) {
      process.stdout.write(`  - ${slot.id}/${slot.default_actor}: ${slot.function}\n`);
    }
    process.stdout.write('\n');
  }
}

function ts() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function slug(s) {
  return String(s || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function resolveOrigin(triad, origin) {
  const normalized = String(origin || '').trim().toLowerCase();
  const bySlot = triad.slots.find((s) => s.id === normalized);
  if (bySlot) return bySlot;

  const actorMatches = triad.slots.filter((s) => s.actor === normalized);
  if (actorMatches.length > 1) {
    throw new Error(`Ambiguous --origin "${origin}": actor is assigned to multiple slots (${actorMatches.map((s) => s.id).join(', ')}). Use a slot id instead.`);
  }
  const slot = actorMatches[0];
  if (!slot) {
    throw new Error(`Invalid --origin "${origin}". Expected a slot or actor from profile ${triad.id}: ${triad.slots.map((s) => `${s.id}/${s.actor}`).join(', ')}`);
  }
  return slot;
}

function participantSlots(args, triad) {
  const originSlot = resolveOrigin(triad, args.origin);
  triad.slots = triad.slots.map((slot) => ({
    ...slot,
    is_origin: slot.id === originSlot.id
  }));

  const participants = triad.slots.filter((slot) => slot.id !== originSlot.id);
  if (!args.only) return participants;

  const only = String(args.only || '').trim().toLowerCase();
  const match = participants.find((slot) => slot.id === only || slot.actor === only);
  if (!match) {
    throw new Error(`Invalid --only "${args.only}". Expected one non-origin slot or actor: ${participants.map((s) => `${s.id}/${s.actor}`).join(', ')}`);
  }
  return [match];
}

function applyRuntimeOptions(args, triad) {
  triad.local_only = Boolean(args.localOnly);
  triad.slots = triad.slots.map((slot) => ({
    ...slot,
    local_only: Boolean(args.localOnly),
    risk_tier: args.riskTier || (triad.consequence_grade ? 'high' : 'low'),
    task_shape: args.taskShape || 'deliberation',
    scope_tier: args.scopeTier || 'system'
  }));
}

function validateRunnableParticipants(participants) {
  for (const slot of participants) {
    resolveAdapter(slot.actor, slot);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printHelp(); process.exit(0); }
  if (args.listProfiles) { printProfiles(); process.exit(0); }

  if (!args.task || !args.scope) {
    process.stderr.write('ERROR: --task and --scope are required. Use --help for usage.\n');
    process.exit(2);
  }

  const triad = resolveTriad(args);
  applyRuntimeOptions(args, triad);
  const participants = participantSlots(args, triad);
  const scopeSlug = slug(args.scope);
  const outDir = path.join(ARTIFACT_ROOT, `${ts()}-${scopeSlug}`);
  const prompts = buildPrompts(args, triad, participants);

  if (args.dryRun) {
    validateRunnableParticipants(participants);
    process.stdout.write(`=== DRY RUN — profile ${triad.id}; participant slots: ${participants.map((slot) => `${slot.id}/${slot.actor}`).join(', ')} ===\n\n`);
    process.stdout.write(`local_only: ${triad.local_only ? 'yes' : 'no'}\n\n`);
    for (const slot of participants) {
      process.stdout.write(`--- Prompt for ${slot.id}/${slot.actor} ---\n\n`);
      process.stdout.write(prompts[slot.id] + '\n\n');
    }
    process.stdout.write(`=== Output directory that would be created ===\n${outDir}\n`);
    if (triad.duplicate_actors.length > 0) {
      process.stdout.write(`WARNING: duplicate actor assignments: ${triad.duplicate_actors.join(', ')}. This is not distinct-intelligence consensus.\n`);
    }
    process.exit(0);
  }

  validateRunnableParticipants(participants);

  fs.mkdirSync(outDir, { recursive: true });
  process.stdout.write(`Convening triad on scope "${args.scope}"\n`);
  process.stdout.write(`Profile: ${triad.id} (${triad.label})\n`);
  process.stdout.write(`Local-only routing: ${triad.local_only ? 'yes' : 'no'}\n`);
  process.stdout.write(`Origin: ${args.origin}\n`);
  process.stdout.write(`Participant slots: ${participants.map((slot) => `${slot.id}/${slot.actor}`).join(', ')}\n`);
  if (triad.duplicate_actors.length > 0) {
    process.stdout.write(`WARNING: duplicate actor assignments: ${triad.duplicate_actors.join(', ')}. This is not distinct-intelligence consensus.\n`);
  }
  process.stdout.write(`Output directory: ${outDir}\n`);
  process.stdout.write('Firing participant slots in parallel...\n');

  const resultPairs = await Promise.all(participants.map(async (slot) => {
    return [slot.id, await spawnSlot(slot, prompts[slot.id], args.timeoutSeconds)];
  }));
  const results = {};
  for (const [slotId, result] of resultPairs) {
    results[slotId] = result;
  }

  writeArtifacts(outDir, args, triad, prompts, results, participants);

  process.stdout.write('\n=== Results ===\n');
  for (const slot of participants) {
    const result = results[slot.id];
    process.stdout.write(`${slot.label}/${slot.actor}: ${result.status} (${result.duration_ms}ms${result.error ? ', ' + result.error : ''})\n`);
  }
  process.stdout.write(`\nArtifacts: ${outDir}\n`);
  process.stdout.write('  prompt.md              — shared prompt preview\n');
  process.stdout.write('  prompts/               — per-slot prompt artifacts\n');
  for (const slot of participants) {
    process.stdout.write(`  ${slot.id}__${slot.actor}.md${' '.repeat(Math.max(1, 20 - slot.id.length - slot.actor.length))}— slot response + metadata\n`);
  }
  process.stdout.write('  synthesis-skeleton.md  — template for the origin slot/actor to fill in\n');
  process.stdout.write('  manifest.json          — structured run record\n');

  const calledResults = participants.map((slot) => results[slot.id]).filter(Boolean);
  const successCount = calledResults.filter((r) => r && r.status === 'success').length;
  process.exit(successCount === calledResults.length ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`convene.js FATAL: ${err.message}\n`);
    process.stderr.write(err.stack + '\n');
    process.exit(99);
  });
}

module.exports = {
  main,
  applyRuntimeOptions,
  parseArgs,
  participantSlots,
  resolveOrigin,
  validateRunnableParticipants
};
