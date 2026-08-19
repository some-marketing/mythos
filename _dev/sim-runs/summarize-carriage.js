#!/usr/bin/env node
'use strict';

// _dev/sim-runs/summarize-carriage.js — read-only morning summary of a
// carriage-overnight run. Reads metrics.jsonl, keeps only the final row of
// each completed episode, and reports per-condition means plus the paired
// carriage-minus-isolated difference (the experiment's actual estimand).
//
// Read-only by design: it opens the log files and writes nothing.
//
// Usage: node _dev/sim-runs/summarize-carriage.js [--root <dir>]

const fs = require('fs');
const path = require('path');

function argVal(flag, def) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ROOT = path.resolve(argVal('--root', path.join(REPO_ROOT, '_dev', 'state', 'ant-sim-overnight')));
const METRICS = path.join(ROOT, 'metrics.jsonl');
const EVENTS = path.join(ROOT, 'events.jsonl');

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean); // a torn trailing line from a crash is dropped, not fatal
}

const events = readJsonl(EVENTS);
const start = events.find((e) => e.event === 'run-start');
const stopped = events.find((e) => e.event === 'run-stopped');
const failed = events.find((e) => e.event === 'fail-closed-stop');

// A partial final episode (killed mid-run) also writes final:true rows. Only
// count episodes that reached the full round budget AND emitted the
// `episode-end` marker with the expected group count, so a truncated last
// episode never dilutes the means.
const rounds = start ? start.episode_rounds : null;
const groupsPerEpisode = start ? start.groups_per_episode : null;
// CODE REVIEW (PR #12, codex P1): carriage-overnight.js writes `episode-end`
// only after the entire group loop has written its final:true rows. A
// process terminated after completing all rounds but while writing those
// rows would otherwise pass the round-budget filter alone; the summary could
// then analyze a partial set of conditions/replicates as a complete episode.
// Require both the marker and the expected row count per episode.
const endedEpisodes = new Set(events.filter((e) => e.event === 'episode-end').map((e) => e.episode));
const finalRows = readJsonl(METRICS).filter((r) => r.final && (rounds === null || r.round === rounds));
const rowsByEpisode = new Map();
for (const row of finalRows) {
  if (!rowsByEpisode.has(row.episode)) rowsByEpisode.set(row.episode, []);
  rowsByEpisode.get(row.episode).push(row);
}
const finals = finalRows.filter((r) =>
  endedEpisodes.has(r.episode) &&
  (groupsPerEpisode === null || rowsByEpisode.get(r.episode).length === groupsPerEpisode)
);

const METRICS_OF_INTEREST = ['cum_reward', 'applied_rate', 'starved', 'builds', 'structures', 'territory', 'mean_entropy', 'world_food'];

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
function stdev(xs) {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}
const fmt = (x) => (Number.isFinite(x) ? x.toFixed(3) : 'n/a');

const byCondition = {};
for (const row of finals) {
  (byCondition[row.condition] = byCondition[row.condition] || []).push(row);
}

process.stdout.write(`carriage-overnight summary — ${ROOT}\n`);
if (start) {
  process.stdout.write(`started ${start.ts} pid=${start.pid} episode_rounds=${start.episode_rounds} replicates=${start.replicates}\n`);
}
process.stdout.write(stopped ? `stopped ${stopped.ts} reason=${stopped.reason} episodes=${stopped.episodes_completed}\n`
  : failed ? `FAIL-CLOSED ${failed.ts}: ${failed.error}\n`
    : `still running (no stop event yet)\n`);
process.stdout.write(`complete episode-groups: ${finals.length}\n\n`);

for (const condition of Object.keys(byCondition)) {
  const rows = byCondition[condition];
  process.stdout.write(`${condition} (n=${rows.length})\n`);
  for (const key of METRICS_OF_INTEREST) {
    const xs = rows.map((r) => r[key]).filter(Number.isFinite);
    process.stdout.write(`  ${key.padEnd(16)} mean=${fmt(mean(xs))} sd=${fmt(stdev(xs))}\n`);
  }
  if (condition === 'carriage') {
    const tips = rows.map((r) => r.relay_tips).filter(Number.isFinite);
    const act = rows.map((r) => r.relay_actionable).filter(Number.isFinite);
    const rate = rows.map((r) => (r.relay_tips ? r.relay_actionable / r.relay_tips : NaN)).filter(Number.isFinite);
    process.stdout.write(`  relay_tips       mean=${fmt(mean(tips))}\n`);
    process.stdout.write(`  relay_actionable mean=${fmt(mean(act))} informativeness=${fmt(mean(rate))}\n`);
  }
  process.stdout.write('\n');
}

// Paired difference: same (episode, replicate) means the same seed base ran
// in both arms, so pairing removes seed variance from the comparison. This
// is the number the carriage hypothesis stands or falls on.
const keyOf = (r) => `${r.episode}:${r.replicate}`;
const isolated = new Map((byCondition.isolated || []).map((r) => [keyOf(r), r]));
const shared = new Map((byCondition.shared || []).map((r) => [keyOf(r), r]));

for (const [label, other] of [['carriage - isolated', isolated], ['carriage - shared', shared]]) {
  const pairs = (byCondition.carriage || [])
    .map((c) => ({ c, o: other.get(keyOf(c)) }))
    .filter((p) => p.o);
  if (!pairs.length) continue;
  process.stdout.write(`paired difference: ${label} (n=${pairs.length} matched seed bases)\n`);
  for (const key of METRICS_OF_INTEREST) {
    // CODE REVIEW (PR #12, codex P1): the carriage driver derives every
    // replicate in an episode from one per-episode seed base, so replicate
    // pairs within an episode are NOT independent. Treating each pair as an
    // independent observation narrows the interval artificially. Cluster at
    // the episode level: average the paired differences within each episode,
    // then compute uncertainty over episodes (mirrors summarize-authority-
    // probe.js).
    const paired = pairs
      .map((p) => ({ d: p.c[key] - p.o[key], episode: p.c.episode }))
      .filter((x) => Number.isFinite(x.d));
    if (!paired.length) continue;
    const byEpisode = new Map();
    for (const x of paired) {
      if (!byEpisode.has(x.episode)) byEpisode.set(x.episode, []);
      byEpisode.get(x.episode).push(x.d);
    }
    const episodeDiffs = [...byEpisode.values()].map((ds) => mean(ds));
    const m = mean(episodeDiffs);
    const sd = stdev(episodeDiffs);
    // Standard-error band on the paired mean, clustered by episode. Not a
    // significance test -- an interval that excludes 0 is a reason to look
    // harder, not a result.
    const se = sd / Math.sqrt(episodeDiffs.length);
    process.stdout.write(`  ${key.padEnd(16)} mean_diff=${fmt(m)} se=${fmt(se)} (${episodeDiffs.length} ep clusters) 95%~[${fmt(m - 1.96 * se)}, ${fmt(m + 1.96 * se)}]\n`);
  }
  process.stdout.write('\n');
}
