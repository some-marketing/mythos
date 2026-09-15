'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildCandidates,
  clearGeneratedProjectionArtifacts,
  normalizeDirectSkill,
  parseFrontmatter,
  resolveAliases,
  sync
} = require('../sync-codex-skills.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const ALLOWED_FRONTMATTER = new Set(['name', 'description', 'license', 'metadata', 'allowed-tools']);

function sha256ForTest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function write(root, rel, content) {
  const target = path.join(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-projector-'));
  const config = {
    schema: 'CodexSkillProjectionConfig/1.0',
    generator_id: 'test-projector/1',
    generator: 'tools/skills/sync-codex-skills.cjs',
    handler_registry: 'tools/commands/mythos-command-runner.cjs',
    alias_registry: 'instructions/canonical/command-aliases.yaml',
    candidate_root: '_dev/reports/analysis/codex-skill-projections',
    target_root: '.agents/skills',
    allowed_frontmatter_keys: [...ALLOWED_FRONTMATTER],
    families: {
      canonical_commands: { source_root: 'instructions/canonical/commands', target_prefix: 'source-command-', semantic_review_state: 'reviewed_safe', default_capability_tier: 'ADVISORY' },
      direct_system_skills: { source_root: '.claude/skills', semantic_review_state: 'reviewed_safe', sources: ['.claude/skills/ticktock/SKILL.md', '.claude/skills/outward-inward-loop/SKILL.md'] },
      aliases: { application: 'target_metadata_only', semantic_review_state: 'reviewed_safe' },
      framework_helpers: { source_pattern: 'frameworks/*/*/.claude/skills/**/SKILL.md', target_prefix: 'guild-', semantic_review_state: 'pending_review' }
    },
    command_overrides: {
      'ground-in-philosophy': {
        capability_tier: 'ADVISORY',
        semantic_review_state: 'reviewed_safe',
        codex_execution: 'Dispatch the registered philosophy-grounding role; stop UNKNOWN if unavailable.',
        forbidden_source_fragments: ['Pi cannot natively spawn sub-agents', 'manual grounding (pi harness']
      }
    }
  };
  write(root, 'instructions/adapters/codex.yaml', `${JSON.stringify({ managed_commands: ['/managed'], skill_projection: config }, null, 2)}\n`);
  write(root, 'instructions/canonical/command-aliases.yaml', `${JSON.stringify({ aliases: [] }, null, 2)}\n`);
  return root;
}

function command(root, id, extra = {}) {
  return write(root, `instructions/canonical/commands/${id}.yaml`, `${JSON.stringify({ id, description: `${id} command`, mode: 'REVIEW_ONLY', ...extra }, null, 2)}\n`);
}

function skill(root, name, body = '<skill>body</skill>\n') {
  return write(root, `.claude/skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: ${name} description\nversion: 9\ntags: [legacy]\n---\n${body}`);
}

function byId(result, id) {
  return result.candidates.find((candidate) => candidate.id === id);
}

test('repo pins only Codex-supported projection frontmatter keys', () => {
  const adapter = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'instructions', 'adapters', 'codex.yaml'), 'utf8'));
  assert.deepEqual(new Set(adapter.skill_projection.allowed_frontmatter_keys), ALLOWED_FRONTMATTER);
  const normalized = normalizeDirectSkill('---\nname: old\ndescription: demo\nversion: 1\ntags: [x]\n---\nbody\n', 'new');
  assert.equal(normalized.ok, true);
  const parsed = parseFrontmatter(normalized.content);
  assert.deepEqual(new Set(Object.keys(parsed.metadata)), new Set(['name', 'description']));

  const bounded = normalizeDirectSkill('---\nname: old\ndescription: demo\nexecution_mode: COORDINATOR\ntrust_tier: report_write_scoped\n---\nbody\n', 'new');
  assert.equal(bounded.ok, true);
  assert.match(bounded.content, /metadata:\n  execution_mode: "COORDINATOR"\n  trust_tier: "report_write_scoped"/);

  const toolBounded = normalizeDirectSkill('---\nname: old\ndescription: demo\nlicense: MIT\ncompatibility: Codex\nallowed-tools: Read\n---\nbody\n', 'new');
  assert.equal(toolBounded.ok, true);
  assert.match(toolBounded.content, /license: "MIT"/);
  assert.doesNotMatch(toolBounded.content, /compatibility:/);
  assert.match(toolBounded.content, /allowed-tools: "Read"/);

  const listBounded = normalizeDirectSkill('---\nname: old\ndescription: demo\nallowed-tools:\n  - Read\n  - "Bash(ls *)"\n---\nbody\n', 'new');
  assert.equal(listBounded.ok, true);
  assert.match(listBounded.content, /allowed-tools: \["Read","Bash\(ls \*\)"\]/);
  assert.deepEqual(parseFrontmatter(listBounded.content).metadata['allowed-tools'], ['Read', 'Bash(ls *)']);
});

test('frontmatter parsing accepts and normalizes CRLF line endings', () => {
  const parsed = parseFrontmatter('---\r\nname: demo\r\ndescription: demo\r\n---\r\nbody\r\n');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.metadata.name, 'demo');
  assert.equal(parsed.body, 'body\n');
});

test('frontmatter parsing removes YAML comments without corrupting quoted hashes', () => {
  const normalized = normalizeDirectSkill('---\nname: demo\ndescription: "demo # retained"\nexecution_mode: REVIEW_ONLY # no writes\ntrust_tier: report_only # bounded\n---\nbody\n', 'demo');
  assert.equal(normalized.ok, true);
  assert.match(normalized.content, /description: "demo # retained"/);
  assert.match(normalized.content, /execution_mode: "REVIEW_ONLY"/);
  assert.match(normalized.content, /trust_tier: "report_only"/);
  assert.doesNotMatch(normalized.content, /no writes|bounded/);
});

test('frontmatter parsing decodes quoted YAML scalar escapes', () => {
  const doubleQuoted = parseFrontmatter('---\nname: demo\ndescription: "Run \\"quoted\\" task"\n---\nbody\n');
  assert.equal(doubleQuoted.metadata.description, 'Run "quoted" task');
  const singleQuoted = parseFrontmatter("---\nname: demo\ndescription: 'It''s safe'\n---\nbody\n");
  assert.equal(singleQuoted.metadata.description, "It's safe");
});

test('direct descriptions replace angle brackets rejected by Codex validation', () => {
  const normalized = normalizeDirectSkill('---\nname: demo\ndescription: Run <task> safely\n---\nbody\n', 'demo');
  assert.equal(normalized.ok, true);
  assert.match(normalized.content, /description: "Run \(task\) safely"/);
  assert.doesNotMatch(normalized.content, /<task>/);
});

test('direct skills reject non-scalar and unknown execution modes', () => {
  for (const mode of ['execution_mode:\n  - REVIEW_ONLY\n  - PATCH_ALLOWED', 'execution_mode: SUPERUSER']) {
    const normalized = normalizeDirectSkill(`---\nname: demo\ndescription: demo\n${mode}\n---\nbody\n`, 'demo');
    assert.equal(normalized.ok, false);
    assert.match(normalized.error, /execution_mode must be one declared execution mode/);
  }
});

test('handler registry loading rejects traversal and external symlinks before require', () => {
  const traversalRoot = fixture();
  const traversalAdapterPath = path.join(traversalRoot, 'instructions/adapters/codex.yaml');
  const traversalAdapter = JSON.parse(fs.readFileSync(traversalAdapterPath, 'utf8'));
  const outsideName = `${path.basename(traversalRoot)}-handler.cjs`;
  traversalAdapter.skill_projection.handler_registry = `../${outsideName}`;
  fs.writeFileSync(traversalAdapterPath, `${JSON.stringify(traversalAdapter, null, 2)}\n`);
  fs.writeFileSync(path.join(traversalRoot, '..', outsideName), 'module.exports = { HANDLERS: {} };\n');
  assert.throws(() => buildCandidates({ root: traversalRoot }), /Refusing handler registry outside repository/);

  const symlinkRoot = fixture();
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'external-handler-'));
  const externalHandler = write(externalRoot, 'handler.cjs', 'module.exports = { HANDLERS: {} };\n');
  const handlerPath = path.join(symlinkRoot, 'tools/commands/mythos-command-runner.cjs');
  fs.mkdirSync(path.dirname(handlerPath), { recursive: true });
  fs.symlinkSync(externalHandler, handlerPath);
  assert.throws(() => buildCandidates({ root: symlinkRoot }), /Refusing symbolic-link handler registry source/);
});

