'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  opaqueHash,
  createProductionAdapters,
  readinessModeForProvider,
  probeClientStorageCapabilities
} = require('../capability-probe.js');

function fixture(overrides = {}) {
  const mountRoot = path.resolve('/tmp/CloudStorage/GoogleDrive-account');
  const mountedPath = path.join(mountRoot, 'My Drive', 'Mythos', 'Clients', 'TEST');
  const accountHash = opaqueHash('account@example.com');
  return {
    clientCode: 'TEST',
    client: {
      file_storage: {
        provider: 'gdrive',
        mounted_path: mountedPath,
        mount_dir: 'GoogleDrive-account',
        credential_profile: 'work',
        expected_account_identity_sha256: accountHash,
        remote_root_id: 'root-opaque',
        ...(overrides.file_storage || {})
      }
    },
    resolved: {
      provider: 'gdrive',
      mountedPath,
      mountRoot,
      mountDirName: 'GoogleDrive-account'
    },
    accountHash
  };
}

test('probe binds mount, named profile, provider account and canonical root without exposing identity', async () => {
  const f = fixture();
  const result = await probeClientStorageCapabilities({
    clientCode: f.clientCode,
    client: f.client,
    resolved: f.resolved,
    credentialSourceProbe: async () => ({
      available: true,
      sources: { local_cache_present: true, keychain_status: 'not_probed' }
    }),
    providerIdentityProbe: async () => ({
      authenticated: true,
      status: 'verified',
      account_identity_sha256: f.accountHash,
      remote_root_id: 'root-opaque'
    })
  });

  assert.equal(result.ok, true);
  assert.equal(result.readiness_mode, 'api-bound');
  assert.equal(result.copy_authority, true);
  assert.equal(result.identity.account_identity_match, true);
  assert.equal(result.identity.remote_root_id_match, true);
  assert.equal(result.provider_remote_truth_established, false);
  assert.equal(result.deletion_authority, false);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('account@example.com'), false);
  assert.equal(serialized.includes('root-opaque'), false);
});

test('mounted OneDrive volume grants copy-only readiness without credentials or remote-truth claims', async () => {
  const mountRoot = path.resolve('/tmp/CloudStorage/OneDrive-Organization');
  const mountedPath = path.join(mountRoot, 'Organization', 'TEST');
  let adapterCalls = 0;
  const result = await probeClientStorageCapabilities({
    clientCode: 'TEST',
    client: {
      file_storage: {
        provider: 'onedrive',
        mounted_path: mountedPath,
        mount_dir: 'OneDrive-Organization',
        manifest: 'storage-map.json'
      }
    },
    resolved: {
      provider: 'onedrive',
      mountedPath,
      mountRoot,
      mountDirName: 'OneDrive-Organization'
    },
    credentialSourceProbe: async () => { adapterCalls += 1; throw new Error('must not run'); },
    providerIdentityProbe: async () => { adapterCalls += 1; throw new Error('must not run'); }
  });

  assert.equal(result.ok, true);
  assert.equal(result.readiness_mode, 'mounted-volume-copy-only');
  assert.equal(result.copy_authority, true);
  assert.equal(result.credential.required, false);
  assert.equal(result.identity.required, false);
  assert.equal(result.identity.binding_basis, 'registered_mounted_volume');
  assert.equal(result.provider_remote_truth_established, false);
  assert.equal(result.deletion_authority, false);
  assert.equal(adapterCalls, 0);
});

