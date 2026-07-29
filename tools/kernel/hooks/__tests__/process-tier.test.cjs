#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../..', '..');
const STAMP = path.join(ROOT, 'tools/kernel/hooks/session-start-tier-stamp.cjs');
const ROUTER = path.join(ROOT, 'tools/kernel/hooks/userpromptsubmit-ambient-router.cjs');
const RULE_LINT = path.join(ROOT, 'tools/maintenance/process-tier-rule-lint.cjs');
const {
  checkCoordinationInvariant,
  readRule,
  readSessionAdds,
  readSessionStamp,
  readSessionTier,
  resolveAddsForTier,
  resolveProcessTier,
  resolveProcessTierDetailed,
  writeSessionTier
} = require('../lib/process-tier.cjs');

let pass = 0;
let fail = 0;

function check(name, fn) {
  try {
    fn();
    pass += 1;
  } catch (err) {
    fail += 1;
    console.error(`FAIL ${name}`);
    console.error(err.stack || err.message);
  }
}

function cleanEnv() {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: ROOT };
  delete env.CLAUDE_MODEL;
  delete env.CLAUDE_MODEL_ID;
  delete env.MYTHOS_MODEL;
  delete env.MYTHOS_PROCESS_TIER;
  delete env.MYTHOS_PROCESS_TIER_OPERATOR_PROVENANCE;
  delete env.MYTHOS_COORDINATION_SCOPE;
  delete env.MYTHOS_JUDGMENT_CEILING;
  return env;
}

// 1.2 (operator REMOVE ruling 2026-06-15): frontier is Opus-class while Fable
// is retired; Fable globs removed -> fable no longer resolves to frontier (falls
// through to scaffold/fallback). gpt-5 coordinators stay associate.
check('opus models resolve to frontier; retired fable falls through to scaffold', () => {
  assert.equal(resolveProcessTier({ model: 'claude-opus-4-8', rule: readRule() }), 'frontier');
  assert.equal(resolveProcessTier({ model: 'opus-next', rule: readRule() }), 'frontier');
  // Fable retired: globs removed, no longer a frontier match.
  assert.equal(resolveProcessTier({ model: 'claude-fable-5', rule: readRule() }), 'scaffold');
});

check('opus resolves to frontier; gpt-5 coordinators stay associate (1.2 repoint)', () => {
  const rule = readRule();
  assert.equal(resolveProcessTier({ model: 'claude-opus-4-5', rule }), 'frontier');
  assert.equal(resolveProcessTier({ model: 'opus-mini', rule }), 'frontier');
  assert.equal(resolveProcessTier({ model: 'gpt-5.5', rule }), 'associate');
  assert.equal(resolveProcessTier({ model: 'gpt-5.5-codex', rule }), 'associate');
  assert.deepEqual(
    resolveProcessTierDetailed({ model: 'gpt-5.5-codex', rule }),
    { tier: 'associate', tier_provenance: 'resolved-model' }
  );
});

check('unknown model resolves to scaffold', () => {
  assert.equal(resolveProcessTier({ model: 'mystery-model', rule: readRule() }), 'scaffold');
});

check('sentinel and mechanical require explicit declaration', () => {
  assert.equal(resolveProcessTier({ model: 'claude-haiku-4', rule: readRule() }), 'scaffold');
  assert.equal(resolveProcessTier({ model: 'claude-haiku-4', declared: 'sentinel', rule: readRule() }), 'sentinel');
  assert.equal(resolveProcessTier({ model: 'script', declared: 'mechanical', rule: readRule() }), 'mechanical');
});

check('bogus declared tier falls through to model matching', () => {
  assert.equal(resolveProcessTier({ model: 'claude-opus-4-8', declared: 'ghost', rule: readRule() }), 'frontier');
});

