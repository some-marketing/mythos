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
const { resolveCommandAlias } = require('../../commands/lib/command-aliases.cjs');

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
    aliases: [{
      id: 'dl',
      kind: 'operator_shorthand',
      target: 'deliberate',
      execution_target: 'orchestrate-loop',
      authority_source: 'orchestrate-loop'
    }],
    framework_aliases: { 'page-glamour': { resolves_to: 'wordpress/page-cro', status: 'primary' } }
  });
  assert.deepEqual(parseAliasRegistry(raw), {
    aliases: [{
      id: 'dl',
      kind: 'operator_shorthand',
      target: 'deliberate',
      execution_target: 'orchestrate-loop',
      authority_source: 'orchestrate-loop'
    }],
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

test('parseAliasRegistry preserves typed aliases in YAML sequence form', () => {
  const raw = [
    'aliases:',
    '    - id: dl # shorthand',
    '      kind: "operator # shorthand"',
    '      target: deliberate',
    '      execution_target: orchestrate-loop',
    '      authority_source: orchestrate-loop'
  ].join('\n');
  assert.deepEqual(parseAliasRegistry(raw).aliases, [{
    id: 'dl',
    kind: 'operator # shorthand',
    target: 'deliberate',
    execution_target: 'orchestrate-loop',
    authority_source: 'orchestrate-loop'
  }]);
});

test('parseAliasRegistry preserves indentationless YAML sequences', () => {
  const raw = [
    'aliases:',
    '- id: dl',
    '  target: deliberate',
    '  authority_source: orchestrate-loop'
  ].join('\n');
  assert.deepEqual(parseAliasRegistry(raw).aliases, [{
    id: 'dl',
    target: 'deliberate',
    authority_source: 'orchestrate-loop'
  }]);
});

test('parseAliasRegistry preserves sequence records with standalone dash markers', () => {
  const raw = [
    'aliases:',
    '  -',
    '    id: shortcut',
    '    target: route'
  ].join('\n');
  assert.deepEqual(parseAliasRegistry(raw).aliases, [{ id: 'shortcut', target: 'route' }]);
});

test('parseAliasRegistry preserves flow-style YAML sequence records', () => {
  const raw = [
    'aliases:',
    '  - { id: shortcut, target: route } # shorthand'
  ].join('\n');
  assert.deepEqual(parseAliasRegistry(raw).aliases, [{ id: 'shortcut', target: 'route' }]);
});

test('parseAliasRegistry preserves inline mappings in legacy map records', () => {
  const raw = [
    'aliases:',
    '  shortcut: { target: route } # shorthand'
  ].join('\n');
  assert.deepEqual(parseAliasRegistry(raw).aliases, [{ id: 'shortcut', target: 'route' }]);
});

test('loads the shipped typed command registry without losing target or authority', () => {
  const aliases = loadCommandAliases(SURFACE_ROOT);
  assert.equal(aliases.length, 10);
  assert.deepEqual(
    aliases.map((alias) => alias.id),
    ['owl', 'oa', 'council-of-owls', 'deliberate', 'dl', 'oc', 'help-me-route', 'blueprint', 'el', 'tt']
  );
  assert.ok(aliases.every((alias) => alias.id && alias.kind && alias.target && alias.authority_source));
  const byKind = (kind) => aliases.filter((alias) => alias.kind === kind).length;
  assert.equal(byKind('terminal_alias'), 5);
  assert.equal(byKind('conditional_expansion'), 2);
  assert.equal(byKind('operator_shorthand'), 3);

  const find = (id) => aliases.find((a) => a.id === id);
  assert.deepEqual(
    {
      id: find('owl').id,
      kind: find('owl').kind,
      target: find('owl').target,
      authority_source: find('owl').authority_source
    },
    { id: 'owl', kind: 'terminal_alias', target: 'orchestrate-loop', authority_source: 'orchestrate-loop' }
  );
  assert.deepEqual(
    {
      id: find('dl').id,
      kind: find('dl').kind,
      target: find('dl').target,
      execution_target: find('dl').execution_target,
      authority_source: find('dl').authority_source
    },
    {
      id: 'dl',
      kind: 'operator_shorthand',
      target: 'deliberate',
      execution_target: 'orchestrate-loop',
      authority_source: 'orchestrate-loop'
    }
  );
  assert.deepEqual(
    {
      id: find('tt').id,
      kind: find('tt').kind,
      target: find('tt').target,
      authority_source: find('tt').authority_source
    },
    { id: 'tt', kind: 'terminal_alias', target: 'ticktock', authority_source: 'ticktock' }
  );
});

test('typed aliases render their declared target, execution target, and authority', () => {
  const section = commandAliasSection({ aliases: [
    {
      id: 'dl',
      kind: 'operator_shorthand',
      target: 'deliberate',
      execution_target: 'orchestrate-loop',
      authority_source: 'orchestrate-loop'
    },
    {
      id: 'tt',
      kind: 'terminal_alias',
      target: 'ticktock',
      authority_source: 'ticktock'
    }
  ] });

  assert.match(section, /- `\/dl` -> `\/deliberate` \[operator_shorthand\]; execution: `\/orchestrate-loop`; authority: `\/orchestrate-loop`/);
  assert.match(section, /- `\/tt` -> `\/ticktock` \[terminal_alias\]; authority: `\/ticktock`/);
  assert.doesNotMatch(section, /\/undefined|`\/0`/);
});

test('mixed typed and legacy aliases retain resolved legacy authority', () => {
  const section = commandAliasSection({ aliases: [
    { id: 'dl', kind: 'operator_shorthand', target: 'deliberate', execution_target: 'orchestrate-loop', authority_source: 'orchestrate-loop' },
    { id: 'cast', resolves_to: 'run-framework', status: 'primary' },
    { id: 'spell', resolves_to: 'cast', status: 'cross-alias' }
  ] });
  assert.match(section, /- `\/spell` -> `\/cast` \[cross-alias\]; authority: `\/run-framework`/);
});

test('legacy alias authorities resolve transitively to their terminal', () => {
  const section = commandAliasSection([
    { id: 'cast', resolves_to: 'run-framework', status: 'primary' },
    { id: 'spell', resolves_to: 'cast', status: 'cross-alias' },
    { id: 'chant', resolves_to: 'spell', status: 'compatibility' }
  ]);
  assert.match(section, /- `\/chant` -> `\/spell` \[compatibility\]; authority: `\/run-framework`/);
});

test('runtime command resolution follows legacy aliases transitively and rejects cycles', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'command-alias-runtime-'));
  const registryPath = path.join(root, 'instructions', 'canonical', 'command-aliases.yaml');
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify({ aliases: [
    { id: 'cast', resolves_to: 'route' },
    { id: 'spell', resolves_to: 'cast' },
    { id: 'chant', resolves_to: 'spell' }
  ] }));

  const resolved = resolveCommandAlias(root, 'chant');
  assert.equal(resolved.resolvedCommand, 'spell');
  assert.equal(resolved.executionCommand, 'route');
  assert.equal(resolved.authoritySource, 'route');
  assert.deepEqual(resolved.expansionEdges, ['chant', 'spell', 'cast', 'route']);

  fs.writeFileSync(registryPath, 'aliases:\n  - id: shortcut\n    resolves_to: route\n');
  assert.equal(resolveCommandAlias(root, 'shortcut').executionCommand, 'route');

  fs.writeFileSync(registryPath, 'aliases:\n  - id: one\n    resolves_to: two\n  - id: two\n    resolves_to: one\n');
  assert.throws(() => resolveCommandAlias(root, 'one'), /Command alias cycle detected: one -> two -> one/);
  fs.rmSync(root, { recursive: true, force: true });
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
