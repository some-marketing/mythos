'use strict';

// Ships in the Mythos public tree at tools/instructions/__tests__/aliases.test.js.
// Run with `node --test tools/instructions/__tests__/aliases.test.js` or, since
// node:test auto-runs on direct execution, plain `node tools/instructions/__tests__/aliases.test.js`.

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const {
  loadCommandAliases,
  loadCoreDoctrine,
  parseAliasRegistry,
  planOutputs
} = require('../lib/engine');
const { commandAliasSection, coreDoctrineSection } = require('../lib/render');

// mythos-surface root (…/tools/instructions/__tests__ -> up three).
const SURFACE_ROOT = path.resolve(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// Alias registry: loading + rendering
// ---------------------------------------------------------------------------

test('no aliases -> no section (stays mythos-compatible)', () => {
  assert.equal(commandAliasSection([]), null);
  assert.equal(commandAliasSection(undefined), null);
  assert.equal(commandAliasSection(null), null);
  assert.equal(commandAliasSection({ aliases: [], framework_aliases: [], skill_aliases: [], tool_aliases: [] }), null);
});

test('parseAliasRegistry returns all four domains as arrays (JSON form)', () => {
  const raw = JSON.stringify({
    aliases: { 'plan-quest': { resolves_to: 'plan-task', status: 'primary' } },
    framework_aliases: { 'page-glamour': { resolves_to: 'wordpress/page-cro', status: 'primary' } }
  });
  assert.deepEqual(parseAliasRegistry(raw), {
    aliases: [{ id: 'plan-quest', resolves_to: 'plan-task', status: 'primary' }],
    framework_aliases: [{ id: 'page-glamour', resolves_to: 'wordpress/page-cro', status: 'primary' }],
    skill_aliases: [],
    tool_aliases: []
  });
});

test('parseAliasRegistry tolerates the commented YAML form across domains', () => {
  const raw = [
    'version: "1.0.0"',
    'aliases:',
    '  # commands',
    '  plan-quest:',
    '    resolves_to: plan-task',
    '    status: primary',
    'tool_aliases:',
    '  attune:',
    '    resolves_to: sync-manifest',
    '    status: compatibility'
  ].join('\n');
  const reg = parseAliasRegistry(raw);
  assert.deepEqual(reg.aliases, [{ id: 'plan-quest', resolves_to: 'plan-task', status: 'primary' }]);
  assert.deepEqual(reg.tool_aliases, [{ id: 'attune', resolves_to: 'sync-manifest', status: 'compatibility' }]);
  assert.deepEqual(reg.framework_aliases, []);
  assert.deepEqual(reg.skill_aliases, []);
});

test('loads the shipped 55-entry command registry with correct status split', () => {
  const aliases = loadCommandAliases(SURFACE_ROOT);
  assert.equal(aliases.length, 55);
  const byStatus = (s) => aliases.filter((a) => a.status === s).length;
  assert.equal(byStatus('primary'), 35);
  assert.equal(byStatus('cross-alias'), 15);
  assert.equal(byStatus('compatibility'), 5);

  const find = (id) => aliases.find((a) => a.id === id);
  assert.deepEqual(find('guild-ledger'), { id: 'guild-ledger', resolves_to: 'system-status', status: 'primary' });
  assert.deepEqual(find('aura'), { id: 'aura', resolves_to: 'system-status', status: 'cross-alias' });
  assert.deepEqual(find('owl'), { id: 'owl', resolves_to: 'orchestrate-loop', status: 'compatibility' });
});

test('command aliases render primaries first, then cross-alias, then compatibility', () => {
  const aliases = [
    { id: 'legacy', resolves_to: 'route', status: 'compatibility' },
    { id: 'plan-quest', resolves_to: 'plan-task', status: 'primary' },
    { id: 'draft-contract', resolves_to: 'plan-task', status: 'cross-alias' }
  ];
  const lines = commandAliasSection(aliases).split('\n').filter((l) => l.startsWith('- '));
  assert.deepEqual(lines, [
    '- `/plan-quest` (`/plan-task`) [primary]; authority: `/plan-task`',
    '- `/draft-contract` -> `/plan-task` [cross-alias]; authority: `/plan-task`',
    '- `/legacy` -> `/route` [compatibility]; authority: `/route`'
  ]);
});

test('framework/skill/tool domains render as labelled subsections after commands', () => {
  const registry = {
    aliases: [{ id: 'plan-quest', resolves_to: 'plan-task', status: 'primary' }],
    framework_aliases: [
      { id: 'page-glamour', resolves_to: 'wordpress/page-cro', status: 'primary' },
      { id: 'cro', resolves_to: 'wordpress/page-cro', status: 'cross-alias' }
    ],
    skill_aliases: [{ id: 'awaken', resolves_to: 'extract-skill', status: 'primary' }],
    tool_aliases: [{ id: 'attune', resolves_to: 'sync-manifest', status: 'compatibility' }]
  };
  const section = commandAliasSection(registry);

  // command bullets keep the `/` prefix; domain bullets are bare names.
  assert.match(section, /- `\/plan-quest` \(`\/plan-task`\) \[primary\]/);
  assert.match(section, /### Framework aliases/);
  assert.match(section, /- `page-glamour` \(`wordpress\/page-cro`\) \[primary\]; authority: `wordpress\/page-cro`/);
  assert.match(section, /- `cro` -> `wordpress\/page-cro` \[cross-alias\]/);
  assert.match(section, /### Skill aliases/);
  assert.match(section, /- `awaken` \(`extract-skill`\) \[primary\]/);
  assert.match(section, /### Tool aliases/);
  assert.match(section, /- `attune` -> `sync-manifest` \[compatibility\]/);

  // ordering: commands, then framework, then skill, then tool.
  const iCmd = section.indexOf('/plan-quest');
  const iFw = section.indexOf('### Framework aliases');
  const iSk = section.indexOf('### Skill aliases');
  const iTl = section.indexOf('### Tool aliases');
  assert.ok(iCmd < iFw && iFw < iSk && iSk < iTl);
});

// ---------------------------------------------------------------------------
// Core doctrine
// ---------------------------------------------------------------------------

test('coreDoctrineSection gates on presence', () => {
  assert.equal(coreDoctrineSection(null), null);
  assert.equal(coreDoctrineSection(undefined), null);
  assert.equal(coreDoctrineSection(''), null);
  assert.equal(coreDoctrineSection('   \n  '), null);
  assert.equal(coreDoctrineSection('Guild law.'), '## The Core (doctrine)\n\nGuild law.');
});

test('loadCoreDoctrine reads the tracked canonical file, null when absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-doctrine-'));
  const kernelDir = path.join(dir, 'instructions', 'canonical', 'kernel');
  fs.mkdirSync(kernelDir, { recursive: true });
  assert.equal(loadCoreDoctrine(dir), null);
  fs.writeFileSync(path.join(kernelDir, 'doctrine.md'), 'Evidence, not intention.\n');
  assert.equal(loadCoreDoctrine(dir), 'Evidence, not intention.\n');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Zero-user-delta contract: the generator never reads user config
// ---------------------------------------------------------------------------

test('generator source never references $MYTHOS_HOME or user config', () => {
  const src = ['engine.js', 'render.js']
    .map((f) => fs.readFileSync(path.resolve(__dirname, '..', 'lib', f), 'utf8'))
    .join('\n');
  assert.doesNotMatch(src, /MYTHOS_HOME/);
  assert.doesNotMatch(src, /process\.env/);
  assert.doesNotMatch(src, /os\.homedir|userInfo\(|homedir\(/);
});

test('generation is byte-identical with and without MYTHOS_HOME set (zero-user-delta)', () => {
  // The static guarantee above is the real teeth and always runs. The full
  // generation A/B runs wherever framework manifests are present (the composed
  // tree in which shipped tests execute).
  const system = JSON.parse(fs.readFileSync(path.join(SURFACE_ROOT, 'instructions', 'canonical', 'system.yaml'), 'utf8'));
  const generatable = (system.frameworks || []).every((f) => fs.existsSync(path.join(SURFACE_ROOT, f.manifest)));
  if (!generatable) return;

  const gen = () => planOutputs(SURFACE_ROOT, { writeClaude: true })
    .outputs.map((o) => `${o.path} ${o.content}`).join('');

  const saved = process.env.MYTHOS_HOME;
  delete process.env.MYTHOS_HOME;
  const without = gen();

  const canary = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-canary-'));
  fs.writeFileSync(path.join(canary, 'aliases.yaml'), 'MYTHOS_CANARY_9f3e\n');
  fs.mkdirSync(path.join(canary, 'kernel'), { recursive: true });
  fs.writeFileSync(path.join(canary, 'kernel', 'identity.md'), 'MYTHOS_CANARY_9f3e\n');
  process.env.MYTHOS_HOME = canary;
  const withHome = gen();

  if (saved === undefined) delete process.env.MYTHOS_HOME; else process.env.MYTHOS_HOME = saved;
  fs.rmSync(canary, { recursive: true, force: true });

  assert.equal(without, withHome);
});