// tier-s0a (convene 20260611T130035Z, condition 2): the stamp must always
// say HOW it was classified — resolved-model | declared | fallback-scaffold.
check('resolveProcessTierDetailed records provenance for every resolution path', () => {
  const rule = readRule();
  assert.deepEqual(
    resolveProcessTierDetailed({ model: 'claude-opus-4-8', rule }),
    { tier: 'frontier', tier_provenance: 'resolved-model' }
  );
  assert.deepEqual(
    resolveProcessTierDetailed({ model: 'claude-sonnet-4', rule }),
    { tier: 'scaffold', tier_provenance: 'resolved-model' }
  );
  assert.deepEqual(
    resolveProcessTierDetailed({ model: 'claude-haiku-4', declared: 'sentinel', rule }),
    { tier: 'sentinel', tier_provenance: 'declared' }
  );
  assert.deepEqual(
    resolveProcessTierDetailed({ model: 'mystery-model', rule }),
    { tier: 'scaffold', tier_provenance: 'fallback-scaffold' }
  );
  // 'unknown' is resolveModel's unresolvable sentinel — never a silent default.
  assert.deepEqual(
    resolveProcessTierDetailed({ model: 'unknown', rule }),
    { tier: 'scaffold', tier_provenance: 'fallback-scaffold' }
  );
  // bogus declared tier falls through to model inference, provenance included
  assert.deepEqual(
    resolveProcessTierDetailed({ model: 'claude-opus-4-8', declared: 'ghost', rule }),
    { tier: 'frontier', tier_provenance: 'resolved-model' }
  );
});

// tier-s1b-resolver-down-only (convene condition 3 / G3): the declared-tier
// self-promotion hole is CLOSED. Downward honored, upward rejected without
// operator provenance, rejection recorded.
check('down-only: downward declarations are honored', () => {
  const rule = readRule();
  assert.deepEqual(
    resolveProcessTierDetailed({ model: 'claude-opus-4-8', declared: 'scaffold', rule }),
    { tier: 'scaffold', tier_provenance: 'declared' }
  );
  assert.deepEqual(
    resolveProcessTierDetailed({ model: 'claude-opus-4-8', declared: 'mechanical', rule }),
    { tier: 'mechanical', tier_provenance: 'declared' }
  );
  assert.deepEqual(
    resolveProcessTierDetailed({ model: 'claude-opus-4-5', declared: 'scaffold', rule }),
    { tier: 'scaffold', tier_provenance: 'declared' }
  );
  // equal-rank declaration is honored too (equal-or-stricter)
  assert.deepEqual(
    resolveProcessTierDetailed({ model: 'gpt-5.5', declared: 'associate', rule }),
    { tier: 'associate', tier_provenance: 'declared' }
  );
});

check('down-only: scaffold-class session declaring frontier does NOT resolve frontier (self-promotion closed, G3 fixture)', () => {
  const rule = readRule();
  const result = resolveProcessTierDetailed({ model: 'claude-sonnet-4', declared: 'frontier', rule });
  assert.equal(result.tier, 'scaffold');
  assert.equal(result.tier_provenance, 'resolved-model');
  assert.deepEqual(result.rejected_declaration, {
    declared: 'frontier',
    inferred_tier: 'scaffold',
    reason: 'upward-declaration-without-operator-provenance'
  });

  // associate -> frontier is upward and rejected (gpt-5 stays associate under 1.2;
  // opus now infers frontier, so opus declaring frontier is equal-rank, not upward)
  const gpt = resolveProcessTierDetailed({ model: 'gpt-5.5', declared: 'frontier', rule });
  assert.equal(gpt.tier, 'associate');
  assert.equal(gpt.rejected_declaration.declared, 'frontier');

  // unknown model declaring associate is upward from fallback scaffold
  const unknown = resolveProcessTierDetailed({ model: 'mystery-model', declared: 'associate', rule });
  assert.equal(unknown.tier, 'scaffold');
  assert.equal(unknown.tier_provenance, 'fallback-scaffold');
  assert.equal(unknown.rejected_declaration.declared, 'associate');
});

