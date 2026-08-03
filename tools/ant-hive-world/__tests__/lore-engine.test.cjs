'use strict';

// Lore/wiki layer (plan ant-hive-world-lore-wiki-layer, S1). Pure-function
// unit tests for trigger detection and entry generation -- no real SSH/
// Ollama round-trip; generate-entry.js's dispatch is injected per the
// module's own testability design.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  freshCheckpoint,
  detectTriggers
} = require('../lore-engine/detect-triggers.js');
const {
  buildPrompt,
  sanitizeNarrativeText,
  generateEntry
} = require('../lore-engine/generate-entry.js');

// --- detect-triggers.js -----------------------------------------------

test('detectTriggers fires a discovery trigger on the first successful gather of a resource type', () => {
  const entries = [
    { ts: 't1', event: 'tick', verb: 'gather', applied: true, stockpile_credit: { resourceKey: 'clay', amount: 1 } }
  ];
  const { triggers, checkpoint } = detectTriggers({
    hiveId: 'hive-a', newAuditEntries: entries, checkpoint: freshCheckpoint(), worldStateSnapshot: null
  });
  assert.equal(triggers.length, 1);
  assert.equal(triggers[0].entry_type, 'discovery');
  assert.equal(triggers[0].subject, 'clay');
  assert.equal(triggers[0].tier, 'routine');
  assert.ok(checkpoint.discovered_subjects.includes('clay'));
});

test('detectTriggers never re-fires a discovery trigger for the same resource type twice', () => {
  const entries = [
    { ts: 't1', event: 'tick', verb: 'gather', applied: true, stockpile_credit: { resourceKey: 'clay', amount: 1 } },
    { ts: 't2', event: 'tick', verb: 'gather', applied: true, stockpile_credit: { resourceKey: 'clay', amount: 2 } }
  ];
  const { triggers } = detectTriggers({
    hiveId: 'hive-a', newAuditEntries: entries, checkpoint: freshCheckpoint(), worldStateSnapshot: null
  });
  assert.equal(triggers.filter((t) => t.entry_type === 'discovery').length, 1);
});

test('detectTriggers respects a checkpoint carried across calls -- a resource discovered in an earlier batch does not re-fire', () => {
  const first = detectTriggers({
    hiveId: 'hive-a',
    newAuditEntries: [{ ts: 't1', event: 'tick', verb: 'gather', applied: true, stockpile_credit: { resourceKey: 'clay', amount: 1 } }],
    checkpoint: freshCheckpoint(),
    worldStateSnapshot: null
  });
  const second = detectTriggers({
    hiveId: 'hive-a',
    newAuditEntries: [{ ts: 't2', event: 'tick', verb: 'gather', applied: true, stockpile_credit: { resourceKey: 'clay', amount: 1 } }],
    checkpoint: first.checkpoint,
    worldStateSnapshot: null
  });
  assert.equal(second.triggers.filter((t) => t.entry_type === 'discovery').length, 0);
});

test('detectTriggers fires a structure trigger on every applied build, and a milestone at configured counts', () => {
  const entries = Array.from({ length: 5 }, (_, i) => ({ ts: `t${i}`, event: 'tick', verb: 'build', applied: true }));
  const { triggers } = detectTriggers({
    hiveId: 'hive-a', newAuditEntries: entries, checkpoint: freshCheckpoint(), worldStateSnapshot: null,
    opts: { structureMilestoneCounts: [5] }
  });
  const structureTriggers = triggers.filter((t) => t.entry_type === 'structure');
  const milestoneTriggers = triggers.filter((t) => t.entry_type === 'milestone');
  assert.equal(structureTriggers.length, 5);
  assert.equal(milestoneTriggers.length, 1);
  assert.equal(milestoneTriggers[0].tier, 'milestone');
  assert.equal(milestoneTriggers[0].subject, '5th-structure');
});

test('detectTriggers throttles territory triggers to at most one per configured tick window', () => {
  const entries = Array.from({ length: 10 }, (_, i) => ({ ts: `t${i}`, event: 'tick', verb: 'claim-territory', applied: true, tileId: `tile-${i}` }));
  const { triggers } = detectTriggers({
    hiveId: 'hive-a', newAuditEntries: entries, checkpoint: freshCheckpoint(), worldStateSnapshot: null,
    opts: { territoryThrottleTicks: 20 }
  });
  assert.equal(triggers.filter((t) => t.entry_type === 'territory').length, 1);
});

