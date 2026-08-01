'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { hasGraphCredentialsConfigured } = require('../lib.js');
const { verifyOneDriveGraphT0 } = require('../verify-remote.js');
const {
  getAccessToken,
  getOneDriveFreeBytes,
  identityHash,
  profilePrefix,
  requestJson
} = require('../../ms-graph/client.js');

const WORK_PREFIX = profilePrefix('work');
const PROFILE_ENV = {
  [`${WORK_PREFIX}_CLIENT_ID`]: 'synthetic-client-id',
  [`${WORK_PREFIX}_CLIENT_SECRET`]: 'synthetic-client-secret',
  [`${WORK_PREFIX}_REFRESH_TOKEN`]: 'synthetic-refresh-token',
  [`${WORK_PREFIX}_TENANT_ID`]: 'synthetic-tenant'
};

function graphResponses({ account = 'registered@example.com', driveId = 'drive-registered', rootId = 'root-registered', remaining = 4096 } = {}) {
  return async (options) => {
    if (options.path.startsWith('/v1.0/me?$select=')) {
      return { id: 'account-opaque', mail: account, userPrincipalName: account };
    }
    if (options.path.startsWith('/v1.0/me/drive?$select=')) {
      return { id: driveId, quota: { remaining } };
    }
    if (options.path.startsWith('/v1.0/me/drive/root?$select=')) {
      return { id: rootId, parentReference: { driveId } };
    }
    throw new Error('unexpected synthetic request');
  };
}

function transportResponse({ status = 200, body = '{}', networkError = false } = {}) {
  return {
    request(options, callback) {
      const request = new EventEmitter();
      request.write = () => {};
      request.end = () => {
        process.nextTick(() => {
          if (networkError) {
            request.emit('error', new Error('synthetic-provider-secret'));
            return;
          }
          const response = new EventEmitter();
          response.statusCode = status;
          callback(response);
          response.emit('data', body);
          response.emit('end');
        });
      };
      return request;
    }
  };
}

test('helper presence without complete named-profile credentials retains attestation eligibility', () => {
  assert.equal(hasGraphCredentialsConfigured('work', {}), false);
  assert.equal(hasGraphCredentialsConfigured('work', { MS_GRAPH_ACCESS_TOKEN: 'global-token-is-not-authority' }), false);
  assert.equal(hasGraphCredentialsConfigured('work', PROFILE_ENV), true);
  assert.equal(hasGraphCredentialsConfigured('other', PROFILE_ENV), false);
});

test('valid profile aliases have distinct reversible credential namespaces', () => {
  const hyphenPrefix = profilePrefix('work-prod');
  const underscorePrefix = profilePrefix('work_prod');
  assert.notEqual(hyphenPrefix, underscorePrefix);
  const env = { [`${hyphenPrefix}_ACCESS_TOKEN`]: 'hyphen-token' };
  assert.equal(hasGraphCredentialsConfigured('work-prod', env), true);
  assert.equal(hasGraphCredentialsConfigured('work_prod', env), false);
});

test('token resolution uses only the requested named profile', async () => {
  let observed;
  const token = await getAccessToken({
    profile: 'work',
    env: { ...PROFILE_ENV, MS_GRAPH_CLIENT_SECRET: 'global-secret-must-not-be-used' },
    request: async (options, body) => {
      observed = { options, body };
      return { access_token: 'synthetic-access-token' };
    }
  });
  assert.equal(token, 'synthetic-access-token');
  assert.match(observed.options.path, /synthetic-tenant/);
  assert.match(observed.body, /synthetic-client-secret/);
  assert.doesNotMatch(observed.body, /global-secret-must-not-be-used/);
});

test('quota rejects a wrong account before accepting provider space', async () => {
  await assert.rejects(
    getOneDriveFreeBytes({
      profile: 'work',
      accessToken: 'synthetic-token',
      expectedAccountIdentitySha256: identityHash('registered@example.com'),
      remoteRootId: 'drive-registered',
      request: graphResponses({ account: 'wrong@example.com' })
    }),
    { code: 'GRAPH_ACCOUNT_MISMATCH' }
  );
});

test('quota rejects a wrong drive/root binding', async () => {
  await assert.rejects(
    getOneDriveFreeBytes({
      profile: 'work',
      accessToken: 'synthetic-token',
      expectedAccountIdentitySha256: identityHash('registered@example.com'),
      remoteRootId: 'wrong-root',
      request: graphResponses()
    }),
    { code: 'GRAPH_REMOTE_ROOT_MISMATCH' }
  );
});

test('quota accepts a matching named account and registered drive/root', async () => {
  const freeBytes = await getOneDriveFreeBytes({
    profile: 'work',
    accessToken: 'synthetic-token',
    expectedAccountIdentitySha256: identityHash('registered@example.com'),
    remoteRootId: 'root-registered',
    request: graphResponses({ remaining: 8192 })
  });
  assert.equal(freeBytes, 8192);
});