check('down-only: upward declaration honored ONLY with an existing operator-provenance artifact', () => {
  const rule = readRule();
  const existingArtifact = '_dev/reports/analysis/task-plans/tier-enforcement-implementation__plan.json';
  const honored = resolveProcessTierDetailed({
    model: 'claude-sonnet-4',
    declared: 'frontier',
    operatorProvenance: existingArtifact,
    rule
  });
  assert.equal(honored.tier, 'frontier');
  assert.equal(honored.tier_provenance, 'declared');
  assert.equal(honored.declaration_operator_provenance, existingArtifact);
  assert.equal(honored.rejected_declaration, undefined);

  // A reference that does not exist on disk does NOT unlock the upward path.
  const bogusRef = resolveProcessTierDetailed({
    model: 'claude-sonnet-4',
    declared: 'frontier',
    operatorProvenance: '_dev/no-such-operator-artifact.json',
    rule
  });
  assert.equal(bogusRef.tier, 'scaffold');
  assert.equal(bogusRef.rejected_declaration.declared, 'frontier');
});

check('session-start stamp records a rejected upward declaration (never silent)', () => {
  const sessionId = `process-tier-rejected-declaration-test-${Date.now()}`;
  const res = spawnSync(process.execPath, [STAMP], {
    cwd: ROOT,
    input: JSON.stringify({ session_id: sessionId, model: 'claude-sonnet-4', process_tier: 'frontier' }),
    encoding: 'utf8',
    env: cleanEnv()
  });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /tier=scaffold provenance=resolved-model/);
  const stamp = readSessionStamp(sessionId);
  assert.equal(stamp.tier, 'scaffold');
  assert.equal(stamp.declared_process_tier, 'frontier');
  assert.equal(stamp.rejected_declaration.declared, 'frontier');
  assert.equal(stamp.rejected_declaration.reason, 'upward-declaration-without-operator-provenance');
});

check('session-start stamp honors upward declaration with operator provenance and records the reference', () => {
  const sessionId = `process-tier-operator-provenance-test-${Date.now()}`;
  const ref = '_dev/reports/analysis/task-plans/tier-enforcement-implementation__plan.json';
  const res = spawnSync(process.execPath, [STAMP], {
    cwd: ROOT,
    input: JSON.stringify({
      session_id: sessionId,
      model: 'claude-sonnet-4',
      process_tier: 'frontier',
      process_tier_operator_provenance: ref
    }),
    encoding: 'utf8',
    env: cleanEnv()
  });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /tier=frontier provenance=declared/);
  const stamp = readSessionStamp(sessionId);
  assert.equal(stamp.tier, 'frontier');
  assert.equal(stamp.declaration_operator_provenance, ref);
  assert.equal(stamp.rejected_declaration, null);
});

// tier-s1b: coordination_scope + judgment ceiling carried through the stamp
// (operator fork resolution; consumers land in slice 2).
check('session-start stamp carries coordination_scope and judgment_ceiling', () => {
  const sessionId = `process-tier-coordination-scope-test-${Date.now()}`;
  const res = spawnSync(process.execPath, [STAMP], {
    cwd: ROOT,
    input: JSON.stringify({
      session_id: sessionId,
      model: 'claude-haiku-4',
      coordination_scope: 'subtree',
      judgment_ceiling: 'sentinel'
    }),
    encoding: 'utf8',
    env: cleanEnv()
  });
  assert.equal(res.status, 0);
  const stamp = readSessionStamp(sessionId);
  assert.equal(stamp.coordination_scope, 'subtree');
  assert.equal(stamp.judgment_ceiling, 'sentinel');
  // invalid scope values are dropped, not stored
  const sessionId2 = `process-tier-bad-scope-test-${Date.now()}`;
  spawnSync(process.execPath, [STAMP], {
    cwd: ROOT,
    input: JSON.stringify({ session_id: sessionId2, model: 'claude-haiku-4', coordination_scope: 'galaxy' }),
    encoding: 'utf8',
    env: cleanEnv()
  });
  assert.equal(readSessionStamp(sessionId2).coordination_scope, null);
});

