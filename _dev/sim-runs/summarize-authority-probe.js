#!/usr/bin/env node
'use strict';

// _dev/sim-runs/summarize-authority-probe.js — read-only analysis of an
// authority-probe run. Writes nothing.
//
// ANALYSIS CONTRACT (set after the Codex review of the overnight results):
//
//  1. EPISODE-CLUSTERED INFERENCE ONLY. The replicates inside one episode
//     derive their seeds as deterministic offsets from a single base, so
//     they are not demonstrably independent. Treating all replicate-pairs as
//     independent overstates precision and can manufacture significance out
//     of a negligible difference. Every interval here is therefore computed
//     over EPISODES: the paired difference is averaged within an episode
//     first, and the episode is the unit of analysis.
//  2. COMPLETE EPISODES ONLY. A partial final episode is excluded outright
//     rather than treated as an equal endpoint.
//  3. STARVATION IS A THRESHOLD-CROSSING COUNT, never deaths, mortality, or
//     survival. One hive can cross repeatedly.
//  4. NO EQUIVALENCE CLAIMS. Absent a pre-specified equivalence margin, a
//     wide interval spanning zero supports "no practically material
//     difference detected at this sample size" -- never "indistinguishable"
//     or "the same".
//
// THE COMPARISONS THAT MATTER. Injection versus information comes first: if
// a random-tip null reproduces a carriage arm's effect, that effect was never
// about carrying information. Only then does the authority question mean
// anything, and it is asked as distortion BEYOND the matched null.
//
// Usage: node _dev/sim-runs/summarize-authority-probe.js [--root <dir>]

const fs = require('fs');
const path = require('path');

function argVal(flag, def) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ROOT = path.resolve(argVal('--root', path.join(REPO_ROOT, '_dev', 'state', 'ant-sim-authority-probe')));

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean); // a torn trailing line from a crash is dropped, not fatal
}

const events = readJsonl(path.join(ROOT, 'events.jsonl'));
const start = events.find((e) => e.event === 'run-start');
const stopped = events.find((e) => e.event === 'run-stopped');
const failed = events.find((e) => e.event === 'fail-closed-stop');
const rounds = start ? start.episode_rounds : null;

// Contract rule 2. Episodes that did not reach the full round budget are
// dropped entirely, not down-weighted.
const allFinals = readJsonl(path.join(ROOT, 'metrics.jsonl')).filter((r) => r.final);
const finals = allFinals.filter((r) => rounds === null || r.round === rounds);
const droppedEpisodes = new Set(allFinals.filter((r) => rounds !== null && r.round !== rounds).map((r) => r.episode));

const HEADLINE = ['cum_reward', 'starve_crossings', 'applied_rate', 'builds', 'structures', 'territory', 'mean_entropy'];
const PER_WORLD = ['cum_reward', 'starve_crossings', 'builds', 'structures', 'territory', 'world_food'];

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
function stdev(xs) {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}
const fmt = (x) => (Number.isFinite(x) ? x.toFixed(3) : 'n/a');

// Contract rule 1. `values` is one number per episode; the interval is over
// episodes, so the effective sample size is the episode count, not the
// replicate count.
function clustered(values) {
  const n = values.length;
  const m = mean(values);
  const s = 1.96 * (stdev(values) / Math.sqrt(n));
  return { n, m, lo: m - s, hi: m + s, str: `${fmt(m)} 95%~[${fmt(m - s)}, ${fmt(m + s)}] (episodes=${n})` };
}

const byArm = {};
for (const row of finals) (byArm[row.arm] = byArm[row.arm] || []).push(row);
const arms = start ? start.arms.filter((a) => byArm[a]) : Object.keys(byArm);

process.stdout.write(`authority-probe summary — ${ROOT}\n`);
if (start) {
  process.stdout.write(`started ${start.ts} pid=${start.pid} revision=${start.revision || 1} episode_rounds=${start.episode_rounds} replicates=${start.replicates}\n`);
  process.stdout.write(`selection rule: ${start.selection_rule_declared || '(not declared)'}\n`);
}
process.stdout.write(stopped ? `stopped ${stopped.ts} reason=${stopped.reason} episodes=${stopped.episodes_completed}\n`
  : failed ? `FAIL-CLOSED ${failed.ts}: ${failed.error}\n`
    : 'still running (no stop event yet)\n');
const episodeCount = new Set(finals.map((r) => r.episode)).size;
process.stdout.write(`complete episodes: ${episodeCount}; rows: ${finals.length}`);
if (droppedEpisodes.size) process.stdout.write(`; EXCLUDED partial episode(s): ${[...droppedEpisodes].join(', ')}`);
process.stdout.write('\n\n');

// --- per-arm descriptive ----------------------------------------------------