test('detectTriggers ignores non-tick audit events (rejected-verb, build-insufficient-materials, territory-contested)', () => {
  const entries = [
    { ts: 't1', event: 'rejected-verb', verb: 'nonsense' },
    { ts: 't2', event: 'build-insufficient-materials', required: {}, have: {} },
    { ts: 't3', event: 'territory-contested', tileId: 'tile-1', contested_by: 'hive-b' }
  ];
  const { triggers } = detectTriggers({
    hiveId: 'hive-a', newAuditEntries: entries, checkpoint: freshCheckpoint(), worldStateSnapshot: null
  });
  assert.equal(triggers.length, 0);
});

test('detectTriggers fires a milestone once when population crosses a crash threshold, and can re-fire after recovering and crashing again', () => {
  const checkpoint = freshCheckpoint();
  const crashSnapshot = { prey_population: 5, predator_population: 2, written_at: new Date().toISOString() };
  const opts = { maxPrey: 200, maxPredators: 40 };

  const round1 = detectTriggers({ hiveId: 'hive-a', newAuditEntries: [], checkpoint, worldStateSnapshot: crashSnapshot, opts });
  assert.equal(round1.triggers.filter((t) => t.subject === 'prey-crash').length, 1);

  // Same snapshot again -- must not re-fire while still below threshold.
  const round2 = detectTriggers({ hiveId: 'hive-a', newAuditEntries: [], checkpoint: round1.checkpoint, worldStateSnapshot: crashSnapshot, opts });
  assert.equal(round2.triggers.filter((t) => t.subject === 'prey-crash').length, 0);

  // Recovers above threshold -- milestone key clears.
  const recoveredSnapshot = { prey_population: 100, predator_population: 2, written_at: new Date().toISOString() };
  const round3 = detectTriggers({ hiveId: 'hive-a', newAuditEntries: [], checkpoint: round2.checkpoint, worldStateSnapshot: recoveredSnapshot, opts });
  assert.equal(round3.triggers.filter((t) => t.subject === 'prey-crash').length, 0);

  // Crashes again -- should be allowed to re-fire (a real boom/bust cycle).
  const round4 = detectTriggers({ hiveId: 'hive-a', newAuditEntries: [], checkpoint: round3.checkpoint, worldStateSnapshot: crashSnapshot, opts });
  assert.equal(round4.triggers.filter((t) => t.subject === 'prey-crash').length, 1);
});

// codex distinct review (2026-07-17), blocking finding: environmental
// materials (clay/water/ore/fiber/mud) are discovered passively, never via
// the 'gather' verb, so harness.js now emits a distinct 'material-discovered'
// event for them -- handled here without inflating tickCounter.

test('detectTriggers fires a discovery trigger from a material-discovered event, deduped the same way as a gather discovery', () => {
  const entries = [
    { ts: 't1', event: 'material-discovered', material: 'clay', applied: true },
    { ts: 't2', event: 'material-discovered', material: 'clay', applied: true }
  ];
  const { triggers, checkpoint } = detectTriggers({
    hiveId: 'hive-a', newAuditEntries: entries, checkpoint: freshCheckpoint(), worldStateSnapshot: null
  });
  assert.equal(triggers.length, 1);
  assert.equal(triggers[0].entry_type, 'discovery');
  assert.equal(triggers[0].subject, 'clay');
  assert.ok(checkpoint.discovered_subjects.includes('clay'));
});

test('material-discovered events do not inflate the territory-throttle tick counter', () => {
  const entries = [
    { ts: 't1', event: 'material-discovered', material: 'clay', applied: true },
    { ts: 't2', event: 'material-discovered', material: 'water', applied: true },
    { ts: 't3', event: 'material-discovered', material: 'ore', applied: true },
    { ts: 't4', event: 'tick', verb: 'claim-territory', applied: true, tileId: 'tile-1' }
  ];
  const { checkpoint } = detectTriggers({
    hiveId: 'hive-a', newAuditEntries: entries, checkpoint: freshCheckpoint(), worldStateSnapshot: null
  });
  // Only the one genuine 'tick' event should have incremented the counter,
  // not the three material-discovered annotations alongside it.
  assert.equal(checkpoint.last_tick_seen, 1);
});

test('detectTriggers skips milestone population checks entirely when no world-state snapshot is available', () => {
  const { triggers } = detectTriggers({
    hiveId: 'hive-a', newAuditEntries: [], checkpoint: freshCheckpoint(), worldStateSnapshot: null,
    opts: { maxPrey: 200, maxPredators: 40 }
  });
  assert.equal(triggers.length, 0);
});