// tier-s1c / G12: readSessionAdds resolves adds LIVE from the rule file at
// read time, keyed by the stamped tier — never baked into the stamp.
check('readSessionAdds resolves live adds per tier (scaffold six, associate three, frontier none)', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tier-adds-test-'));
  const opts = { stateDir };
  writeSessionTier({ sessionId: 's-scaffold', model: 'claude-sonnet-4', tier: 'scaffold', tierProvenance: 'resolved-model', source: 'test' }, opts);
  writeSessionTier({ sessionId: 's-associate', model: 'gpt-5.5', tier: 'associate', tierProvenance: 'resolved-model', source: 'test' }, opts);
  writeSessionTier({ sessionId: 's-frontier', model: 'claude-opus-4-8', tier: 'frontier', tierProvenance: 'resolved-model', source: 'test' }, opts);

  const scaffoldAdds = readSessionAdds('s-scaffold', opts).map((a) => a.id);
  assert.deepEqual(scaffoldAdds, [
    'kernel-normalization-injection',
    'owl-altitude-injection',
    'mutation-plan-gate',
    'closeout-evidence-gate',
    'delegation-altitude-cap',
    'no-final-status-authority'
  ]);
  const associateAdds = readSessionAdds('s-associate', opts).map((a) => a.id);
  assert.deepEqual(associateAdds, [
    'closeout-evidence-gate',
    'delegation-altitude-cap',
    'no-final-status-authority'
  ]);
  assert.deepEqual(readSessionAdds('s-frontier', opts), []);
  // every resolved add carries the full typed field set
  for (const add of readSessionAdds('s-scaffold', opts)) {
    assert.equal(add.family, 'quality-process');
    assert.ok(['injection', 'hard-gate', 'review-routing'].includes(add.kind));
    assert.ok(Array.isArray(add.surfaces) && add.surfaces.length > 0);
    assert.ok(Array.isArray(add.paths));
    assert.ok(['report-only', 'blocking'].includes(add.mode));
    assert.ok(Object.prototype.hasOwnProperty.call(add, 'artifact_query'));
    assert.ok(add.bypass_policy && add.bypass_policy.kill_switch);
  }
  // missing stamp -> []
  assert.deepEqual(readSessionAdds('s-never-stamped', opts), []);
});

check('readSessionAdds is LIVE: a rule change is visible without re-stamping', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tier-adds-live-test-'));
  const opts = { stateDir };
  writeSessionTier({ sessionId: 's-live', model: 'claude-sonnet-4', tier: 'scaffold', tierProvenance: 'resolved-model', source: 'test' }, opts);
  const trimmedRule = JSON.parse(JSON.stringify(readRule()));
  const scaffold = trimmedRule.tiers.find((t) => t.tier === 'scaffold');
  scaffold.adds = ['mutation-plan-gate'];
  const adds = readSessionAdds('s-live', { ...opts, rule: trimmedRule });
  assert.deepEqual(adds.map((a) => a.id), ['mutation-plan-gate']);
});

check('readSessionAdds degrades safely: 1.0-shape stamps and 1.0-shape rules', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tier-adds-fallback-test-'));
  const opts = { stateDir };
  // A pre-slice-1 ProcessTierStamp/1.0 stamp lacking every new field: only
  // stamp.tier is consulted.
  fs.writeFileSync(path.join(stateDir, 'legacy-stamp.json'), JSON.stringify({
    schema: 'ProcessTierStamp/1.0',
    session_id: 'legacy-stamp',
    model: 'claude-sonnet-4',
    declared_process_tier: null,
    tier: 'scaffold',
    source: 'session-start',
    stamped_at: new Date().toISOString()
  }, null, 2));
  assert.deepEqual(
    readSessionAdds('legacy-stamp', opts).map((a) => a.id).length,
    6
  );
  // A ProcessTierRule/1.0 rule without add_registry yields [] (never throws).
  const legacyRule = JSON.parse(JSON.stringify(readRule()));
  delete legacyRule.add_registry;
  legacyRule.schema = 'ProcessTierRule/1.0';
  assert.deepEqual(readSessionAdds('legacy-stamp', { ...opts, rule: legacyRule }), []);
  assert.deepEqual(resolveAddsForTier('scaffold', legacyRule), []);
  assert.deepEqual(resolveAddsForTier('scaffold', null), []);
});

