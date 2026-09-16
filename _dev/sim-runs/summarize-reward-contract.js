#!/usr/bin/env node
'use strict';

// Portable, read-only summary for ant-hive reward-contract rows. This module
// deliberately accepts JSONL paths rather than reaching into a run directory,
// so a clean checkout can reproduce the same checks as a live run.

const fs = require('node:fs');

class RewardContractRefusal extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RewardContractRefusal';
    this.code = code;
  }
}

function selectHiveRows(rows) {
  return rows.filter((row) => row && typeof row === 'object'
    && typeof row.hive === 'string' && row.hive !== 'world'
    && typeof row.action === 'string');
}

function assertOneVersion(rows) {
  const counts = new Map();
  for (const row of rows) {
    const version = row.reward_contract_version;
    if (version === null || version === undefined) {
      throw new RewardContractRefusal(
        'missing-reward-contract-version',
        'reward_contract_version is absent from one or more hive rows'
      );
    }
    counts.set(version, (counts.get(version) || 0) + 1);
  }
  if (counts.size !== 1) {
    const detail = Array.from(counts.entries()).map(([v, n]) => `${v}=${n} rows`).join(', ');
    throw new RewardContractRefusal('mixed-reward-contract-version', `mixed reward_contract_version: ${detail}`);
  }
  return String(Array.from(counts.keys())[0]);
}

function summarizeRows(inputRows, { windowSize = null } = {}) {
  const rows = selectHiveRows(inputRows);
  const version = assertOneVersion(rows);
  const hives = {};
  const territory = { newly_acquired: 0, already_owned: 0, contested: 0 };
  const violations = [];
  let ticksWithFood = 0;
  let foodExhausted = 0;
  let applied = 0;
  let foodGathers = 0;
  let resourceGatherRows = 0;

  for (const row of rows) {
    const hive = hives[row.hive] || (hives[row.hive] = { rows: 0, ticks_with_food: 0, applied: 0 });
    hive.rows += 1;
    if (row.stockpile && typeof row.stockpile.food === 'number' && row.stockpile.food > 0) {
      ticksWithFood += 1;
      hive.ticks_with_food += 1;
    }
    if (row.food_exhausted === true) foodExhausted += 1;
    if (row.applied === true) {
      applied += 1;
      hive.applied += 1;
    }
    if (row.resourceKey !== undefined && row.resourceKey !== null) {
      resourceGatherRows += 1;
      if (row.resourceKey === 'food' && row.applied === true) foodGathers += 1;
    }
    const outcome = row.territory_outcome;
    if (Object.prototype.hasOwnProperty.call(territory, outcome)) territory[outcome] += 1;
    if (outcome === 'already_owned'
      && (typeof row.territory_reward_contribution !== 'number' || row.territory_reward_contribution !== 0)) {
      violations.push({
        kind: 'already_owned_paid_reward',
        tick: row.tick,
        hive: row.hive,
        territory_reward_contribution: typeof row.territory_reward_contribution === 'number'
          ? row.territory_reward_contribution : null
      });
    }
  }

  const newlyAcquiredGlobal = territory.newly_acquired;
  if (newlyAcquiredGlobal > 100) {
    violations.push({ kind: 'newly_acquired_exceeds_grid_global', value: newlyAcquiredGlobal, limit: 100 });
  }
  for (const [hive, value] of Object.entries(hives)) {
    const count = rows.filter((row) => row.hive === hive && row.territory_outcome === 'newly_acquired').length;
    hives[hive].newly_acquired = count;
    if (count > 100) violations.push({ kind: 'newly_acquired_exceeds_grid_per_hive', hive, value: count, limit: 100 });
  }

  const summary = {
    schema: 'RewardContractSummary/1.0',
    reward_contract_version: version,
    rows: rows.length,
    ticks_with_food: ticksWithFood,
    food_exhausted: foodExhausted,
    applied,
    applied_rate: rows.length ? applied / rows.length : 0,
    applied_rate_by_window: [],
    per_hive: hives,
    territory,
    newly_acquired_global: newlyAcquiredGlobal,
    food_gather_share_of_applied: resourceGatherRows
      ? { advisory: true, share: applied ? foodGathers / applied : null }
      : { advisory: true, share: null },
    violations,
    ok: violations.length === 0
  };

  if (windowSize !== null) {
    if (!Number.isInteger(windowSize) || windowSize < 1) throw new Error('windowSize must be a positive integer');
    const minTick = rows.length ? Math.min(...rows.map((row) => row.tick)) : 0;
    const windows = new Map();
    for (const row of rows) {
      const index = Math.floor((row.tick - minTick) / windowSize);
      if (!windows.has(index)) windows.set(index, { rows: 0, applied: 0 });
      const window = windows.get(index);
      window.rows += 1;
      if (row.applied === true) window.applied += 1;
    }
    summary.applied_rate_by_window = Array.from(windows.entries()).sort(([a], [b]) => a - b).map(([index, window]) => ({
      tick_range: [minTick + index * windowSize, minTick + (index + 1) * windowSize - 1],
      applied_rate: window.rows ? window.applied / window.rows : 0
    }));
  }
  return summary;
}

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function main(argv) {
  if (argv.includes('--help') || argv.length === 0) {
    process.stdout.write('summarize-reward-contract.js [--json] <log.jsonl>...\nBLOCKING on this path, ADVISORY everywhere else.\n');
    return 0;
  }
  const jsonOnly = argv.includes('--json');
  const files = argv.filter((arg) => arg !== '--json');
  try {
    const rows = files.flatMap(readJsonl);
    const summary = summarizeRows(rows);
    if (!summary.ok) {
      process.stdout.write(`INVARIANT VIOLATIONS (${summary.violations.length})\n`);
      process.stdout.write(`${JSON.stringify(summary)}\n`);
      return 3;
    }
    if (!jsonOnly) process.stdout.write(`ticks_with_food ${summary.ticks_with_food} of ${summary.rows}\n`);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    return 0;
  } catch (err) {
    if (err instanceof RewardContractRefusal) {
      process.stderr.write(`REFUSED: ${err.message}\n`);
      return 2;
    }
    process.stderr.write(`ERROR: ${err.message}\n`);
    return 1;
  }
}

module.exports = { RewardContractRefusal, selectHiveRows, summarizeRows, readJsonl };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