test('token, HTTP, JSON, and network errors remain stable and secret-safe', async (t) => {
  await t.test('token response', async () => {
    await assert.rejects(
      getAccessToken({ profile: 'work', env: PROFILE_ENV, request: async () => ({}) }),
      { code: 'GRAPH_TOKEN_INVALID' }
    );
  });
  for (const fixture of [
    { name: 'HTTP', transport: transportResponse({ status: 403, body: '{"detail":"synthetic-provider-secret"}' }), code: 'GRAPH_HTTP_ERROR' },
    { name: 'JSON', transport: transportResponse({ body: 'synthetic-provider-secret' }), code: 'GRAPH_JSON_ERROR' },
    { name: 'network', transport: transportResponse({ networkError: true }), code: 'GRAPH_NETWORK_ERROR' }
  ]) {
    await t.test(fixture.name, async () => {
      let caught;
      try {
        await requestJson({ hostname: 'graph.microsoft.com', path: '/synthetic' }, null, fixture.transport);
      } catch (error) {
        caught = error;
      }
      assert.equal(caught.code, fixture.code);
      assert.equal(JSON.stringify(caught).includes('synthetic-provider-secret'), false);
      assert.equal(caught.message.includes('synthetic-provider-secret'), false);
    });
  }
});

const T0_STORAGE = {
  credential_profile: 'work-prod',
  expected_account_identity_sha256: identityHash('registered@example.com'),
  remote_root_id: 'drive-registered',
  drive_id: 'drive-registered',
  remote_root_item_id: 'root-item-registered'
};
const T0_ITEMS = [{
  identity: 'item-opaque',
  relPath: 'reference/file.bin',
  preserved: true,
  entry: { size: 5, quick_xor_hash: 'quickxor-expected' }
}];

function t0Dependencies(overrides = {}) {
  return {
    storage: { ...T0_STORAGE, ...(overrides.storage || {}) },
    priorIdentities: new Map(),
    graphClient: overrides.graphClient || {
      getOneDriveQuotaEvidence: async () => ({ remaining: 4096, driveId: 'drive-registered', rootId: 'root-drive' }),
      getAccessToken: async () => 'synthetic-token'
    },
    httpsJson: overrides.httpsJson || (async ({ requestPath }) => {
      if (requestPath.includes('?$select=id,parentReference')) return { id: 'root-item-registered' };
      return { id: 'item-remote', size: 5, file: { hashes: { quickXorHash: 'quickxor-expected' } } };
    })
  };
}

test('fully bound Graph evidence can establish provider T0 without granting deletion authority', async () => {
  const result = await verifyOneDriveGraphT0('TEST', T0_ITEMS, t0Dependencies());
  assert.equal(result.mismatches, 0);
  assert.equal(result.provider_remote_truth_established, true);
  assert.equal(result.deletion_authority, false);
});

test('wrong account, root, drive, item, hash, size, HTTP, and network evidence never establish T0', async (t) => {
  for (const fixture of [
    { name: 'account', graphCode: 'GRAPH_ACCOUNT_MISMATCH' },
    { name: 'root', graphCode: 'GRAPH_REMOTE_ROOT_MISMATCH' }
  ]) {
    await t.test(fixture.name, async () => {
      const graphClient = {
        getOneDriveQuotaEvidence: async () => { throw Object.assign(new Error('synthetic-provider-secret'), { code: fixture.graphCode }); },
        getAccessToken: async () => 'synthetic-token'
      };
      await assert.rejects(verifyOneDriveGraphT0('TEST', T0_ITEMS, t0Dependencies({ graphClient })), { code: fixture.graphCode });
    });
  }

  await t.test('drive', async () => {
    const graphClient = {
      getOneDriveQuotaEvidence: async () => ({ remaining: 4096, driveId: 'wrong-drive', rootId: 'root-drive' }),
      getAccessToken: async () => 'synthetic-token'
    };
    await assert.rejects(verifyOneDriveGraphT0('TEST', T0_ITEMS, t0Dependencies({ graphClient })), { code: 'GRAPH_DRIVE_MISMATCH' });
  });

  await t.test('root item', async () => {
    const dependencies = t0Dependencies({
      httpsJson: async ({ requestPath }) => requestPath.includes('?$select=id,parentReference')
        ? { id: 'wrong-root-item' }
        : { id: 'item-remote', size: 5, file: { hashes: { quickXorHash: 'quickxor-expected' } } }
    });
    await assert.rejects(verifyOneDriveGraphT0('TEST', T0_ITEMS, dependencies), { code: 'GRAPH_REMOTE_ITEM_MISMATCH' });
  });

  for (const fixture of [
    { name: 'hash', size: 5, hash: 'wrong-hash' },
    { name: 'size', size: 6, hash: 'quickxor-expected' }
  ]) {
    await t.test(fixture.name, async () => {
      const dependencies = t0Dependencies({
        httpsJson: async ({ requestPath }) => requestPath.includes('?$select=id,parentReference')
          ? { id: 'root-item-registered' }
          : { id: 'item-remote', size: fixture.size, file: { hashes: { quickXorHash: fixture.hash } } }
      });
      const result = await verifyOneDriveGraphT0('TEST', T0_ITEMS, dependencies);
      assert.equal(result.mismatches, 1);
      assert.equal(result.provider_remote_truth_established, false);
      assert.equal(result.deletion_authority, false);
    });
  }

  for (const fixture of [
    { name: 'HTTP', code: 'GRAPH_HTTP_ERROR' },
    { name: 'network', code: 'GRAPH_NETWORK_ERROR' }
  ]) {
    await t.test(fixture.name, async () => {
      const dependencies = t0Dependencies({
        httpsJson: async () => { throw Object.assign(new Error('synthetic-provider-secret'), { code: fixture.code }); }
      });
      await assert.rejects(verifyOneDriveGraphT0('TEST', T0_ITEMS, dependencies), { code: fixture.code });
    });
  }
});