// tier-s1c / G9: recursive coordinator-tier invariant checker on
// coordination_scope fixtures (operator haiku-subtree fork resolution).
check('checkCoordinationInvariant: compliant haiku subtree passes', () => {
  const rule = readRule();
  const result = checkCoordinationInvariant({
    tier: 'scaffold',
    model: 'claude-haiku-4',
    coordination_scope: 'subtree',
    judgment_ceiling: 'sentinel',
    lanes: [
      { kind: 'judgment', tier: 'sentinel' },
      { kind: 'mechanical', tier: 'mechanical' }
    ],
    children: []
  }, { rule });
  assert.deepEqual(result, { ok: true, violations: [] });
});

check('checkCoordinationInvariant: judgment lane above coordinator tier is a violation (recursively)', () => {
  const rule = readRule();
  const result = checkCoordinationInvariant({
    tier: 'frontier',
    model: 'claude-opus-4-8',
    coordination_scope: 'session-root',
    children: [
      {
        tier: 'sentinel',
        model: 'claude-haiku-4',
        coordination_scope: 'subtree',
        judgment_ceiling: 'sentinel',
        lanes: [{ kind: 'judgment', tier: 'frontier' }]
      }
    ]
  }, { rule });
  assert.equal(result.ok, false);
  const reasons = result.violations.map((v) => v.reason);
  assert.ok(reasons.includes('coordinator-below-subtree-judgment-tier'));
  assert.ok(reasons.includes('judgment-lane-exceeds-declared-ceiling'));
});

check('checkCoordinationInvariant: session-root coordination forbidden for haiku; subtree needs a ceiling', () => {
  const rule = readRule();
  const sessionRoot = checkCoordinationInvariant({
    tier: 'scaffold',
    model: 'claude-haiku-4',
    coordination_scope: 'session-root'
  }, { rule });
  assert.equal(sessionRoot.ok, false);
  assert.ok(sessionRoot.violations.some((v) => v.reason === 'session-root-coordination-forbidden-for-model'));

  const noCeiling = checkCoordinationInvariant({
    tier: 'scaffold',
    model: 'claude-haiku-4',
    coordination_scope: 'subtree',
    lanes: [{ kind: 'judgment', tier: 'sentinel' }]
  }, { rule });
  assert.equal(noCeiling.ok, false);
  assert.ok(noCeiling.violations.some((v) => v.reason === 'missing-judgment-ceiling'));
});

// tier-s1c / G4: the rule lint is green on the live rule, rejects
// unregistered add IDs, and rejects tier-name conditionals in
// tier-consuming hooks (unless explicitly marked).
check('process-tier-rule-lint: clean on the live canonical rule', () => {
  const res = spawnSync(process.execPath, [RULE_LINT], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
});

check('process-tier-rule-lint: rejects unregistered add IDs (strict enum)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tier-rule-lint-test-'));
  const badRule = JSON.parse(JSON.stringify(readRule()));
  badRule.tiers.find((t) => t.tier === 'scaffold').adds.push('totally-unregistered-add');
  const rulePath = path.join(dir, 'rule.json');
  fs.writeFileSync(rulePath, JSON.stringify(badRule));
  const res = spawnSync(process.execPath, [RULE_LINT, '--rule', rulePath, '--hooks-dir', dir], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /unregistered add ID "totally-unregistered-add"/);
});

check('process-tier-rule-lint: rejects missing typed fields and safety-family adds', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tier-rule-lint-fields-test-'));
  const badRule = JSON.parse(JSON.stringify(readRule()));
  delete badRule.add_registry.adds['mutation-plan-gate'].bypass_policy;
  badRule.add_registry.adds['owl-altitude-injection'].family = 'safety';
  const rulePath = path.join(dir, 'rule.json');
  fs.writeFileSync(rulePath, JSON.stringify(badRule));
  const res = spawnSync(process.execPath, [RULE_LINT, '--rule', rulePath, '--hooks-dir', dir], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /bypass_policy/);
  assert.match(res.stderr, /safety family is tier-blind/);
});