test('alias registry loading rejects traversal and external symlinks before reading', () => {
  const traversalRoot = fixture();
  const traversalAdapterPath = path.join(traversalRoot, 'instructions/adapters/codex.yaml');
  const traversalAdapter = JSON.parse(fs.readFileSync(traversalAdapterPath, 'utf8'));
  const outsideName = `${path.basename(traversalRoot)}-aliases.json`;
  traversalAdapter.skill_projection.alias_registry = `../${outsideName}`;
  fs.writeFileSync(traversalAdapterPath, `${JSON.stringify(traversalAdapter, null, 2)}\n`);
  fs.writeFileSync(path.join(traversalRoot, '..', outsideName), '{"aliases":[]}\n');
  assert.throws(() => buildCandidates({ root: traversalRoot, handlerIds: new Set() }), /Refusing alias registry outside repository/);

  const symlinkRoot = fixture();
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'external-aliases-'));
  const externalRegistry = write(externalRoot, 'aliases.json', '{"aliases":[]}\n');
  const registryPath = path.join(symlinkRoot, 'instructions/canonical/command-aliases.yaml');
  fs.unlinkSync(registryPath);
  fs.symlinkSync(externalRegistry, registryPath);
  assert.throws(() => buildCandidates({ root: symlinkRoot, handlerIds: new Set() }), /Refusing symbolic-link alias registry source/);
});

test('Codex adapter loading rejects external symlinks before reading', () => {
  const root = fixture();
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'external-adapter-'));
  const externalAdapter = write(externalRoot, 'codex.yaml', '{"skill_projection":null}\n');
  const adapterPath = path.join(root, 'instructions/adapters/codex.yaml');
  fs.unlinkSync(adapterPath);
  fs.symlinkSync(externalAdapter, adapterPath);
  assert.throws(() => buildCandidates({ root, handlerIds: new Set() }), /Refusing symbolic-link Codex adapter source/);
});

