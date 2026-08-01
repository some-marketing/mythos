'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  USAGE,
  parseArgs,
  fromClientJson,
  resolveClientInputs,
  saveLocalCredentials,
  persistCredentials,
  openBrowser,
  main
} = require('./authorize');
const {
  normalizeProfile,
  profileCredsConfig,
  profileCredsFile,
  profileOnePasswordLocation,
  saveToOnePassword
} = require('./config');

const SENTINELS = ['RAW_SECRET_SENTINEL', '/private/sentinel-client.json', 'RAW_PROVIDER_DIAGNOSTIC'];

function assertNoSentinels(value) {
  const rendered = String(value);
  for (const sentinel of SENTINELS) assert.doesNotMatch(rendered, new RegExp(sentinel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

test('parseArgs accepts a named profile and client JSON path', () => {
  assert.deepEqual(
    parseArgs(['--profile', 'SomeMarketing', '--client-json', '/tmp/client.json']),
    { help: false, profile: 'somemarketing', clientJson: '/tmp/client.json' }
  );
});

test('parseArgs rejects invalid and missing profile values', () => {
  assert.throws(() => parseArgs(['--profile', '../default']), /letters, digits/);
  assert.throws(() => parseArgs(['--profile']), /needs a value/);
  assert.throws(
    () => parseArgs(['--RAW_SECRET_SENTINEL']),
    (error) => {
      assert.equal(error.message, 'AUTH_ARGUMENT_INVALID: Unknown option. Run with --help for supported options.');
      assertNoSentinels(error.message);
      return true;
    }
  );
});

test('help text documents profile enrollment', () => {
  assert.equal(parseArgs(['--help']).help, true);
  assert.match(USAGE, /--profile somemarketing --client-json/);
});

test('help short-circuits every credential, file, server, browser, and persistence dependency', () => {
  const logs = [];
  const forbidden = () => { throw new Error('RAW_SECRET_SENTINEL'); };
  const result = main(['--help'], {
    log: (message) => logs.push(message),
    error: forbidden,
    readFileSync: forbidden,
    resolveCreds: forbidden,
    startAuthorization: forbidden,
    execFileSync: forbidden,
    saveToOnePassword: forbidden
  });
  assert.equal(result, 0);
  assert.deepEqual(logs, [USAGE]);
});

test('client JSON failures expose only a stable content-free code and message', () => {
  for (const readFailure of [
    () => { throw new Error('RAW_SECRET_SENTINEL /private/sentinel-client.json'); },
    () => '{"installed":{"client_id":"RAW_SECRET_SENTINEL"',
    () => JSON.stringify({ installed: { client_id: 'present-but-incomplete' } })
  ]) {
    assert.throws(
      () => fromClientJson('/private/sentinel-client.json', readFailure),
      (error) => {
        assert.equal(error.code, 'AUTH_CLIENT_JSON_INVALID');
        assert.equal(error.message, 'AUTH_CLIENT_JSON_INVALID: OAuth client JSON could not be read or validated.');
        assertNoSentinels(error.message);
        return true;
      }
    );
  }

  const errors = [];
  const exitCode = main(['--client-json', '/private/sentinel-client.json'], {
    readFileSync: () => { throw new Error('RAW_PROVIDER_DIAGNOSTIC RAW_SECRET_SENTINEL'); },
    error: (message) => errors.push(message),
    log: () => { throw new Error('unexpected log'); }
  });
  assert.equal(exitCode, 1);
  assert.deepEqual(errors, ['AUTH_CLIENT_JSON_INVALID: OAuth client JSON could not be read or validated.']);
  errors.forEach(assertNoSentinels);
});

test('complete explicit client inputs bypass stored credential resolution', () => {
  let resolverCalled = false;
  const result = resolveClientInputs(
    'somemarketing',
    { clientId: 'json-id', clientSecret: 'json-secret' },
    {},
    () => {
      resolverCalled = true;
      throw new Error('must not resolve');
    }
  );
  assert.deepEqual(result, { clientId: 'json-id', clientSecret: 'json-secret' });
  assert.equal(resolverCalled, false);
});

test('env, client JSON, and stored partial inputs preserve explicit precedence', () => {
  let calls = 0;
  const resolver = (profile) => {
    calls += 1;
    assert.equal(profile, 'somemarketing');
    return { clientId: 'stored-id', clientSecret: 'stored-secret' };
  };

  assert.deepEqual(
    resolveClientInputs('somemarketing', { clientId: 'json-id', clientSecret: 'json-secret' }, { GOOGLE_OAUTH_CLIENT_ID: 'env-id' }, resolver),
    { clientId: 'env-id', clientSecret: 'json-secret' }
  );
  assert.equal(calls, 0);

  assert.deepEqual(
    resolveClientInputs('somemarketing', { clientId: 'json-id' }, { GOOGLE_OAUTH_CLIENT_ID: 'env-id' }, resolver),
    { clientId: 'env-id', clientSecret: 'stored-secret' }
  );
  assert.equal(calls, 1);

  assert.deepEqual(
    resolveClientInputs('somemarketing', {}, {}, resolver),
    { clientId: 'stored-id', clientSecret: 'stored-secret' }
  );
  assert.equal(calls, 2);
});

test('named profile read and write locations remain isolated from default', () => {
  const defaultFile = profileCredsFile(null);
  const profileFile = profileCredsFile('somemarketing');
  assert.notEqual(profileFile, defaultFile);
  assert.equal(path.basename(profileFile), '.oauth-creds.somemarketing.json');

  const config = profileCredsConfig('somemarketing');
  assert.equal(config.fields.GOOGLE_OAUTH_CLIENT_ID.envVar, 'GDRIVE_PROFILE_SOMEMARKETING_CLIENT_ID');
  assert.equal(config.fields.GOOGLE_OAUTH_REFRESH_TOKEN.keychainService, 'mythos-google-drive-somemarketing');
  assert.equal(config.fields.GOOGLE_OAUTH_REFRESH_TOKEN.opItem, 'Mythos Google Drive (somemarketing)');
  assert.deepEqual(profileOnePasswordLocation('somemarketing'), {
    vault: process.env.GDRIVE_OP_VAULT || 'Automation',
    item: process.env.GDRIVE_PROFILE_SOMEMARKETING_OP_ITEM || 'Mythos Google Drive (somemarketing)'
  });
});

test('default profile behavior remains backward compatible', () => {
  assert.equal(normalizeProfile('default'), null);
  assert.equal(path.basename(profileCredsFile()), '.oauth-creds.json');
  assert.deepEqual(profileOnePasswordLocation(), {
    vault: process.env.GDRIVE_OP_VAULT || 'Automation',
    item: process.env.GDRIVE_OP_ITEM || 'Mythos Google Drive'
  });
});

test('local fallback uses the exact profile cache path and forces 0600 for new and existing files', () => {
  const credentials = { clientId: 'id', clientSecret: 'secret', refreshToken: 'token' };
  for (const initialMode of [undefined, 0o644]) {
    const calls = [];
    let mode = initialMode;
    const fakeFs = {
      writeFileSync(file, payload, options) {
        calls.push(['write', file, options]);
        assert.match(payload, /"refresh_token": "token"/);
        if (mode === undefined) mode = options.mode;
      },
      chmodSync(file, nextMode) {
        calls.push(['chmod', file, nextMode]);
        mode = nextMode;
      }
    };
    const exactPath = profileCredsFile('somemarketing');
    assert.equal(saveLocalCredentials(credentials, 'somemarketing', fakeFs), exactPath);
    assert.deepEqual(calls, [
      ['write', exactPath, { mode: 0o600 }],
      ['chmod', exactPath, 0o600]
    ]);
    assert.equal(mode, 0o600);
    assert.notEqual(exactPath, profileCredsFile());
  }
});

test('persistence fallback remains isolated for named and default profiles without surfacing provider errors', () => {
  const writes = [];
  const fakeFs = {
    writeFileSync(file, payload, options) { writes.push({ file, payload, options }); },
    chmodSync() {}
  };
  const credentials = { clientId: 'id', clientSecret: 'RAW_SECRET_SENTINEL', refreshToken: 'token' };
  const unavailable = () => { throw new Error('RAW_PROVIDER_DIAGNOSTIC RAW_SECRET_SENTINEL'); };

  const named = persistCredentials(credentials, 'somemarketing', { saveToOnePassword: unavailable, fs: fakeFs });
  const defaultResult = persistCredentials(credentials, null, { saveToOnePassword: unavailable, fs: fakeFs });
  assert.deepEqual(named, { storage: 'local-file', location: profileCredsFile('somemarketing') });
  assert.deepEqual(defaultResult, { storage: 'local-file', location: profileCredsFile() });
  assert.notEqual(named.location, defaultResult.location);
  assertNoSentinels(JSON.stringify({ storage: named.storage, location: named.location }));
});

test('1Password persistence uses exact argv and suppresses all subprocess diagnostics', () => {
  const creds = { clientId: 'id', clientSecret: 'secret', refreshToken: 'token' };
  const location = profileOnePasswordLocation('somemarketing');

  const editCalls = [];
  saveToOnePassword(creds, 'somemarketing', (...args) => { editCalls.push(args); });
  assert.deepEqual(editCalls, [
    ['op', ['item', 'get', location.item, '--vault', location.vault], { stdio: 'ignore' }],
    ['op', ['item', 'edit', location.item, '--vault', location.vault,
      'client_id[text]=id', 'client_secret[password]=secret', 'refresh_token[password]=token'], { stdio: 'ignore' }]
  ]);

  const createCalls = [];
  saveToOnePassword(creds, 'somemarketing', (...args) => {
    createCalls.push(args);
    if (createCalls.length === 1) throw new Error('RAW_PROVIDER_DIAGNOSTIC');
  });
  assert.deepEqual(createCalls, [
    ['op', ['item', 'get', location.item, '--vault', location.vault], { stdio: 'ignore' }],
    ['op', ['item', 'create', '--category', 'API Credential', '--title', location.item, '--vault', location.vault,
      'client_id[text]=id', 'client_secret[password]=secret', 'refresh_token[password]=token'], { stdio: 'ignore' }]
  ]);
});

test('browser launch uses exact argv and suppresses diagnostics', () => {
  const calls = [];
  const url = 'https://accounts.example.test/authorize?client_id=id';
  assert.equal(openBrowser(url, (...args) => calls.push(args)), true);
  assert.deepEqual(calls, [['open', [url], { stdio: 'ignore' }]]);
  assert.equal(openBrowser(url, () => { throw new Error('RAW_PROVIDER_DIAGNOSTIC'); }), false);
});