check('process-tier-rule-lint: flags tier-name conditionals in tier-consuming hooks; tier-name-ok marker suppresses', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tier-hook-lint-test-'));
  const offendingHook = [
    "'use strict';",
    "const { readSessionTier } = require('./lib/process-tier.cjs');",
    "if (readSessionTier('x') === 'frontier') process.exit(0);",
    ''
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'bad-hook.cjs'), offendingHook);
  const res = spawnSync(process.execPath, [RULE_LINT, '--hooks-dir', dir], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /bad-hook\.cjs:3/);
  assert.match(res.stderr, /consume add IDs via readSessionAdds/);

  const markedHook = offendingHook.replace(
    "process.exit(0);",
    'process.exit(0); // tier-name-ok: fixture exemption'
  );
  fs.writeFileSync(path.join(dir, 'bad-hook.cjs'), markedHook);
  const res2 = spawnSync(process.execPath, [RULE_LINT, '--hooks-dir', dir], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(res2.status, 0, res2.stdout + res2.stderr);
});

check('session-start tier stamp records resolved-model provenance', () => {
  const sessionId = `process-tier-provenance-test-${Date.now()}`;
  const res = spawnSync(process.execPath, [STAMP], {
    cwd: ROOT,
    input: JSON.stringify({ session_id: sessionId, model: 'claude-opus-4-8' }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT }
  });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /provenance=resolved-model/);
  const stamp = readSessionStamp(sessionId);
  assert.equal(stamp.tier, 'frontier');
  assert.equal(stamp.tier_provenance, 'resolved-model');
});

check('unresolvable model stamps fallback-scaffold provenance, never a silent default', () => {
  const sessionId = `process-tier-fallback-test-${Date.now()}`;
  const env = cleanEnv();
  const res = spawnSync(process.execPath, [STAMP], {
    cwd: ROOT,
    input: JSON.stringify({ session_id: sessionId }),
    encoding: 'utf8',
    env
  });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /tier=scaffold provenance=fallback-scaffold/);
  const stamp = readSessionStamp(sessionId);
  assert.equal(stamp.model, 'unknown');
  assert.equal(stamp.tier, 'scaffold');
  assert.equal(stamp.tier_provenance, 'fallback-scaffold');
});

check('readers tolerate stamps without tier_provenance (pre-slice-0 stamps)', () => {
  const sessionId = `process-tier-legacy-stamp-test-${Date.now()}`;
  // writeSessionTier without tierProvenance mirrors a legacy 1.0 stamp shape.
  writeSessionTier({
    sessionId,
    model: 'claude-opus-4-8',
    declared: '',
    tier: 'frontier',
    source: 'test'
  });
  assert.equal(readSessionTier(sessionId), 'frontier');
  assert.equal(readSessionStamp(sessionId).tier_provenance, null);
});

check('session-start tier stamp writes readable stamp', () => {
  const sessionId = `process-tier-test-${Date.now()}`;
  const res = spawnSync(process.execPath, [STAMP], {
    cwd: ROOT,
    input: JSON.stringify({ session_id: sessionId, model: 'claude-opus-4-8' }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT }
  });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /tier=frontier/);
  assert.equal(readSessionTier(sessionId), 'frontier');
});

check('ambient router is silent for frontier tier session', () => {
  const sessionId = `router-frontier-test-${Date.now()}`;
  writeSessionTier({
    sessionId,
    model: 'claude-opus-4-8',
    declared: '',
    tier: 'frontier',
    source: 'test'
  });
  const res = spawnSync(process.execPath, [ROUTER], {
    cwd: ROOT,
    input: JSON.stringify({
      session_id: sessionId,
      prompt: 'build the exporter and wire it into the manifest'
    }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT }
  });
  assert.equal(res.status, 0);
  assert.equal(res.stdout, '');
});

// tier-s2b-injection-consumers (slice 2): the router is a TWO-WAY add-ID
// consumer — scaffold sessions carry kernel-normalization-injection and
// force-fire on engage prompts; frontier suppression now derives from the
// rule's sheds list (no tier-name conditional); associate keeps the default.
check('ambient router fires for scaffold session via the kernel-normalization-injection add', () => {
  const sessionId = `router-scaffold-add-test-${Date.now()}`;
  writeSessionTier({
    sessionId,
    model: 'claude-sonnet-4',
    declared: '',
    tier: 'scaffold',
    source: 'test'
  });
  const res = spawnSync(process.execPath, [ROUTER], {
    cwd: ROOT,
    input: JSON.stringify({
      session_id: sessionId,
      prompt: 'build the exporter and wire it into the manifest'
    }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT }
  });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /Multi-step work detected/);
});