process.stdout.write('=== per-arm two-world totals (descriptive) ===\n');
process.stdout.write('starve_crossings = positive-to-zero stockpile threshold crossings, not deaths.\n\n');
for (const arm of arms) {
  const rows = byArm[arm];
  const spec = rows[0].spec;
  process.stdout.write(`${arm} (n=${rows.length} rows)  ${spec ? JSON.stringify(spec) : 'no relay'}\n`);
  for (const key of HEADLINE) {
    const xs = rows.map((r) => r[key]).filter(Number.isFinite);
    process.stdout.write(`  ${key.padEnd(17)} mean=${fmt(mean(xs))} sd=${fmt(stdev(xs))}\n`);
  }
  const offered = rows.map((r) => r.relay && r.relay.tips_offered).filter(Number.isFinite);
  if (mean(offered) > 0) {
    const d = mean(rows.map((r) => r.relay.tips_delivered));
    process.stdout.write(`  relay             offered=${fmt(mean(offered))} delivered=${fmt(d)} suppressed=${fmt(mean(rows.map((r) => r.relay.tips_suppressed)))} no_op=${fmt(mean(rows.map((r) => r.relay.no_op)))}\n`);
    process.stdout.write(`  relay             capped_share=${fmt(mean(rows.map((r) => r.relay.capped)) / d)} delivered_actionable=${fmt(mean(rows.map((r) => r.relay.actionable)) / d)}\n`);
  }
  process.stdout.write('\n');
}

// --- clustered paired comparison -------------------------------------------

const keyOf = (r) => `${r.episode}:${r.replicate}`;

// Average the replicate-level paired differences within each episode, then
// return one value per episode.
function episodeDiffs(armRows, ctrlMap, valueFn) {
  const byEpisode = new Map();
  for (const a of armRows) {
    const c = ctrlMap.get(keyOf(a));
    if (!c) continue;
    const v = valueFn(a, c);
    if (!Number.isFinite(v)) continue;
    if (!byEpisode.has(a.episode)) byEpisode.set(a.episode, []);
    byEpisode.get(a.episode).push(v);
  }
  return [...byEpisode.values()].map(mean);
}

function compare(label, armName, ctrlName) {
  if (!byArm[armName] || !byArm[ctrlName]) return;
  const ctrlMap = new Map(byArm[ctrlName].map((r) => [keyOf(r), r]));
  process.stdout.write(`${label}: ${armName} minus ${ctrlName}\n`);
  process.stdout.write('  -- two-world totals --\n');
  for (const key of HEADLINE) {
    const d = episodeDiffs(byArm[armName], ctrlMap, (a, c) => a[key] - c[key]);
    if (d.length) process.stdout.write(`  ${key.padEnd(17)} ${clustered(d).str}\n`);
  }
  process.stdout.write('  -- signed cross-world gap (world0 - world1), shift vs control --\n');
  for (const key of PER_WORLD) {
    const d = episodeDiffs(byArm[armName], ctrlMap,
      (a, c) => (a.worlds[0][key] - a.worlds[1][key]) - (c.worlds[0][key] - c.worlds[1][key]));
    if (d.length) process.stdout.write(`  ${key.padEnd(17)} ${clustered(d).str}\n`);
  }
  process.stdout.write('\n');
}

process.stdout.write('=== Q1: INJECTION OR INFORMATION? ===\n');
process.stdout.write('If a random-tip null reproduces a carriage arm vs isolated, the effect was\n');
process.stdout.write('never about carrying information. Read these before anything else.\n\n');
compare('overnight relay vs no relay', 'carriage-add', 'isolated');
compare('random-tip null vs no relay', 'null-add', 'isolated');
compare('information content only (additive family)', 'carriage-add', 'null-add');
compare('purer carriage vs no relay', 'carriage-max', 'isolated');
compare('random-tip null vs no relay (non-additive)', 'null-max', 'isolated');
compare('information content only (non-additive family)', 'carriage-max', 'null-max');

process.stdout.write('=== Q2: DOES ADDITIVITY DRIVE IT? ===\n\n');
compare('additive vs non-additive, same selection', 'carriage-add', 'carriage-max');

// Q1b completes the 2x2 that Q1 alone cannot: carriage-add is BOTH informative
// and consistent, so a null that randomizes both at once cannot say which one
// matters. fixed-add is consistent but provably uninformative (one arbitrary
// tile per episode, drawn uniformly at random at the first eligible relay and
// never updated — uninformative by randomness, not by emptiness); filter-add is informative
// but inconsistent. If fixed-add reproduces carriage-add, the mechanism is
// compounding, not information.
if (byArm['fixed-add']) {
  process.stdout.write('=== Q1b: CONSISTENCY OR INFORMATION? ===\n');
  process.stdout.write('fixed-add is consistent but uninformative. If it matches carriage-add,\n');
  process.stdout.write('the effect is deposit compounding and NOT carriage of information.\n\n');
  compare('consistent-uninformative vs no relay', 'fixed-add', 'isolated');
  compare('consistent-uninformative vs the real relay', 'fixed-add', 'carriage-add');
  compare('consistent-uninformative vs scattered null', 'fixed-add', 'null-add');
}

process.stdout.write('=== Q3: DOES A CHOOSING RELAY DISTORT? ===\n');
process.stdout.write('Powers are measured in the ADDITIVE family, the only regime where the relay\n');
process.stdout.write('demonstrably reaches the hives. carriage-add shares their deposit semantics\n');
process.stdout.write('and differs only in the power under test.\n\n');
for (const arm of ['filter-add', 'throttle-add', 'order-add']) {
  compare('power vs additive carriage', arm, 'carriage-add');
}
process.stdout.write('=== and each power against its null, to separate steering from injection ===\n\n');
for (const arm of ['filter-add', 'throttle-add', 'order-add']) {
  compare('power vs random-tip null', arm, 'null-add');
}