test('enrolled personal Google volume can grant client-bound copy-only readiness without OAuth', async () => {
  const mountRoot = path.resolve('/tmp/CloudStorage/GoogleDrive-personal-account');
  const mountedPath = path.join(mountRoot, 'My Drive', 'Mythos', 'Clients', 'CLIENT_PERSONAL');
  const result = await probeClientStorageCapabilities({
    clientCode: 'CLIENT_PERSONAL',
    client: { file_storage: {
      provider: 'gdrive',
      mounted_path: mountedPath,
      mount_dir: 'GoogleDrive-personal-account',
      readiness_mode: 'mounted-volume-copy-only'
    } },
    resolved: {
      provider: 'gdrive',
      mountedPath,
      mountRoot,
      mountDirName: 'GoogleDrive-personal-account'
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.readiness_mode, 'mounted-volume-copy-only');
  assert.equal(result.copy_authority, true);
  assert.equal(result.provider_remote_truth_established, false);
  assert.equal(result.deletion_authority, false);
});

test('mounted Google override is refused without an exact private registration', async () => {
  const f = fixture({ file_storage: { readiness_mode: 'mounted-volume-copy-only' } });
  const client = structuredClone(f.client);
  delete client.file_storage.mount_dir;
  const result = await probeClientStorageCapabilities({
    clientCode: f.clientCode,
    client,
    resolved: f.resolved
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker_code, 'UNSUPPORTED_STORAGE_SURFACE');
  assert.equal(result.copy_authority, false);
});

test('personal Google mounted override rejects a same-volume wrong destination', async () => {
  const mountRoot = path.resolve('/tmp/CloudStorage/GoogleDrive-personal-account');
  const mountedPath = path.join(mountRoot, 'My Drive', 'Other', 'CLIENT_PERSONAL');
  const result = await probeClientStorageCapabilities({
    clientCode: 'CLIENT_PERSONAL',
    client: { file_storage: {
      provider: 'gdrive',
      mounted_path: mountedPath,
      mount_dir: 'GoogleDrive-personal-account',
      readiness_mode: 'mounted-volume-copy-only'
    } },
    resolved: {
      provider: 'gdrive',
      mountedPath,
      mountRoot,
      mountDirName: 'GoogleDrive-personal-account'
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker_code, 'UNSUPPORTED_STORAGE_SURFACE');
  assert.equal(result.copy_authority, false);
});

test('mounted-volume readiness requires an explicit mount registration and fails closed', async () => {
  const mountRoot = path.resolve('/tmp/CloudStorage/OneDrive-Organization');
  const mountedPath = path.join(mountRoot, 'Organization', 'TEST');
  const result = await probeClientStorageCapabilities({
    clientCode: 'TEST',
    client: { file_storage: { provider: 'onedrive', mounted_path: mountedPath } },
    resolved: {
      provider: 'onedrive',
      mountedPath,
      mountRoot,
      mountDirName: 'OneDrive-Organization'
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.copy_authority, false);
  assert.equal(result.registration_upgrade_required, true);
  assert.equal(result.setup_required, false);
  assert.equal(result.blocker_code, 'VOLUME_ENROLLMENT_REQUIRED');
});

test('readiness policy is explicit for every supported storage surface', () => {
  assert.equal(readinessModeForProvider('gdrive'), 'api-bound');
  assert.equal(readinessModeForProvider('onedrive'), 'mounted-volume-copy-only');
  assert.equal(readinessModeForProvider('unknown'), null);
});

test('unknown storage surfaces fail closed without invoking adapters', async () => {
  const mountRoot = path.resolve('/tmp/CloudStorage/FutureVolume');
  const mountedPath = path.join(mountRoot, 'TEST');
  let calls = 0;
  const result = await probeClientStorageCapabilities({
    clientCode: 'TEST',
    client: { file_storage: { provider: 'future', mounted_path: mountedPath, mount_dir: 'FutureVolume' } },
    resolved: { provider: 'future', mountedPath, mountRoot, mountDirName: 'FutureVolume' },
    credentialSourceProbe: async () => { calls += 1; },
    providerIdentityProbe: async () => { calls += 1; }
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker_code, 'UNSUPPORTED_STORAGE_SURFACE');
  assert.equal(result.copy_authority, false);
  assert.equal(result.deletion_authority, false);
  assert.equal(calls, 0);
});

test('probe fails closed when profile sources or provider evidence are unavailable', async () => {
  const f = fixture();
  let providerCalls = 0;
  const result = await probeClientStorageCapabilities({
    clientCode: f.clientCode,
    client: f.client,
    resolved: f.resolved,
    credentialSourceProbe: async () => ({ available: false, sources: { environment_complete: false } }),
    providerIdentityProbe: async () => {
      providerCalls += 1;
      return { authenticated: true };
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.setup_required, true);
  assert.equal(providerCalls, 0);
});

test('legacy registration derives mount basename but requires identity enrollment, not credential setup', async () => {
  const f = fixture();
  delete f.client.file_storage.mount_dir;
  delete f.client.file_storage.credential_profile;
  delete f.client.file_storage.expected_account_identity_sha256;
  delete f.client.file_storage.remote_root_id;
  const result = await probeClientStorageCapabilities({
    clientCode: f.clientCode,
    client: f.client,
    resolved: f.resolved
  });

  assert.equal(result.mount.ok, true);
  assert.equal(result.mount.mount_dir_source, 'derived');
  assert.equal(result.registration_upgrade_required, true);
  assert.equal(result.setup_required, false);
  assert.equal(result.blocker_code, 'IDENTITY_ENROLLMENT_REQUIRED');
});

test('account mismatch fails closed without incorrectly requesting credential setup', async () => {
  const f = fixture();
  const result = await probeClientStorageCapabilities({
    clientCode: f.clientCode,
    client: f.client,
    resolved: f.resolved,
    credentialSourceProbe: async () => ({ available: true, sources: { onepassword_status: 'available' } }),
    providerIdentityProbe: async () => ({
      authenticated: true,
      status: 'verified',
      account_identity_sha256: opaqueHash('wrong@example.com'),
      remote_root_id: 'root-opaque'
    })
  });

  assert.equal(result.ok, false);
  assert.equal(result.identity.account_identity_match, false);
  assert.equal(result.setup_required, false);
});

test('probe rejects mount basename mismatch and containment escape', async () => {
  const f = fixture({ file_storage: { mount_dir: 'GoogleDrive-other' } });
  f.client.file_storage.mounted_path = path.resolve(f.resolved.mountRoot, '..', 'GoogleDrive-other', 'TEST');
  const result = await probeClientStorageCapabilities({
    clientCode: f.clientCode,
    client: f.client,
    resolved: f.resolved,
    credentialSourceProbe: async () => ({ available: true, sources: {} }),
    providerIdentityProbe: async () => ({
      authenticated: true,
      account_identity_sha256: f.accountHash,
      remote_root_id: 'root-opaque'
    })
  });

  assert.equal(result.ok, false);
  assert.equal(result.mount.path_match, false);
  assert.equal(result.mount.basename_match, false);
  assert.equal(result.mount.contained, false);
});

test('probe reports only booleans/status when source adapter encounters credential-like values', async () => {
  const f = fixture();
  const secret = crypto.randomBytes(24).toString('hex');
  const result = await probeClientStorageCapabilities({
    clientCode: f.clientCode,
    client: f.client,
    resolved: f.resolved,
    credentialSourceProbe: async () => ({
      available: true,
      sources: { environment_complete: true, unsafe_detail: secret },
      ignored_secret: secret
    }),
    providerIdentityProbe: async () => ({
      authenticated: true,
      account_identity_sha256: f.accountHash,
      remote_root_id: 'root-opaque'
    })
  });

  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.deepEqual(result.credential.sources, { environment_complete: true, unsafe_detail: 'unknown' });
});

test('adapter exceptions become stable codes without raw secret, identity, root, or path text', async () => {
  const f = fixture();
  const sensitive = 'secret account@example.com root-opaque /private/credential.json';
  const credentialFailure = await probeClientStorageCapabilities({
    clientCode: f.clientCode,
    client: f.client,
    resolved: f.resolved,
    credentialSourceProbe: async () => { throw new Error(sensitive); }
  });
  assert.equal(credentialFailure.credential.error_code, 'CREDENTIAL_AVAILABILITY_PROBE_ERROR');
  assert.equal(JSON.stringify(credentialFailure).includes(sensitive), false);

  const identityFailure = await probeClientStorageCapabilities({
    clientCode: f.clientCode,
    client: f.client,
    resolved: f.resolved,
    credentialSourceProbe: async () => ({ available: true, sources: {} }),
    providerIdentityProbe: async () => { throw new Error(sensitive); }
  });
  assert.equal(identityFailure.identity.error_code, 'PROVIDER_IDENTITY_PROBE_ERROR');
  assert.equal(JSON.stringify(identityFailure).includes('account@example.com'), false);
  assert.equal(JSON.stringify(identityFailure).includes('/private/credential.json'), false);
});

test('production Google adapters use the named resolver and bind account/root without returning secrets', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capability-production-adapter-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const googleDir = path.join(root, 'google-drive');
  fs.mkdirSync(googleDir, { recursive: true });
  fs.writeFileSync(path.join(googleDir, 'config.js'), [
    "'use strict';",
    "exports.resolveCreds = (profile) => profile === 'work'",
    "  ? { clientId: 'fixture-client', clientSecret: 'fixture-secret', refreshToken: 'fixture-refresh' }",
    "  : {};"
  ].join('\n'));
  fs.writeFileSync(path.join(googleDir, 'client.js'), [
    "'use strict';",
    "exports.getAccessToken = async (creds) => creds.clientSecret === 'fixture-secret' ? 'fixture-token' : '';",
    "exports.apiRequest = async ({ path }) => path.includes('/about?')",
    "  ? { user: { emailAddress: 'account@example.com' } }",
    "  : { id: 'root-opaque', trashed: false };"
  ].join('\n'));
  const adapters = createProductionAdapters({ toolDir: root });
  const credential = await adapters.credentialSourceProbe({ provider: 'gdrive', profile: 'work' });
  assert.deepEqual(credential.sources, { resolver_chain_status: 'available' });
  const identity = await adapters.providerIdentityProbe({
    provider: 'gdrive',
    profile: 'work',
    canonicalRemoteRootId: 'root-opaque'
  });
  assert.equal(identity.authenticated, true);
  assert.equal(identity.account_identity_sha256, opaqueHash('account@example.com'));
  const serialized = JSON.stringify({ credential, identity });
  assert.equal(serialized.includes('fixture-secret'), false);
  assert.equal(serialized.includes('fixture-refresh'), false);
  assert.equal(serialized.includes('account@example.com'), false);
});

test('production named-profile absence requests setup while resolver errors do not', async () => {
  const f = fixture();
  const unavailable = await probeClientStorageCapabilities({
    clientCode: f.clientCode,
    client: f.client,
    resolved: f.resolved,
    credentialSourceProbe: async () => ({
      available: false,
      sources: { resolver_chain_status: 'unavailable' },
      error_code: 'NAMED_PROFILE_UNAVAILABLE'
    })
  });
  assert.equal(unavailable.setup_required, true);
  assert.equal(unavailable.blocker_code, 'NAMED_PROFILE_UNAVAILABLE');

  const resolverError = await probeClientStorageCapabilities({
    clientCode: f.clientCode,
    client: f.client,
    resolved: f.resolved,
    credentialSourceProbe: async () => ({
      available: false,
      sources: { resolver_chain_status: 'error' },
      error_code: 'CREDENTIAL_RESOLVER_ERROR'
    })
  });
  assert.equal(resolverError.setup_required, false);
  assert.equal(resolverError.blocker_code, 'CREDENTIAL_RESOLVER_ERROR');
});