check('ambient router keeps the default lane for associate sessions (keeps ambient-router engagement)', () => {
  const sessionId = `router-associate-test-${Date.now()}`;
  writeSessionTier({
    sessionId,
    model: 'gpt-5.5',
    declared: '',
    tier: 'associate',
    source: 'test'
  });
  const res = spawnSync(process.execPath, [ROUTER], {
    cwd: ROOT,
    input: JSON.stringify({
      session_id: sessionId,
      prompt: 'build the exporter and wire it into the manifest'
    }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT }
  });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /Multi-step work detected/);
});

check('router suppression derives from the rule sheds list (sessionShedsAmbientInjections)', () => {
  const { sessionShedsAmbientInjections } = require('../userpromptsubmit-ambient-router.cjs');
  const rule = readRule();
  assert.equal(sessionShedsAmbientInjections({ tier: 'frontier' }, rule), true);
  assert.equal(sessionShedsAmbientInjections({ tier: 'associate' }, rule), false);
  assert.equal(sessionShedsAmbientInjections({ tier: 'scaffold' }, rule), false);
  assert.equal(sessionShedsAmbientInjections(null, rule), false);
});

// tier-s2b-injection-consumers: owl-altitude is wired globally but add-gated —
// active ONLY for sessions carrying owl-altitude-injection (scaffold), inert
// for frontier/associate/unstamped sessions; per-add kill-switch honored.
check('owl-altitude injects only for sessions carrying the owl-altitude-injection add', () => {
  const owl = require('../userprompt-owl-altitude.cjs');
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'owl-altitude-test-'));
  const opts = { stateDir };
  writeSessionTier({ sessionId: 'owl-scaffold', model: 'claude-sonnet-4', tier: 'scaffold', source: 'test' }, opts);
  writeSessionTier({ sessionId: 'owl-frontier', model: 'claude-opus-4-8', tier: 'frontier', source: 'test' }, opts);
  writeSessionTier({ sessionId: 'owl-associate', model: 'gpt-5.5', tier: 'associate', source: 'test' }, opts);

  const prompt = 'investigate the failing exporter and repair it';
  assert.match(owl.noticeForPayload({ session_id: 'owl-scaffold', prompt }, opts), /OWL ALTITUDE CHECK/);
  assert.equal(owl.noticeForPayload({ session_id: 'owl-frontier', prompt }, opts), '');
  assert.equal(owl.noticeForPayload({ session_id: 'owl-associate', prompt }, opts), '');
  assert.equal(owl.noticeForPayload({ session_id: 'owl-never-stamped', prompt }, opts), '');
  // slash commands and empty prompts pass through untouched even with the add
  assert.equal(owl.noticeForPayload({ session_id: 'owl-scaffold', prompt: '/owl status' }, opts), '');
  assert.equal(owl.noticeForPayload({ session_id: 'owl-scaffold', prompt: '   ' }, opts), '');
});

check('owl-altitude honors the per-add operator kill switch', () => {
  const owl = require('../userprompt-owl-altitude.cjs');
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'owl-kill-test-'));
  const opts = { stateDir };
  writeSessionTier({ sessionId: 'owl-killed', model: 'claude-sonnet-4', tier: 'scaffold', source: 'test' }, opts);
  const killPath = path.join(ROOT, '_dev/state/kill-switches/owl-altitude-injection.off');
  fs.mkdirSync(path.dirname(killPath), { recursive: true });
  fs.writeFileSync(killPath, '');
  try {
    assert.equal(owl.noticeForPayload({ session_id: 'owl-killed', prompt: 'investigate and repair the exporter' }, opts), '');
  } finally {
    fs.rmSync(killPath, { force: true });
  }
});

check('ambient router still emits when no tier stamp exists', () => {
  const res = spawnSync(process.execPath, [ROUTER], {
    cwd: ROOT,
    input: JSON.stringify({
      session_id: `router-unstamped-test-${Date.now()}`,
      prompt: 'build the exporter and wire it into the manifest'
    }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT }
  });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /Multi-step work detected/);
});

console.log(`\nprocess-tier: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