// --- generate-entry.js --------------------------------------------------

test('buildPrompt includes the subject, event type, and prior entries for grounding', () => {
  const trigger = { hive: 'hive-a', entry_type: 'discovery', subject: 'clay', tier: 'routine' };
  const prior = [{ entry_type: 'discovery', subject: 'water', narrative_text: 'The colony found water.' }];
  const prompt = buildPrompt(trigger, prior);
  assert.ok(prompt.includes('clay'));
  assert.ok(prompt.includes('discovery'));
  assert.ok(prompt.includes('The colony found water.'));
});

test('buildPrompt handles an empty prior-entries list without crashing', () => {
  const trigger = { hive: 'hive-a', entry_type: 'discovery', subject: 'clay', tier: 'routine' };
  const prompt = buildPrompt(trigger, []);
  assert.ok(prompt.includes('no prior entries yet'));
});

test('sanitizeNarrativeText strips markdown headers and code fences, and caps length', () => {
  const raw = '# Chronicle Entry\nThe colony discovered clay today.\n```js\nconsole.log(1)\n```';
  const clean = sanitizeNarrativeText(raw);
  assert.ok(!clean.includes('#'));
  assert.ok(!clean.includes('```'));
  assert.ok(clean.includes('discovered clay'));
});

test('sanitizeNarrativeText rejects empty or whitespace-only output as null, not an empty entry', () => {
  assert.equal(sanitizeNarrativeText('   \n\n  '), null);
  assert.equal(sanitizeNarrativeText(''), null);
  assert.equal(sanitizeNarrativeText(undefined), null);
});

test('sanitizeNarrativeText truncates output past the max entry length', () => {
  const long = 'a'.repeat(5000);
  const clean = sanitizeNarrativeText(long);
  assert.ok(clean.length <= 1201); // MAX_ENTRY_LENGTH + ellipsis char
});

test('generateEntry refuses to handle a milestone-tier trigger -- routine-only by design', () => {
  const trigger = { hive: 'hive-a', entry_type: 'milestone', subject: 'prey-crash', tier: 'milestone' };
  const result = generateEntry(trigger, { dispatchFn: () => ({ verdict: 'ok', response: 'should not be called' }) });
  assert.equal(result.ok, false);
  assert.match(result.error, /routine-tier/);
});

test('generateEntry returns a valid entry when the injected dispatch succeeds', () => {
  const trigger = { hive: 'hive-a', entry_type: 'discovery', subject: 'clay', tier: 'routine', source_event: { verb: 'gather' } };
  const dispatchFn = () => ({ verdict: 'ok', response: 'The colony unearths red clay near the eastern ridge.', model: 'test-model' });
  const result = generateEntry(trigger, { dispatchFn });
  assert.equal(result.ok, true);
  assert.equal(result.entry.hive, 'hive-a');
  assert.equal(result.entry.subject, 'clay');
  assert.ok(result.entry.narrative_text.includes('clay'));
  assert.equal(result.entry.model, 'test-model');
});

test('generateEntry surfaces a dispatch failure (non-ok verdict) as a structured error, not a thrown exception', () => {
  const trigger = { hive: 'hive-a', entry_type: 'discovery', subject: 'clay', tier: 'routine' };
  const dispatchFn = () => ({ verdict: 'timeout', error: 'Orwell unreachable' });
  const result = generateEntry(trigger, { dispatchFn });
  assert.equal(result.ok, false);
  assert.match(result.error, /Orwell unreachable/);
});

test('generateEntry surfaces a thrown dispatch exception as a structured error, never crashes the caller', () => {
  const trigger = { hive: 'hive-a', entry_type: 'discovery', subject: 'clay', tier: 'routine' };
  const dispatchFn = () => { throw new Error('SSH connection refused'); };
  const result = generateEntry(trigger, { dispatchFn });
  assert.equal(result.ok, false);
  assert.match(result.error, /SSH connection refused/);
});

test('generateEntry rejects an unusable (empty-after-sanitization) model response as a failure', () => {
  const trigger = { hive: 'hive-a', entry_type: 'discovery', subject: 'clay', tier: 'routine' };
  const dispatchFn = () => ({ verdict: 'ok', response: '   ' });
  const result = generateEntry(trigger, { dispatchFn });
  assert.equal(result.ok, false);
  assert.match(result.error, /unusable/);
});