test('ground-in-philosophy uses the explicit Codex override and rejects Pi fallback text', () => {
  const root = fixture();
  command(root, 'ground-in-philosophy', { objective: 'Pi cannot natively spawn sub-agents', process: ['manual grounding (pi harness — no sub-agent)'] });
  const candidate = byId(buildCandidates({ root, handlerIds: new Set() }), 'command-ground-in-philosophy');
  assert.equal(candidate.receipt.capability_tier, 'ADVISORY');
  assert.equal(candidate.receipt.semantic_review_state, 'reviewed_safe');
  assert.doesNotMatch(candidate.content, /Pi cannot|manual grounding \(pi harness/i);
  assert.match(candidate.content, /registered philosophy-grounding role/);
});

test('HANDLERS evidence alone marks deterministic capability BLOCKING', () => {
  const root = fixture();
  command(root, 'managed');
  command(root, 'handled');
  const result = buildCandidates({ root, handlerIds: new Set(['handled']) });
  assert.equal(byId(result, 'command-managed').receipt.capability_tier, 'ADVISORY');
  assert.equal(byId(result, 'command-handled').receipt.capability_tier, 'BLOCKING');
  assert.doesNotMatch(byId(result, 'command-handled').content, /\$ARGUMENTS/);
  assert.match(byId(result, 'command-handled').content, /actual invocation arguments/);
});

test('alias cycles and nonterminal aliases remain UNKNOWN and unapplied', () => {
  const root = fixture();
  command(root, 'terminal');
  const aliases = { aliases: [
    { id: 'a', target: 'b' },
    { id: 'b', target: 'a' },
    { id: 'lost', target: 'missing' }
  ] };
  const result = buildCandidates({ root, handlerIds: new Set(), aliasRegistry: aliases });
  assert.equal(byId(result, 'alias-a').receipt.capability_tier, 'UNKNOWN');
  assert.match(byId(result, 'alias-a').receipt.detail, /alias_cycle/);
  assert.match(byId(result, 'alias-lost').receipt.detail, /nonterminal_alias/);
});

test('typed aliases with canonical workflows retain their own runtime pointer', () => {
  const root = fixture();
  command(root, 'orchestrate-loop');
  command(root, 'deliberate', { objective: 'Reason solo, convene, and synthesize before routing.' });
  const aliases = { aliases: [{ id: 'deliberate', target: 'orchestrate-loop', authority_source: 'orchestrate-loop' }] };
  const result = buildCandidates({ root, handlerIds: new Set(), aliasRegistry: aliases });
  const typed = byId(result, 'command-deliberate');
  const terminal = byId(result, 'command-orchestrate-loop');
  assert.match(typed.content, /instructions\/canonical\/commands\/deliberate\.yaml/);
  assert.match(typed.content, /Canonical behavioral authority: `instructions\/canonical\/commands\/orchestrate-loop\.yaml`/);
  assert.doesNotMatch(terminal.content, /Aliases resolved at generation time: \/deliberate/);
  assert.equal(byId(result, 'alias-deliberate').receipt.target_exact_path, '.agents/skills/source-command-deliberate/SKILL.md');
});

test('typed aliases reject missing canonical authority sources', () => {
  const root = fixture();
  command(root, 'wrapper');
  command(root, 'orchestrate-loop');
  const aliases = { aliases: [{ id: 'wrapper', target: 'orchestrate-loop', authority_source: 'missing-authority' }] };
  assert.throws(
    () => buildCandidates({ root, handlerIds: new Set(), aliasRegistry: aliases }),
    /Alias authority source is not a canonical command: missing-authority/
  );
});

test('handler-backed typed aliases retain their wrapper and deterministic execution', () => {
  const root = fixture();
  command(root, 'route');
  command(root, 'help-me-route');
  const aliases = { aliases: [{ id: 'help-me-route', target: 'route' }] };
  const result = buildCandidates({ root, handlerIds: new Set(['route']), aliasRegistry: aliases });
  const wrapper = byId(result, 'command-help-me-route');
  assert.equal(wrapper.receipt.capability_tier, 'BLOCKING');
  assert.match(wrapper.content, /actual invocation arguments/);
  assert.equal(byId(result, 'alias-help-me-route').receipt.target_exact_path, '.agents/skills/source-command-help-me-route/SKILL.md');
  assert.equal(byId(result, 'alias-help-me-route').receipt.capability_tier, 'BLOCKING');
});

test('canonical command identity is keyed by filename and mismatches never replace another command', () => {
  const root = fixture();
  command(root, 'alpha');
  write(root, 'instructions/canonical/commands/beta.yaml', `${JSON.stringify({ id: 'alpha', description: 'mismatch', mode: 'REVIEW_ONLY' }, null, 2)}\n`);
  const result = buildCandidates({ root, handlerIds: new Set() });
  assert.equal(byId(result, 'command-alpha').receipt.semantic_review_state, 'reviewed_safe');
  const mismatch = byId(result, 'command-beta');
  assert.equal(mismatch.receipt.application_status, 'blocked_malformed');
  assert.equal(mismatch.receipt.detail, 'canonical id mismatch for filename "beta"');
  assert.doesNotMatch(mismatch.receipt.detail, /alpha/);
  assert.equal(result.candidates.filter((candidate) => candidate.id === 'command-alpha').length, 1);
});

test('duplicate canonical command basenames are preserved as blocked collision evidence', () => {
  const root = fixture();
  command(root, 'sample');
  write(root, 'instructions/canonical/commands/nested/sample.yaml', '{"id":"sample","description":"nested","mode":"REVIEW_ONLY"}\n');
  const result = sync({ root, handlerIds: new Set(), apply: true });
  const duplicates = result.candidates.filter((candidate) => candidate.receipt.projection_kind === 'canonical_command'
    && candidate.receipt.target_exact_path === '.agents/skills/source-command-sample/SKILL.md');
  assert.equal(duplicates.length, 2);
  assert.equal(new Set(duplicates.map((candidate) => candidate.id)).size, 2);
  assert.equal(duplicates.every((candidate) => candidate.receipt.collision_state === 'collision'), true);
  assert.equal(duplicates.every((candidate) => candidate.receipt.semantic_review_state === 'collision_rejected'), true);
  assert.equal(fs.existsSync(path.join(root, '.agents/skills/source-command-sample/SKILL.md')), false);
});

test('unique nested canonical commands are blocked because runtime authority is top-level', () => {
  const root = fixture();
  write(root, 'instructions/canonical/commands/nested/sample.yaml', '{"id":"sample","description":"nested","mode":"REVIEW_ONLY"}\n');
  const result = sync({ root, handlerIds: new Set(), apply: true });
  const candidate = byId(result, 'command-sample');
  assert.equal(candidate.content, null);
  assert.equal(candidate.receipt.capability_tier, 'UNKNOWN');
  assert.equal(candidate.receipt.semantic_review_state, 'malformed');
  assert.match(candidate.receipt.detail, /nested canonical command path rejected/);
  assert.equal(fs.existsSync(path.join(root, '.agents/skills/source-command-sample/SKILL.md')), false);
});

test('canonical JSON parse errors are sanitized before entering receipts', () => {
  const root = fixture();
  const secret = `sk-${'z'.repeat(24)}`;
  write(root, 'instructions/canonical/commands/broken.yaml', `{"id":"broken","secret":"${secret}"`);
  const candidate = byId(buildCandidates({ root, handlerIds: new Set() }), 'command-broken');
  assert.match(candidate.receipt.detail, /^invalid JSON(?: at (?:line|position))/);
  assert.doesNotMatch(JSON.stringify(candidate.receipt), /sk-zzzz/);
});

test('non-object canonical documents stage as malformed instead of aborting', () => {
  for (const document of ['null', '[]']) {
    const root = fixture();
    write(root, 'instructions/canonical/commands/broken.yaml', `${document}\n`);
    const candidate = byId(sync({ root, handlerIds: new Set(), apply: true }), 'command-broken');
    assert.equal(candidate.content, null);
    assert.equal(candidate.receipt.semantic_review_state, 'malformed');
    assert.equal(candidate.receipt.application_status, 'blocked_malformed');
    assert.match(candidate.receipt.detail, /canonical command document must be an object/);
    assert.equal(fs.existsSync(path.join(root, '.agents/skills/source-command-broken/SKILL.md')), false);
  }
});

test('canonical rendered content is rejected without retaining private or credential bytes', () => {
  const root = fixture();
  const secret = `sk-${'q'.repeat(24)}`;
  command(root, 'sample', { description: `credential ${secret}` });
  const candidate = byId(sync({ root, handlerIds: new Set(), apply: true }), 'command-sample');
  assert.equal(candidate.content, null);
  assert.equal(candidate.receipt.semantic_review_state, 'private_path_rejected');
  assert.equal(candidate.receipt.source_sha256, null);
  assert.equal(fs.existsSync(path.join(root, '.agents/skills/source-command-sample/SKILL.md')), false);
  assert.doesNotMatch(JSON.stringify(candidate.receipt), /sk-qqqq/);
});

test('credential-bearing canonical paths are rejected before identifiers or receipts are staged', () => {
  const root = fixture();
  const token = `sk-${'k'.repeat(24)}`;
  command(root, token);
  assert.throws(
    () => sync({ root, handlerIds: new Set() }),
    (error) => /Refusing private or credential-bearing canonical command path/.test(error.message) && !error.message.includes(token)
  );
  assert.equal(fs.existsSync(path.join(root, '_dev/reports/analysis/codex-skill-projections/candidates')), false);
  assert.equal(fs.existsSync(path.join(root, '_dev/reports/analysis/codex-skill-projections/receipts')), false);
});

test('canonical projections exceeding the Codex skill-name limit are blocked', () => {
  const root = fixture();
  const id = 'x'.repeat(50);
  command(root, id);
  const result = sync({ root, handlerIds: new Set(), apply: true });
  const candidate = byId(result, `command-${id}`);
  assert.equal(candidate.receipt.semantic_review_state, 'malformed');
  assert.equal(candidate.receipt.application_status, 'blocked_malformed');
  assert.match(candidate.receipt.detail, /exceeds 64 characters/);
  assert.equal(fs.existsSync(path.join(root, `.agents/skills/source-command-${id}/SKILL.md`)), false);
});

test('canonical projections honor the configured target prefix', () => {
  const root = fixture();
  const adapterPath = path.join(root, 'instructions/adapters/codex.yaml');
  const adapter = JSON.parse(fs.readFileSync(adapterPath, 'utf8'));
  adapter.skill_projection.families.canonical_commands.target_prefix = 'cmd-';
  fs.writeFileSync(adapterPath, `${JSON.stringify(adapter, null, 2)}\n`);
  command(root, 'sample');
  const candidate = byId(sync({ root, handlerIds: new Set(), apply: true }), 'command-sample');
  assert.equal(candidate.receipt.target_exact_path, '.agents/skills/cmd-sample/SKILL.md');
  assert.match(candidate.content, /^---\nname: cmd-sample\n/);
  assert.equal(fs.existsSync(path.join(root, '.agents/skills/cmd-sample/SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(root, '.agents/skills/source-command-sample/SKILL.md')), false);
});

test('projection application and custody honor the configured target root', () => {
  const root = fixture();
  const adapterPath = path.join(root, 'instructions/adapters/codex.yaml');
  const adapter = JSON.parse(fs.readFileSync(adapterPath, 'utf8'));
  adapter.skill_projection.target_root = '.codex/skills';
  fs.writeFileSync(adapterPath, `${JSON.stringify(adapter, null, 2)}\n`);
  command(root, 'sample');
  const applied = sync({ root, handlerIds: new Set(), apply: true });
  const candidate = byId(applied, 'command-sample');
  assert.equal(candidate.receipt.target_exact_path, '.codex/skills/source-command-sample/SKILL.md');
  assert.equal(fs.existsSync(path.join(root, '.codex/skills/source-command-sample/SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(root, '.codex/skills/.codex/skills/source-command-sample/SKILL.md')), false);
  const ledger = JSON.parse(fs.readFileSync(path.join(root, '_dev/reports/analysis/codex-skill-projections/managed-targets.json'), 'utf8'));
  assert.deepEqual(ledger.targets, ['.codex/skills/source-command-sample/SKILL.md']);
  assert.equal(sync({ root, handlerIds: new Set(), check: true }).drift, 0);
});

test('canonical descriptions replace angle brackets rejected by Codex validation', () => {
  const root = fixture();
  command(root, 'sample', { description: 'Run <task> safely' });
  const candidate = byId(buildCandidates({ root, handlerIds: new Set() }), 'command-sample');
  assert.match(candidate.content, /description: "Run \(task\) safely"/);
  assert.doesNotMatch(candidate.content, /<task>/);
});

test('overlong projected descriptions are blocked across projection families', () => {
  const description = 'x'.repeat(1025);
  assert.match(normalizeDirectSkill(`---\nname: demo\ndescription: ${description}\n---\nbody\n`, 'demo').error, /exceeds 1024 characters/);

  const root = fixture();
  command(root, 'sample', { description });
  write(root, 'frameworks/a/b/.claude/skills/demo/SKILL.md', `---\nname: demo\ndescription: ${description}\n---\nbody\n`);
  const result = buildCandidates({ root, handlerIds: new Set() });
  const canonical = byId(result, 'command-sample');
  const framework = result.candidates.find((candidate) => candidate.receipt.projection_kind === 'framework_helper');
  assert.equal(canonical.content, null);
  assert.match(canonical.receipt.detail, /exceeds 1024 characters/);
  assert.equal(framework.content, null);
  assert.match(framework.receipt.detail, /exceeds 1024 characters/);
});

test('credential-bearing direct paths are rejected before identifiers or receipts are staged', () => {
  const root = fixture();
  const token = `sk-${'d'.repeat(24)}`;
  const adapterPath = path.join(root, 'instructions/adapters/codex.yaml');
  const adapter = JSON.parse(fs.readFileSync(adapterPath, 'utf8'));
  adapter.skill_projection.families.direct_system_skills.sources.push(`.claude/skills/${token}/SKILL.md`);
  fs.writeFileSync(adapterPath, `${JSON.stringify(adapter, null, 2)}\n`);
  skill(root, token);
  assert.throws(
    () => sync({ root, handlerIds: new Set() }),
    (error) => /credential-bearing direct skill path/.test(error.message) && !error.message.includes(token)
  );
  assert.equal(fs.existsSync(path.join(root, '_dev/reports/analysis/codex-skill-projections')), false);
});

test('direct projections exceeding the Codex skill-name limit are blocked', () => {
  const root = fixture();
  const name = 'x'.repeat(65);
  const adapterPath = path.join(root, 'instructions/adapters/codex.yaml');
  const adapter = JSON.parse(fs.readFileSync(adapterPath, 'utf8'));
  adapter.skill_projection.families.direct_system_skills.sources.push(`.claude/skills/${name}/SKILL.md`);
  fs.writeFileSync(adapterPath, `${JSON.stringify(adapter, null, 2)}\n`);
  skill(root, name);
  const result = sync({ root, handlerIds: new Set(), apply: true });
  const candidate = byId(result, `direct-${name}`);
  assert.equal(candidate.receipt.semantic_review_state, 'malformed');
  assert.equal(candidate.receipt.application_status, 'blocked');
  assert.match(candidate.receipt.detail, /exceeds 64 characters/);
  assert.equal(fs.existsSync(path.join(root, `.agents/skills/${name}/SKILL.md`)), false);
});

test('unsafe canonical and alias IDs cannot construct projection output paths', () => {
  const root = fixture();
  const privateId = ['', 'Users', 'private-operator', 'escape'].join('/');
  write(root, 'instructions/canonical/commands/safe.yaml', `${JSON.stringify({ id: privateId, description: 'unsafe', mode: 'REVIEW_ONLY' }, null, 2)}\n`);
  const malformed = byId(buildCandidates({ root, handlerIds: new Set() }), 'command-safe');
  assert.equal(malformed.receipt.application_status, 'blocked_malformed');
  assert.equal(malformed.receipt.detail, 'invalid canonical id for filename "safe"');
  assert.doesNotMatch(JSON.stringify(malformed.receipt), /private-operator/);

  const aliases = { aliases: [{ id: 'x/../../../../sentinel', target: 'safe' }] };
  assert.throws(() => sync({ root, handlerIds: new Set(), aliasRegistry: aliases }), /Invalid alias id/);
  assert.equal(fs.existsSync(path.join(root, 'sentinel.json')), false);
});

test('credential-bearing alias routing fields are rejected before projection evidence', () => {
  for (const field of ['id', 'target']) {
    const root = fixture();
    skill(root, 'ticktock');
    const token = `sk-${'r'.repeat(24)}`;
    const alias = field === 'id' ? { id: token, target: 'ticktock' } : { id: 'safe', target: token };
    assert.throws(
      () => sync({ root, handlerIds: new Set(), aliasRegistry: { aliases: [alias] } }),
      (error) => /credential-bearing alias routing field/.test(error.message) && !error.message.includes(token)
    );
    assert.equal(fs.existsSync(path.join(root, '_dev/reports/analysis/codex-skill-projections')), false);
  }
});

test('direct skills and aliases remain unavailable while a required dependency is absent', () => {
  const root = fixture();
  const adapterPath = path.join(root, 'instructions/adapters/codex.yaml');
  const adapter = JSON.parse(fs.readFileSync(adapterPath, 'utf8'));
  adapter.skill_projection.families.direct_system_skills.sources.push('.claude/skills/meditate/SKILL.md');
  adapter.skill_projection.families.direct_system_skills.dependencies = { ticktock: ['meditate'] };
  fs.writeFileSync(adapterPath, `${JSON.stringify(adapter, null, 2)}\n`);
  skill(root, 'ticktock');
  const aliases = { aliases: [{ id: 'tt', target: 'ticktock' }] };
  const result = sync({ root, handlerIds: new Set(), aliasRegistry: aliases, apply: true });
  const ticktock = byId(result, 'direct-ticktock');
  const tt = byId(result, 'alias-tt');
  assert.equal(ticktock.receipt.capability_tier, 'ABSENT');
  assert.equal(ticktock.receipt.application_status, 'blocked_dependency');
  assert.match(ticktock.receipt.detail, /meditate/);
  assert.equal(tt.receipt.capability_tier, 'ABSENT');
  assert.equal(tt.receipt.application_status, 'blocked_target_unavailable');
  assert.equal(fs.existsSync(path.join(root, '.agents/skills/ticktock/SKILL.md')), false);
});

test('tt, oil, and chi resolve across the command boundary to direct project skills', () => {
  const root = fixture();
  skill(root, 'ticktock');
  skill(root, 'outward-inward-loop');
  const aliases = { aliases: [
    { id: 'tt', target: 'ticktock' },
    { id: 'oil', target: 'outward-inward-loop' },
    { id: 'chi', target: 'oil' }
  ] };
  const result = buildCandidates({ root, handlerIds: new Set(), aliasRegistry: aliases });
  assert.equal(byId(result, 'alias-tt').receipt.target_exact_path, '.agents/skills/ticktock/SKILL.md');
  assert.equal(byId(result, 'alias-oil').receipt.target_exact_path, '.agents/skills/outward-inward-loop/SKILL.md');
  assert.equal(byId(result, 'alias-chi').receipt.target_exact_path, '.agents/skills/outward-inward-loop/SKILL.md');
  assert.match(byId(result, 'direct-outward-inward-loop').content, /Aliases: \/chi, \/oil/);
});

test('framework namespace collisions are rejected', () => {
  const root = fixture();
  write(root, 'frameworks/a/b/.claude/skills/x-y/SKILL.md', '---\nname: x-y\ndescription: first\n---\nbody\n');
  write(root, 'frameworks/a/b/.claude/skills/x/y/SKILL.md', '---\nname: y\ndescription: second\n---\nbody\n');
  const colliding = buildCandidates({ root, handlerIds: new Set() }).candidates.filter((item) => item.id.startsWith('framework-'));
  assert.equal(colliding.length, 2);
  assert.equal(colliding.every((item) => item.receipt.collision_state === 'collision'), true);
  assert.equal(colliding.every((item) => item.receipt.capability_tier === 'UNKNOWN'), true);
  assert.equal(new Set(colliding.map((item) => item.id)).size, 2);
  const staged = sync({ root, handlerIds: new Set() });
  const stagedCollisions = staged.candidates.filter((item) => item.receipt.collision_state === 'collision');
  assert.equal(new Set(staged.index.receipts).size, staged.index.receipts.length);
  for (const candidate of stagedCollisions) {
    assert.equal(fs.existsSync(path.join(staged.candidateDir, 'receipts', `${candidate.id}.json`)), true);
    assert.equal(fs.existsSync(path.join(staged.candidateDir, 'candidates', candidate.id, 'SKILL.md')), true);
  }
});

test('credential-bearing framework source paths are rejected without retaining their bytes', () => {
  const root = fixture();
  const token = `sk-${'e'.repeat(24)}`;
  write(root, `frameworks/a/b/.claude/skills/${token}/SKILL.md`, '---\nname: safe\ndescription: safe\n---\nbody\n');
  assert.throws(
    () => sync({ root, handlerIds: new Set() }),
    (error) => /credential-bearing framework skill path/.test(error.message) && !error.message.includes(token)
  );
  assert.equal(fs.existsSync(path.join(root, '_dev/reports/analysis/codex-skill-projections')), false);
});

test('blocked framework candidates still participate in target collision rejection', () => {
  const root = fixture();
  write(root, 'frameworks/a/b/.claude/skills/x-y/SKILL.md', '---\nname: x-y\ndescription: valid\n---\nbody\n');
  write(root, 'frameworks/a/b/.claude/skills/x/y/SKILL.md', 'malformed\n');
  const result = sync({ root, handlerIds: new Set(), apply: true });
  const colliding = result.candidates.filter((item) => item.receipt.projection_kind === 'framework_helper');
  assert.equal(colliding.length, 2);
  assert.equal(colliding.every((item) => item.receipt.collision_state === 'collision'), true);
  assert.equal(new Set(colliding.map((item) => item.id)).size, 2);
  assert.equal(fs.existsSync(path.join(root, '.agents/skills/guild-a-b-x-y/SKILL.md')), false);
});

test('sequence-valued framework names and descriptions produce malformed receipts', () => {
  const root = fixture();
  write(root, 'frameworks/a/b/.claude/skills/helper/SKILL.md', '---\nname: helper\ndescription:\n  - invalid\n---\nbody\n');
  const result = sync({ root, handlerIds: new Set(), apply: true });
  const candidate = byId(result, 'framework-guild-a-b-helper');
  assert.equal(candidate.receipt.semantic_review_state, 'malformed');
  assert.equal(candidate.receipt.application_status, 'blocked');
  assert.equal(fs.existsSync(path.join(root, '.agents/skills/guild-a-b-helper/SKILL.md')), false);
});

test('framework helpers reject non-scalar and unknown execution modes', () => {
  for (const mode of ['execution_mode:\n  - REVIEW_ONLY\n  - PATCH_ALLOWED', 'execution_mode: SUPERUSER']) {
    const root = fixture();
    write(root, 'frameworks/a/b/.claude/skills/helper/SKILL.md', `---\nname: helper\ndescription: helper\n${mode}\n---\nbody\n`);
    const candidate = byId(sync({ root, handlerIds: new Set(), apply: true }), 'framework-guild-a-b-helper');
    assert.equal(candidate.receipt.semantic_review_state, 'malformed');
    assert.match(candidate.receipt.detail, /execution_mode must be one declared execution mode/);
    assert.equal(fs.existsSync(path.join(root, '.agents/skills/guild-a-b-helper/SKILL.md')), false);
  }
});

test('nested framework skills project independently instead of becoming parent resources', () => {
  const root = fixture();
  write(root, 'frameworks/a/b/.claude/skills/parent/SKILL.md', '---\nname: parent\ndescription: parent\n---\nbody\n');
  write(root, 'frameworks/a/b/.claude/skills/parent/reference.md', 'parent reference\n');
  write(root, 'frameworks/a/b/.claude/skills/parent/child/SKILL.md', '---\nname: child\ndescription: child\n---\nbody\n');
  write(root, 'frameworks/a/b/.claude/skills/parent/child/reference.md', 'child reference\n');
  const result = buildCandidates({ root, handlerIds: new Set() });
  const parent = byId(result, 'framework-guild-a-b-parent');
  const child = byId(result, 'framework-guild-a-b-parent-child');
  assert.deepEqual(parent.resources.map((resource) => resource.relativePath), ['reference.md']);
  assert.deepEqual(child.resources.map((resource) => resource.relativePath), ['reference.md']);
});

test('malformed metadata and private absolute paths stage but never apply', () => {
  const root = fixture();
  write(root, '.claude/skills/ticktock/SKILL.md', 'no frontmatter\n');
  const privateFixturePath = ['', 'Users', 'private', 'work', 'file'].join('/');
  write(root, '.claude/skills/outward-inward-loop/SKILL.md', `---\nname: outward-inward-loop\ndescription: secret ${privateFixturePath}\n---\nbody\n`);
  const result = sync({ root, handlerIds: new Set(), apply: true });
  assert.equal(byId(result, 'direct-ticktock').receipt.semantic_review_state, 'malformed');
  assert.equal(byId(result, 'direct-outward-inward-loop').receipt.semantic_review_state, 'private_path_rejected');
  assert.equal(byId(result, 'direct-outward-inward-loop').receipt.source_sha256, null);
  assert.equal(byId(result, 'direct-outward-inward-loop').receipt.package_sha256, null);
  assert.deepEqual(byId(result, 'direct-outward-inward-loop').resources, []);
  assert.equal(fs.existsSync(path.join(root, '.agents/skills/ticktock/SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(root, '.agents/skills/outward-inward-loop/SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(root, '_dev/reports/analysis/codex-skill-projections/candidates/outward-inward-loop/SKILL.md')), false);
});

test('assignment-form home paths are rejected without retaining private bytes', () => {
  const root = fixture();
  const privatePath = ['', 'home', 'private-operator', 'workspace'].join('/');
  skill(root, 'ticktock', `WORKDIR=${privatePath}\n`);
  const result = sync({ root, handlerIds: new Set(), apply: true });
  const candidate = byId(result, 'direct-ticktock');
  assert.equal(candidate.receipt.semantic_review_state, 'private_path_rejected');
  assert.equal(candidate.receipt.source_sha256, null);
  assert.equal(fs.existsSync(path.join(root, '.agents/skills/ticktock/SKILL.md')), false);
  assert.doesNotMatch(JSON.stringify(candidate.receipt), /private-operator/);
});

test('Windows home paths are rejected without retaining private bytes', () => {
  const root = fixture();
  skill(root, 'ticktock', [
    String.raw`WORKDIR=C:\Users\Alice\private`,
    String.raw`ALT=D:/home/Bob/private`,
    String.raw`UNC=\\server\Users\Carol\private`,
    'MIXED=//server/home/Dan/private'
  ].join('\n'));
  const result = sync({ root, handlerIds: new Set(), apply: true });
  const candidate = byId(result, 'direct-ticktock');
  assert.equal(candidate.receipt.semantic_review_state, 'private_path_rejected');
  assert.equal(candidate.receipt.source_sha256, null);
  assert.equal(fs.existsSync(path.join(root, '.agents/skills/ticktock/SKILL.md')), false);
  assert.doesNotMatch(JSON.stringify(candidate.receipt), /Alice|Bob|Carol|Dan/);
});

test('terminal home-directory paths are rejected without a trailing separator', () => {
  const root = fixture();
  const macHome = ['', 'Users', 'bob'].join('/');
  skill(root, 'ticktock', [
    'HOME=/home/alice',
    `MAC_HOME="${macHome}"`,
    String.raw`WIN_HOME=C:\Users\Carol`,
    String.raw`UNC_HOME=\\server\home\Dan`
  ].join('\n'));
  const result = sync({ root, handlerIds: new Set(), apply: true });
  const candidate = byId(result, 'direct-ticktock');
  assert.equal(candidate.receipt.semantic_review_state, 'private_path_rejected');
  assert.equal(candidate.receipt.source_sha256, null);
  assert.equal(fs.existsSync(path.join(root, '.agents/skills/ticktock/SKILL.md')), false);
  assert.doesNotMatch(JSON.stringify(candidate.receipt), /alice|bob|Carol|Dan/);
});

test('Linux root-home paths are rejected before staging', () => {
  const rootHome = ['', 'root'].join('/');
  for (const privatePath of [rootHome, `${rootHome}/private`]) {
    const root = fixture();
    skill(root, 'ticktock', `HOME=${privatePath}\n`);
    const result = sync({ root, handlerIds: new Set(), apply: true });
    const candidate = byId(result, 'direct-ticktock');
    assert.equal(candidate.receipt.semantic_review_state, 'private_path_rejected');
    assert.equal(candidate.receipt.source_sha256, null);
    assert.equal(fs.existsSync(path.join(root, '.agents/skills/ticktock/SKILL.md')), false);
  }
});

test('direct dependencies resolve transitively to a fixed point', () => {
  const root = fixture();
  const adapterPath = path.join(root, 'instructions/adapters/codex.yaml');
  const adapter = JSON.parse(fs.readFileSync(adapterPath, 'utf8'));
  adapter.skill_projection.families.direct_system_skills.sources = [
    '.claude/skills/a/SKILL.md',
    '.claude/skills/b/SKILL.md',
    '.claude/skills/c/SKILL.md'
  ];
  adapter.skill_projection.families.direct_system_skills.dependencies = { a: ['b'], b: ['c'] };
  fs.writeFileSync(adapterPath, `${JSON.stringify(adapter, null, 2)}\n`);
  skill(root, 'a');
  skill(root, 'b');
  const result = sync({ root, handlerIds: new Set(), apply: true });
  assert.equal(byId(result, 'direct-a').receipt.semantic_review_state, 'dependency_unavailable');
  assert.equal(byId(result, 'direct-b').receipt.semantic_review_state, 'dependency_unavailable');
  assert.equal(byId(result, 'direct-c').receipt.semantic_review_state, 'missing_source');
  assert.equal(fs.existsSync(path.join(root, '.agents/skills/a/SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(root, '.agents/skills/b/SKILL.md')), false);
});

test('application conflicts block dependent direct skills before any writes', () => {
  const root = fixture();
  const adapterPath = path.join(root, 'instructions/adapters/codex.yaml');
  const adapter = JSON.parse(fs.readFileSync(adapterPath, 'utf8'));
  adapter.skill_projection.families.direct_system_skills.sources = [
    '.claude/skills/child/SKILL.md',
    '.claude/skills/parent/SKILL.md'
  ];
  adapter.skill_projection.families.direct_system_skills.dependencies = { child: ['parent'] };
  fs.writeFileSync(adapterPath, `${JSON.stringify(adapter, null, 2)}\n`);
  skill(root, 'child');
  skill(root, 'parent');
  write(root, '.agents/skills/parent/SKILL.md', 'foreign parent\n');
  const result = sync({ root, handlerIds: new Set(), apply: true });
  assert.equal(byId(result, 'direct-parent').receipt.application_status, 'blocked_existing_preserved');
  assert.equal(byId(result, 'direct-child').receipt.application_status, 'blocked_dependency');
  assert.equal(byId(result, 'direct-child').receipt.semantic_review_state, 'dependency_unavailable');
  assert.equal(fs.existsSync(path.join(root, '.agents/skills/child/SKILL.md')), false);
  assert.equal(fs.readFileSync(path.join(root, '.agents/skills/parent/SKILL.md'), 'utf8'), 'foreign parent\n');
});

test('check reports stale installed targets whose candidates are now blocked', () => {
  const root = fixture();
  skill(root, 'ticktock');
  assert.equal(sync({ root, handlerIds: new Set(), apply: true }).drift, 0);
  assert.equal(fs.existsSync(path.join(root, '.agents/skills/ticktock/SKILL.md')), true);
  write(root, '.claude/skills/ticktock/SKILL.md', 'malformed source\n');
  const checked = sync({ root, handlerIds: new Set(), check: true });
  assert.ok(checked.drift > 0);
  assert.equal(byId(checked, 'direct-ticktock').receipt.semantic_review_state, 'malformed');
});

test('check reports orphaned managed targets whose source candidates disappeared', () => {
  const root = fixture();
  const source = command(root, 'sample');
  sync({ root, handlerIds: new Set(), apply: true });
  assert.equal(fs.existsSync(path.join(root, '.agents/skills/source-command-sample/SKILL.md')), true);
  fs.unlinkSync(source);
  const checked = sync({ root, handlerIds: new Set(), check: true });
  assert.ok(checked.drift > 0);
  assert.equal(checked.candidates.some((candidate) => candidate.id === 'command-sample'), false);
});

test('orphan checks detect leftover package resources after the managed skill disappears', () => {
  const root = fixture();
  const source = command(root, 'sample');
  sync({ root, handlerIds: new Set(), apply: true });
  const installed = path.join(root, '.agents/skills/source-command-sample');
  fs.unlinkSync(path.join(installed, 'SKILL.md'));
  fs.writeFileSync(path.join(installed, 'leftover.txt'), 'stale\n');
  fs.unlinkSync(source);
  assert.ok(sync({ root, handlerIds: new Set(), check: true }).drift > 0);
});

test('candidate-only staging preserves managed-target history for later orphan checks', () => {
  const root = fixture();
  const source = command(root, 'sample');
  sync({ root, handlerIds: new Set(), apply: true });
  fs.unlinkSync(path.join(root, '_dev/reports/analysis/codex-skill-projections/managed-targets.json'));
  sync({ root, handlerIds: new Set() });
  fs.unlinkSync(source);
  assert.ok(sync({ root, handlerIds: new Set(), check: true }).drift > 0);
  const ledger = JSON.parse(fs.readFileSync(path.join(root, '_dev/reports/analysis/codex-skill-projections/managed-targets.json'), 'utf8'));
  assert.deepEqual(ledger.targets, ['.agents/skills/source-command-sample/SKILL.md']);
});

test('candidate-only staging restores ledger entries from prior application receipts', () => {
  const root = fixture();
  const source = command(root, 'sample');
  command(root, 'keeper');
  const applied = sync({ root, handlerIds: new Set(), apply: true });
  const ledgerPath = path.join(applied.candidateDir, 'managed-targets.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  ledger.targets = ledger.targets.filter((target) => !target.includes('source-command-sample'));
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  sync({ root, handlerIds: new Set() });
  const repaired = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  assert.equal(repaired.targets.includes('.agents/skills/source-command-sample/SKILL.md'), true);
  fs.unlinkSync(source);
  sync({ root, handlerIds: new Set() });
  assert.ok(sync({ root, handlerIds: new Set(), check: true }).drift > 0);
});

test('check reports missing or stale staged projection evidence', () => {
  const root = fixture();
  command(root, 'sample');
  const staged = sync({ root, handlerIds: new Set(), apply: true });
  fs.unlinkSync(path.join(staged.candidateDir, 'projection-index.json'));
  assert.ok(sync({ root, handlerIds: new Set(), check: true }).drift > 0);
  sync({ root, handlerIds: new Set(), apply: true });
  fs.writeFileSync(path.join(staged.candidateDir, 'receipts/command-sample.json'), '{}\n');
  assert.ok(sync({ root, handlerIds: new Set(), check: true }).drift > 0);
  sync({ root, handlerIds: new Set(), apply: true });
  fs.writeFileSync(path.join(staged.candidateDir, 'candidates/source-command-sample/SKILL.md'), 'stale\n');
  assert.ok(sync({ root, handlerIds: new Set(), check: true }).drift > 0);
  sync({ root, handlerIds: new Set(), apply: true });
  fs.unlinkSync(path.join(staged.candidateDir, 'managed-targets.json'));
  assert.ok(sync({ root, handlerIds: new Set(), check: true }).drift > 0);
  sync({ root, handlerIds: new Set(), apply: true });
  const ledgerPath = path.join(staged.candidateDir, 'managed-targets.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  ledger.targets = [];
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  assert.ok(sync({ root, handlerIds: new Set(), check: true }).drift > 0);
});

test('check compares deterministic rejection details in receipts', () => {
  const root = fixture();
  write(root, 'instructions/canonical/commands/sample.yaml', `${JSON.stringify({ id: 'other', description: 'mismatch', mode: 'REVIEW_ONLY' }, null, 2)}\n`);
  const staged = sync({ root, handlerIds: new Set() });
  const receiptPath = path.join(staged.candidateDir, 'receipts/command-sample.json');
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  receipt.detail = 'incorrect evidence';
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  assert.ok(sync({ root, handlerIds: new Set(), check: true }).drift > 0);
});

test('check rejects fabricated receipt application statuses even when index counts agree', () => {
  const root = fixture();
  command(root, 'sample');
  const staged = sync({ root, handlerIds: new Set(), apply: true });
  const receiptPath = path.join(staged.candidateDir, 'receipts/command-sample.json');
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  const oldStatus = receipt.application_status;
  receipt.application_status = 'fabricated';
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  const indexPath = path.join(staged.candidateDir, 'projection-index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const oldKey = `canonical_command:reviewed_safe:${oldStatus}`;
  const newKey = 'canonical_command:reviewed_safe:fabricated';
  delete index.counts[oldKey];
  index.counts[newKey] = 1;
  fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  assert.ok(sync({ root, handlerIds: new Set(), check: true }).drift > 0);
});

test('candidate-only staging repairs malformed disposable receipts', () => {
  const root = fixture();
  command(root, 'sample');
  const applied = sync({ root, handlerIds: new Set(), apply: true });
  const receiptPath = path.join(applied.candidateDir, 'receipts/command-sample.json');
  fs.writeFileSync(receiptPath, '{broken\n');
  assert.doesNotThrow(() => sync({ root, handlerIds: new Set() }));
  assert.equal(JSON.parse(fs.readFileSync(receiptPath, 'utf8')).projection_kind, 'canonical_command');
});

test('malformed frontmatter receipts identify the line without copying its contents', () => {
  const root = fixture();
  const sensitiveLine = ['not-frontmatter', ['', 'Users', 'private', 'secret'].join('/')].join(' ');
  write(root, '.claude/skills/ticktock/SKILL.md', `---\nname: ticktock\n${sensitiveLine}\ndescription: demo\n---\nbody\n`);
  const candidate = byId(buildCandidates({ root, handlerIds: new Set() }), 'direct-ticktock');
  assert.equal(candidate.receipt.detail, 'malformed frontmatter at line 2');
  assert.doesNotMatch(JSON.stringify(candidate.receipt), /not-frontmatter|Users\/private\/secret/);
});

test('direct resources copy recursively and application remains additive-only', () => {
  const root = fixture();
  skill(root, 'ticktock');
  const sourceResource = write(root, '.claude/skills/ticktock/references/nested.md', 'evidence\n');
  fs.chmodSync(sourceResource, 0o755);
  const first = sync({ root, handlerIds: new Set(), apply: true });
  assert.equal(byId(first, 'direct-ticktock').receipt.application_status, 'applied_additive');
  const evidence = byId(first, 'direct-ticktock').receipt;
  assert.deepEqual(evidence.resource_manifest, [{ path: 'references/nested.md', sha256: sha256ForTest('evidence\n'), mode: '0755' }]);
  assert.match(evidence.package_sha256, /^[a-f0-9]{64}$/);
  const firstPackageHash = evidence.package_sha256;
  const resource = path.join(root, '.agents/skills/ticktock/references/nested.md');
  assert.equal(fs.readFileSync(resource, 'utf8'), 'evidence\n');
  assert.equal(fs.statSync(resource).mode & 0o777, 0o755);
  fs.unlinkSync(resource);
  assert.ok(sync({ root, handlerIds: new Set(), check: true }).drift > 0);
  const repaired = sync({ root, handlerIds: new Set(), apply: true });
  assert.equal(byId(repaired, 'direct-ticktock').receipt.application_status, 'applied_additive');
  assert.equal(fs.readFileSync(resource, 'utf8'), 'evidence\n');
  assert.equal(fs.statSync(resource).mode & 0o777, 0o755);
  fs.chmodSync(resource, 0o644);
  assert.equal(sync({ root, handlerIds: new Set(), check: true }).drift, 1);
  const modeConflict = sync({ root, handlerIds: new Set(), apply: true });
  assert.equal(byId(modeConflict, 'direct-ticktock').receipt.application_status, 'blocked_existing_preserved');
  assert.equal(fs.statSync(resource).mode & 0o777, 0o644);
  fs.writeFileSync(resource, 'foreign resource\n');
  assert.equal(sync({ root, handlerIds: new Set(), check: true }).drift, 1);
  const conflict = sync({ root, handlerIds: new Set(), apply: true });
  assert.equal(byId(conflict, 'direct-ticktock').receipt.application_status, 'blocked_existing_preserved');
  assert.equal(fs.readFileSync(resource, 'utf8'), 'foreign resource\n');
  fs.writeFileSync(path.join(root, '.agents/skills/ticktock/SKILL.md'), 'foreign\n');
  const second = sync({ root, handlerIds: new Set(), apply: true });
  assert.equal(byId(second, 'direct-ticktock').receipt.application_status, 'blocked_existing_preserved');
  assert.equal(fs.readFileSync(path.join(root, '.agents/skills/ticktock/SKILL.md'), 'utf8'), 'foreign\n');
  fs.writeFileSync(path.join(root, '.claude/skills/ticktock/references/nested.md'), 'changed evidence\n');
  const changed = byId(buildCandidates({ root, handlerIds: new Set() }), 'direct-ticktock').receipt;
  assert.notEqual(changed.package_sha256, firstPackageHash);
  assert.equal(changed.source_sha256, evidence.source_sha256);
});

test('removed bundled resources remain preserved but are reported as package drift', () => {
  const root = fixture();
  skill(root, 'ticktock');
  const sourceResource = write(root, '.claude/skills/ticktock/references/old.md', 'old evidence\n');
  sync({ root, handlerIds: new Set(), apply: true });
  const installedResource = path.join(root, '.agents/skills/ticktock/references/old.md');
  fs.unlinkSync(sourceResource);
  assert.ok(sync({ root, handlerIds: new Set(), check: true }).drift > 0);
  const reapplied = sync({ root, handlerIds: new Set(), apply: true });
  assert.equal(byId(reapplied, 'direct-ticktock').receipt.application_status, 'blocked_existing_preserved');
  assert.equal(fs.readFileSync(installedResource, 'utf8'), 'old evidence\n');
});

test('bundled resource symlinks are rejected before their targets are read', () => {
  const root = fixture();
  skill(root, 'ticktock');
  const outside = write(root, 'private/key.pem', 'external private bytes\n');
  const link = path.join(root, '.claude/skills/ticktock/key.pem');
  fs.symlinkSync(outside, link);
  assert.throws(() => sync({ root, handlerIds: new Set() }), /Refusing symbolic-link bundled resource/);
  assert.equal(fs.existsSync(path.join(root, '_dev/reports/analysis/codex-skill-projections/candidates/ticktock/key.pem')), false);
});

test('primary skill symlinks are rejected before their targets are read', () => {
  const root = fixture();
  const outside = write(root, 'private/external-skill.md', '---\nname: ticktock\ndescription: external\n---\nexternal private bytes\n');
  const sourceDir = path.join(root, '.claude/skills/ticktock');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.symlinkSync(outside, path.join(sourceDir, 'SKILL.md'));
  assert.throws(() => sync({ root, handlerIds: new Set() }), /Refusing symbolic-link direct skill source/);
  assert.equal(fs.existsSync(path.join(root, '_dev/reports/analysis/codex-skill-projections/candidates/ticktock/SKILL.md')), false);
});

test('symlinked source roots cannot redefine repository containment', () => {
  const root = fixture();
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'external-skills-'));
  write(externalRoot, 'ticktock/SKILL.md', '---\nname: ticktock\ndescription: external\n---\nexternal private bytes\n');
  const claudeRoot = path.join(root, '.claude');
  fs.mkdirSync(claudeRoot, { recursive: true });
  fs.symlinkSync(externalRoot, path.join(claudeRoot, 'skills'));
  assert.throws(() => sync({ root, handlerIds: new Set() }), /Refusing symbolic-link direct skill source root/);
});

test('canonical and framework discovery roots are validated before recursive walking', () => {
  const canonicalRoot = fixture();
  const externalCanonical = fs.mkdtempSync(path.join(os.tmpdir(), 'external-commands-'));
  fs.mkdirSync(path.join(canonicalRoot, 'instructions/canonical'), { recursive: true });
  fs.symlinkSync(externalCanonical, path.join(canonicalRoot, 'instructions/canonical/commands'));
  assert.throws(() => buildCandidates({ root: canonicalRoot, handlerIds: new Set() }), /Refusing symbolic-link canonical command source root/);

  const frameworkRoot = fixture();
  command(frameworkRoot, 'sample');
  const externalFrameworks = fs.mkdtempSync(path.join(os.tmpdir(), 'external-frameworks-'));
  fs.symlinkSync(externalFrameworks, path.join(frameworkRoot, 'frameworks'));
  assert.throws(() => buildCandidates({ root: frameworkRoot, handlerIds: new Set() }), /Refusing symbolic-link framework skill source root/);
});

test('sensitive and credential-bearing bundled resources are rejected', () => {
  const envRoot = fixture();
  skill(envRoot, 'ticktock');
  write(envRoot, '.claude/skills/ticktock/.env', 'API_KEY=supersecret\n');
  assert.throws(() => sync({ root: envRoot, handlerIds: new Set() }), /Refusing sensitive bundled resource: \.env/);

  const credentialRoot = fixture();
  skill(credentialRoot, 'ticktock');
  write(credentialRoot, '.claude/skills/ticktock/notes.txt', `token sk-${'a'.repeat(24)}\n`);
  assert.throws(() => sync({ root: credentialRoot, handlerIds: new Set() }), /Refusing credential-bearing bundled resource/);

  for (const token of [
    `xoxb-${'a'.repeat(24)}`,
    `glpat-${'b'.repeat(24)}`,
    `AIza${'c'.repeat(35)}`
  ]) {
    const tokenRoot = fixture();
    skill(tokenRoot, 'ticktock');
    write(tokenRoot, '.claude/skills/ticktock/notes.txt', `token ${token}\n`);
    assert.throws(() => sync({ root: tokenRoot, handlerIds: new Set() }), /Refusing credential-bearing bundled resource/);
  }

  const namedCredentialRoot = fixture();
  skill(namedCredentialRoot, 'ticktock');
  const namedToken = `sk-${'d'.repeat(24)}`;
  write(namedCredentialRoot, `.claude/skills/ticktock/references/${namedToken}.txt`, 'innocuous\n');
  assert.throws(
    () => sync({ root: namedCredentialRoot, handlerIds: new Set() }),
    (error) => /credential-bearing bundled resource path/.test(error.message) && !error.message.includes(namedToken)
  );
});

test('credential assignments and temporary AWS keys are rejected without retaining their bytes', () => {
  for (const body of [
    `AWS_SECRET_ACCESS_KEY=${'z'.repeat(32)}\n`,
    `OPENAI_API_KEY="ordinarysecretvalue${'q'.repeat(16)}"\n`,
    `OPENAI_API_KEY: yamlsecretvalue${'y'.repeat(16)}\n`,
    `"OPENAI_API_KEY": "jsonsecretvalue${'j'.repeat(16)}"\n`,
    `api_key: genericsecretvalue${'g'.repeat(16)}\n`,
    `CLIENT_SECRET=clientsecretvalue${'c'.repeat(16)}\n`,
    `PASSWORD: passwordsecretvalue${'p'.repeat(16)}\n`,
    `ACCESS_TOKEN="accesssecretvalue${'a'.repeat(16)}"\n`,
    `PRIVATE_KEY="privatesecretvalue${'v'.repeat(16)}"\n`,
    `AUTH_TOKEN: authsecretvalue${'h'.repeat(16)}\n`,
    `SECRET=baresecretvalue${'s'.repeat(16)}\n`,
    `Authorization: Bearer ordinarysecretvalue${'b'.repeat(16)}\n`,
    `Authorization: Basic basicsecretvalue${'i'.repeat(16)}\n`,
    `-----BEGIN ENCRYPTED PRIVATE KEY-----\nencryptedprivatebytes${'e'.repeat(16)}\n-----END ENCRYPTED PRIVATE KEY-----\n`,
    `temporary ASIA${'A'.repeat(16)}\n`
  ]) {
    const root = fixture();
    skill(root, 'ticktock', body);
    const result = sync({ root, handlerIds: new Set(), apply: true });
    const candidate = byId(result, 'direct-ticktock');
    assert.equal(candidate.receipt.semantic_review_state, 'private_path_rejected');
    assert.equal(candidate.receipt.source_sha256, null);
    assert.equal(fs.existsSync(path.join(root, '.agents/skills/ticktock/SKILL.md')), false);
    assert.doesNotMatch(JSON.stringify(candidate.receipt), /zzzzzzzz|ordinarysecretvalue|yamlsecretvalue|jsonsecretvalue|genericsecretvalue|clientsecretvalue|passwordsecretvalue|accesssecretvalue|privatesecretvalue|authsecretvalue|baresecretvalue|encryptedprivatebytes|ASIAAAAA/);
  }
});

test('shell-variable credential references are not treated as literal secrets', () => {
  const root = fixture();
  skill(root, 'ticktock', 'export OPENAI_API_KEY="$OPENAI_API_KEY"\nexport AUTH_TOKEN=${AUTH_TOKEN}\nAuthorization: Bearer $ACCESS_TOKEN\nAuthorization: Basic ${BASIC_AUTH}\n');
  const result = sync({ root, handlerIds: new Set(), apply: true });
  const candidate = byId(result, 'direct-ticktock');
  assert.equal(candidate.receipt.semantic_review_state, 'reviewed_safe');
  assert.equal(candidate.receipt.application_status, 'applied_additive');
  assert.equal(fs.existsSync(path.join(root, '.agents/skills/ticktock/SKILL.md')), true);
});

test('candidate staging refuses repository and target directory deletion', () => {
  const root = fixture();
  command(root, 'sample');
  const rootSentinel = write(root, 'keep.txt', 'keep\n');
  assert.throws(() => sync({ root, handlerIds: new Set(), candidateDir: root }), /Unsafe candidate directory/);
  assert.equal(fs.readFileSync(rootSentinel, 'utf8'), 'keep\n');
  const target = path.join(root, '.agents/skills');
  write(root, '.agents/skills/keep.txt', 'target keep\n');
  assert.throws(() => sync({ root, handlerIds: new Set(), candidateDir: target }), /Unsafe candidate directory/);
  assert.equal(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'target keep\n');
  const candidateRoot = path.join(root, '_dev/reports/analysis/codex-skill-projections');
  const externalReceipt = write(root, '_dev/reports/analysis/codex-skill-projections/runtime-receipt.md', 'preserve\n');
  sync({ root, handlerIds: new Set(), candidateDir: candidateRoot });
  assert.equal(fs.readFileSync(externalReceipt, 'utf8'), 'preserve\n');
});

test('candidate staging preflights invalid IDs before clearing prior evidence', () => {
  const root = fixture();
  command(root, 'sample');
  const first = sync({ root, handlerIds: new Set() });
  const candidateSentinel = path.join(first.candidateDir, 'candidates/source-command-sample/SKILL.md');
  const receiptSentinel = path.join(first.candidateDir, 'receipts/command-sample.json');
  write(root, 'frameworks/a/b/.claude/skills/bad_/SKILL.md', '---\nname: bad\ndescription: invalid slug\n---\nbody\n');
  assert.throws(() => sync({ root, handlerIds: new Set() }), /Invalid candidate id/);
  assert.equal(fs.existsSync(candidateSentinel), true);
  assert.equal(fs.existsSync(receiptSentinel), true);
  assert.equal(fs.existsSync(path.join(first.candidateDir, 'projection-index.json')), true);
});

test('candidate staging rejects symlinked directories before cleanup', () => {
  const root = fixture();
  command(root, 'sample');
  const configured = path.join(root, '_dev/reports/analysis/codex-skill-projections');
  const victim = path.join(root, '_dev/reports/analysis/victim');
  const candidateSentinel = write(root, '_dev/reports/analysis/victim/candidates/keep.txt', 'keep candidate\n');
  const receiptSentinel = write(root, '_dev/reports/analysis/victim/receipts/keep.txt', 'keep receipt\n');
  fs.symlinkSync(victim, configured);
  assert.throws(() => sync({ root, handlerIds: new Set() }), /Refusing symbolic-link candidate directory component/);
  assert.equal(fs.readFileSync(candidateSentinel, 'utf8'), 'keep candidate\n');
  assert.equal(fs.readFileSync(receiptSentinel, 'utf8'), 'keep receipt\n');
});

test('dangling destination symlinks cannot redirect applied writes', () => {
  const root = fixture();
  command(root, 'sample');
  const skillDir = path.join(root, '.agents/skills/source-command-sample');
  fs.mkdirSync(skillDir, { recursive: true });
  const external = path.join(os.tmpdir(), `codex-projector-dangling-${path.basename(root)}.md`);
  fs.symlinkSync(external, path.join(skillDir, 'SKILL.md'));
  assert.throws(() => sync({ root, handlerIds: new Set(), apply: true }), /Refusing symbolic-link destination component/);
  assert.equal(fs.existsSync(external), false);
});

test('all selected destinations are preflighted before the first application write', () => {
  const root = fixture();
  command(root, 'a');
  command(root, 'z');
  const unsafeDir = path.join(root, '.agents/skills/source-command-z');
  fs.mkdirSync(unsafeDir, { recursive: true });
  const external = path.join(os.tmpdir(), `codex-projector-preflight-${path.basename(root)}.md`);
  fs.symlinkSync(external, path.join(unsafeDir, 'SKILL.md'));
  assert.throws(() => sync({ root, handlerIds: new Set(), apply: true }), /Refusing symbolic-link destination component/);
  assert.equal(fs.existsSync(path.join(root, '.agents/skills/source-command-a/SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(root, '_dev/reports/analysis/codex-skill-projections/projection-index.json')), false);
});

test('symlinked target roots cannot redirect applied writes outside the repository', () => {
  const root = fixture();
  command(root, 'sample');
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-projector-target-'));
  fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
  fs.symlinkSync(external, path.join(root, '.agents/skills'));
  assert.throws(() => sync({ root, handlerIds: new Set(), apply: true }), /Refusing symbolic-link target root component/);
  assert.equal(fs.existsSync(path.join(external, 'source-command-sample/SKILL.md')), false);
});

test('non-file installed targets are preserved and reported as drift', () => {
  const root = fixture();
  command(root, 'sample');
  const installed = path.join(root, '.agents/skills/source-command-sample/SKILL.md');
  fs.mkdirSync(installed, { recursive: true });
  assert.ok(sync({ root, handlerIds: new Set(), check: true }).drift > 0);
  const reapplied = sync({ root, handlerIds: new Set(), apply: true });
  assert.equal(byId(reapplied, 'command-sample').receipt.application_status, 'blocked_existing_preserved');
  assert.equal(fs.lstatSync(installed).isDirectory(), true);
});

test('non-directory package roots are preserved and reported as drift', () => {
  const root = fixture();
  command(root, 'sample');
  const packageRoot = write(root, '.agents/skills/source-command-sample', 'foreign package root\n');
  assert.ok(sync({ root, handlerIds: new Set(), check: true }).drift > 0);
  const reapplied = sync({ root, handlerIds: new Set(), apply: true });
  assert.equal(byId(reapplied, 'command-sample').receipt.application_status, 'blocked_existing_preserved');
  assert.equal(fs.readFileSync(packageRoot, 'utf8'), 'foreign package root\n');
});

test('blocked candidates classify non-directory package roots as drift', () => {
  const root = fixture();
  skill(root, 'ticktock');
  sync({ root, handlerIds: new Set(), apply: true });
  const packageRoot = path.join(root, '.agents/skills/ticktock');
  fs.unlinkSync(path.join(packageRoot, 'SKILL.md'));
  fs.rmdirSync(packageRoot);
  fs.writeFileSync(packageRoot, 'foreign package root\n');
  fs.writeFileSync(path.join(root, '.claude/skills/ticktock/SKILL.md'), 'malformed source\n');
  sync({ root, handlerIds: new Set() });
  assert.ok(sync({ root, handlerIds: new Set(), check: true }).drift > 0);
  assert.equal(fs.readFileSync(packageRoot, 'utf8'), 'foreign package root\n');
});

test('blocked candidates ignore user-owned packages without projector custody', () => {
  const root = fixture();
  write(root, 'frameworks/a/b/.claude/skills/pending/SKILL.md', '---\nname: pending\ndescription: pending\n---\nbody\n');
  sync({ root, handlerIds: new Set() });
  write(root, '.agents/skills/guild-a-b-pending/SKILL.md', 'user-owned\n');
  assert.equal(sync({ root, handlerIds: new Set(), check: true }).drift, 0);
});

test('blocked candidates detect residual package resources after their skill disappears', () => {
  const root = fixture();
  skill(root, 'ticktock');
  write(root, '.claude/skills/ticktock/references/a.md', 'expected resource\n');
  sync({ root, handlerIds: new Set(), apply: true });
  fs.writeFileSync(path.join(root, '.claude/skills/ticktock/SKILL.md'), 'malformed source\n');
  fs.unlinkSync(path.join(root, '.agents/skills/ticktock/SKILL.md'));
  sync({ root, handlerIds: new Set() });
  assert.ok(sync({ root, handlerIds: new Set(), check: true }).drift > 0);
  const resource = path.join(root, '.agents/skills/ticktock/references/a.md');
  assert.equal(fs.readFileSync(resource, 'utf8'), 'expected resource\n');
  fs.unlinkSync(resource);
  fs.rmdirSync(path.dirname(resource));
  assert.equal(sync({ root, handlerIds: new Set(), check: true }).drift, 0);
});

test('nested non-directory resource parents are preserved and reported as drift', () => {
  const root = fixture();
  skill(root, 'ticktock');
  write(root, '.claude/skills/ticktock/references/a.md', 'expected resource\n');
  const blockingParent = write(root, '.agents/skills/ticktock/references', 'foreign parent file\n');
  assert.ok(sync({ root, handlerIds: new Set(), check: true }).drift > 0);
  const reapplied = sync({ root, handlerIds: new Set(), apply: true });
  assert.equal(byId(reapplied, 'direct-ticktock').receipt.application_status, 'blocked_existing_preserved');
  assert.equal(fs.readFileSync(blockingParent, 'utf8'), 'foreign parent file\n');
});

test('dangling projection index symlinks cannot redirect staging writes', () => {
  const root = fixture();
  command(root, 'sample');
  const candidateRoot = path.join(root, '_dev/reports/analysis/codex-skill-projections');
  fs.mkdirSync(candidateRoot, { recursive: true });
  const external = path.join(os.tmpdir(), `codex-projector-index-${path.basename(root)}.json`);
  const candidateSentinel = write(root, '_dev/reports/analysis/codex-skill-projections/candidates/keep.txt', 'keep candidate\n');
  const receiptSentinel = write(root, '_dev/reports/analysis/codex-skill-projections/receipts/keep.txt', 'keep receipt\n');
  fs.symlinkSync(external, path.join(candidateRoot, 'projection-index.json'));
  assert.throws(() => sync({ root, handlerIds: new Set() }), /Unsafe generated artifact symlink/);
  assert.equal(fs.existsSync(external), false);
  assert.equal(fs.readFileSync(candidateSentinel, 'utf8'), 'keep candidate\n');
  assert.equal(fs.readFileSync(receiptSentinel, 'utf8'), 'keep receipt\n');
});

test('generated cleanup refuses a child symlink escaping the validated root', () => {
  const root = fixture();
  const candidateRoot = path.join(root, '_dev/reports/analysis/codex-skill-projections');
  const outside = path.join(root, '_dev/outside-receipts');
  fs.mkdirSync(candidateRoot, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  const sentinel = write(root, '_dev/outside-receipts/keep.txt', 'keep\n');
  fs.symlinkSync(outside, path.join(candidateRoot, 'receipts'));
  assert.throws(() => clearGeneratedProjectionArtifacts(candidateRoot), /Unsafe generated artifact symlink/);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep\n');
});

test('candidate receipts carry every required evidence field', () => {
  const root = fixture();
  command(root, 'sample');
  const candidate = byId(buildCandidates({ root, handlerIds: new Set() }), 'command-sample');
  for (const field of ['generator_id', 'source_relative_path', 'source_sha256', 'projection_kind', 'capability_tier', 'semantic_review_state', 'target_exact_path', 'collision_state', 'application_status']) {
    assert.ok(Object.hasOwn(candidate.receipt, field), field);
  }
  assert.match(candidate.receipt.source_sha256, /^[a-f0-9]{64}$/);
});
