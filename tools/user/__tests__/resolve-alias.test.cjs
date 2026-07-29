'use strict';

/**
 * Fixture-driven tests for tools/user/resolve-alias.cjs.
 * One test (or more) for every rule named in the plan's precedence-fixtures row:
 *   within-domain canonical-before-user; cross-domain duplicate legal;
 *   deprecated warns+resolves; inactive refuses; case-insensitive normalized
 *   lookup — plus domain-token mapping, single-hop, malformed overlay handling,
 *   the key-only warning membrane, and an integration touch on the shipped registry.
 *
 * No test framework: plain node + assert, temp fixtures, nonzero exit on failure.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveAlias, resolveMythosHome, normalizeName } = require('../resolve-alias.cjs');

const SHIPPED_REGISTRY = path.join(
  __dirname, '..', '..', '..', 'instructions', 'canonical', 'command-aliases.yaml'
);

// ---- fixtures ------------------------------------------------------------

const CANONICAL_FIXTURE = `version: "MythosAliasRegistry/1.0"
aliases:
  owl:
    resolves_to: orchestrate-loop
    status: compatibility
  guild-ledger:
    resolves_to: system-status
    status: primary
  augur:
    resolves_to: site
    status: cross-alias
  shared-name:
    resolves_to: canonical-command-target
    status: primary
  old-cmd:
    resolves_to: guild-ledger
    status: deprecated
  dead-cmd:
    resolves_to: guild-ledger
    status: inactive
  hop-a:
    resolves_to: guild-ledger
    status: primary
framework_aliases:
  qa:
    resolves_to: wordpress/qa
    status: primary
  shared-name:
    resolves_to: canonical-framework-target
    status: primary
skill_aliases:
  manage-grimoires:
    resolves_to: manage-frameworks
    status: primary
tool_aliases:
  verify-skill:
    resolves_to: verify:skill
    status: primary
`;

const USER_SECRET = 'secret-user-value-do-not-log';
const USER_OVERLAY = `aliases:
  guild-ledger:
    resolves_to: user-shadowed-target
    status: primary
  my-cmd:
    resolves_to: user-command-target
    status: primary
  old-user:
    resolves_to: ${USER_SECRET}
    status: deprecated
  broken-entry:
    status: primary
framework_aliases:
  my-fw:
    resolves_to: homebrew/my-thing
    status: primary
`;

const MALFORMED_OVERLAY = `this is not a registry
:::::
- just junk
`;

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-alias-'));
const registryPath = path.join(tmpRoot, 'command-aliases.yaml');
fs.writeFileSync(registryPath, CANONICAL_FIXTURE);

const userHome = path.join(tmpRoot, 'home-valid');
fs.mkdirSync(userHome);
fs.writeFileSync(path.join(userHome, 'aliases.yaml'), USER_OVERLAY);

const malformedHome = path.join(tmpRoot, 'home-malformed');
fs.mkdirSync(malformedHome);
fs.writeFileSync(path.join(malformedHome, 'aliases.yaml'), MALFORMED_OVERLAY);

const emptyHome = path.join(tmpRoot, 'home-absent'); // exists but no aliases.yaml
fs.mkdirSync(emptyHome);

// An isolated fake $HOME whose ~/.mythos does NOT exist — keeps canonical-only
// tests deterministic regardless of the real machine's ~/.mythos.
const isolatedHome = path.join(tmpRoot, 'fake-home-empty');
fs.mkdirSync(isolatedHome);

// A fake $HOME whose ~/.mythos DOES hold an overlay, to exercise the default path.
const fakeHome = path.join(tmpRoot, 'fake-home');
fs.mkdirSync(path.join(fakeHome, '.mythos'), { recursive: true });
fs.writeFileSync(
  path.join(fakeHome, '.mythos', 'aliases.yaml'),
  'aliases:\n  my-cmd:\n    resolves_to: fakehome-target\n    status: primary\n'
);

// Warning capture helper.
function withWarnings(fn) {
  const warnings = [];
  const result = fn((msg) => warnings.push(msg));
  return { result, warnings };
}

// Canonical-only default: an isolated home with no overlay, injected env with no
// MYTHOS_HOME, so no test depends on the machine's real ~/.mythos.
const base = { registryPath, env: {}, homedir: isolatedHome, onWarn: () => {} };

// ---- test registry -------------------------------------------------------

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// 1. domain-token mapping: each token reads its own domain, and a name in one
//    domain does not resolve under another.
test('domain-token mapping: commands', () => {
  assert.strictEqual(resolveAlias('commands', 'owl', base).id, 'orchestrate-loop');
});
test('domain-token mapping: frameworks', () => {
  assert.strictEqual(resolveAlias('frameworks', 'qa', base).id, 'wordpress/qa');
});
test('domain-token mapping: skills', () => {
  assert.strictEqual(resolveAlias('skills', 'manage-grimoires', base).id, 'manage-frameworks');
});
test('domain-token mapping: tools', () => {
  assert.strictEqual(resolveAlias('tools', 'verify-skill', base).id, 'verify:skill');
});
test('domain-token mapping: a command name does not resolve as a framework', () => {
  assert.strictEqual(resolveAlias('frameworks', 'owl', base), null);
});
test('domain-token mapping: a framework name does not resolve as a command', () => {
  assert.strictEqual(resolveAlias('commands', 'qa', base), null);
});

// 2. within-domain canonical-before-user.
test('within-domain canonical-before-user: canonical shadows user', () => {
  const r = resolveAlias('commands', 'guild-ledger', { registryPath, mythosHome: userHome, onWarn: () => {} });
  assert.strictEqual(r.id, 'system-status');
  assert.strictEqual(r.source, 'canonical');
});

// 3. user resolves when canonical absent (in that domain).
test('user overlay resolves when canonical has no such name', () => {
  const r = resolveAlias('commands', 'my-cmd', { registryPath, mythosHome: userHome, onWarn: () => {} });
  assert.strictEqual(r.id, 'user-command-target');
  assert.strictEqual(r.source, 'user');
});

// 4. cross-domain duplicate legal.
test('cross-domain duplicate legal: same spelling, independent targets', () => {
  assert.strictEqual(resolveAlias('commands', 'shared-name', base).id, 'canonical-command-target');
  assert.strictEqual(resolveAlias('frameworks', 'shared-name', base).id, 'canonical-framework-target');
});

// 5. deprecated warns + resolves.
test('deprecated: resolves and emits a warning', () => {
  const { result, warnings } = withWarnings((onWarn) =>
    resolveAlias('commands', 'old-cmd', { registryPath, onWarn }));
  assert.strictEqual(result.id, 'guild-ledger');
  assert.strictEqual(result.status, 'deprecated');
  assert.ok(warnings.some((w) => w.includes('old-cmd') && /deprecated/.test(w)));
});

// 6. inactive refuses.
test('inactive: does not resolve (null)', () => {
  assert.strictEqual(resolveAlias('commands', 'dead-cmd', base), null);
});

// 7. case-insensitive normalized lookup.
test('case-insensitive normalized lookup: upper/underscore/space/hyphen runs', () => {
  const forms = ['GUILD-LEDGER', 'guild_ledger', '  Guild Ledger  ', 'guild--ledger'];
  for (const form of forms) {
    assert.strictEqual(resolveAlias('commands', form, base).id, 'system-status', `form: ${form}`);
  }
});
test('normalizeName helper: kebab normalization', () => {
  assert.strictEqual(normalizeName('  Claim_Spoils '), 'claim-spoils');
});

// 8. malformed overlay FILE: warn (by location) + ignore file.
//    Use a name absent from canonical so resolution falls through to the overlay.
test('malformed overlay file: warned by path, ignored (falls through to null)', () => {
  const { result, warnings } = withWarnings((onWarn) =>
    resolveAlias('commands', 'my-cmd', { registryPath, mythosHome: malformedHome, onWarn }));
  assert.strictEqual(result, null);
  assert.ok(warnings.some((w) => w.includes('malformed overlay file')));
});
test('malformed overlay file: canonical name still resolves without touching overlay', () => {
  const r = resolveAlias('frameworks', 'qa', { registryPath, mythosHome: malformedHome, onWarn: () => {} });
  assert.strictEqual(r.id, 'wordpress/qa');
});

// 9. malformed overlay ENTRY: warn by key + skip; sibling user entries still work.
test('malformed overlay entry: warned by key, skipped', () => {
  const { result, warnings } = withWarnings((onWarn) =>
    resolveAlias('commands', 'my-cmd', { registryPath, mythosHome: userHome, onWarn }));
  assert.strictEqual(result.id, 'user-command-target');
  assert.ok(warnings.some((w) => w.includes('broken-entry')));
});

// 10. single-hop terminal: resolves_to is returned verbatim, never re-resolved.
test('single-hop: target that matches another alias name is not re-resolved', () => {
  const r = resolveAlias('commands', 'hop-a', base);
  assert.strictEqual(r.id, 'guild-ledger'); // NOT 'system-status'
});

// 11. unknown name -> null.
test('unknown name resolves to null', () => {
  assert.strictEqual(resolveAlias('commands', 'no-such-alias', base), null);
});

// 12. unknown domain token throws.
test('unknown domain token throws', () => {
  assert.throws(() => resolveAlias('spells', 'owl', base), /unknown domain/);
});

// 13. membrane: warnings never contain user VALUES.
test('membrane: deprecated user-entry warning names the key, never the value', () => {
  const { result, warnings } = withWarnings((onWarn) =>
    resolveAlias('commands', 'old-user', { registryPath, mythosHome: userHome, onWarn }));
  assert.strictEqual(result.id, USER_SECRET); // the resolved id itself is returned...
  assert.ok(warnings.length > 0);
  for (const w of warnings) {
    assert.ok(!w.includes(USER_SECRET), `warning leaked a user value: ${w}`);
  }
});

// 14. absent MYTHOS_HOME -> silent, canonical resolves.
test('absent overlay home: silent no-op, canonical resolves', () => {
  const { result, warnings } = withWarnings((onWarn) =>
    resolveAlias('commands', 'owl', { registryPath, mythosHome: emptyHome, onWarn }));
  assert.strictEqual(result.id, 'orchestrate-loop');
  assert.strictEqual(warnings.length, 0);
});

// 15. resolving statuses all resolve.
test('statuses primary/cross-alias/compatibility all resolve', () => {
  assert.strictEqual(resolveAlias('commands', 'guild-ledger', base).status, 'primary');
  assert.strictEqual(resolveAlias('commands', 'augur', base).status, 'cross-alias');
  assert.strictEqual(resolveAlias('commands', 'owl', base).status, 'compatibility');
});

// 16. integration: the shipped registry (this is U3a's own output).
test('integration: shipped registry resolves across all four domains', () => {
  const opts = { registryPath: SHIPPED_REGISTRY, mythosHome: undefined, onWarn: () => {} };
  assert.strictEqual(resolveAlias('commands', 'owl', opts).id, 'orchestrate-loop');
  assert.strictEqual(resolveAlias('frameworks', 'qa', opts).id, 'wordpress/qa');
  assert.strictEqual(resolveAlias('frameworks', 'page-cro', opts).id, 'wordpress/page-cro');
  assert.strictEqual(resolveAlias('skills', 'manage-grimoires', opts).id, 'manage-frameworks');
  assert.strictEqual(resolveAlias('tools', 'verify-skill', opts).id, 'verify:skill');
});

// 17. default home resolution (matches init-mirror.cjs / inject-mirror.cjs).
test('resolveMythosHome: explicit $MYTHOS_HOME wins', () => {
  assert.strictEqual(
    resolveMythosHome({ env: { MYTHOS_HOME: '/somewhere/custom' }, homedir: '/home/z' }),
    '/somewhere/custom'
  );
});
test('resolveMythosHome: falls back to <homedir>/.mythos', () => {
  assert.strictEqual(
    resolveMythosHome({ env: {}, homedir: '/home/z' }),
    path.join('/home/z', '.mythos')
  );
});

// 18. default-home overlay is read when neither MYTHOS_HOME nor mythosHome is given.
test('default ~/.mythos overlay is read when home is not explicitly set', () => {
  const r = resolveAlias('commands', 'my-cmd', {
    registryPath, env: {}, homedir: fakeHome, onWarn: () => {},
  });
  assert.strictEqual(r.id, 'fakehome-target');
  assert.strictEqual(r.source, 'user');
});

// 19. explicit $MYTHOS_HOME still overrides the default home.
test('explicit $MYTHOS_HOME overrides the default ~/.mythos', () => {
  const r = resolveAlias('commands', 'my-cmd', {
    registryPath, env: { MYTHOS_HOME: userHome }, homedir: fakeHome, onWarn: () => {},
  });
  // userHome's overlay, not fakeHome/.mythos ('fakehome-target').
  assert.strictEqual(r.id, 'user-command-target');
  assert.strictEqual(r.source, 'user');
});

// ---- run -----------------------------------------------------------------

let passed = 0;
let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${err && err.message}`);
  }
}

// cleanup
try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) { /* noop */ }

console.log(`\n${passed} passed, ${failed} failed (${tests.length} tests)`);
process.exit(failed === 0 ? 0 : 1);
