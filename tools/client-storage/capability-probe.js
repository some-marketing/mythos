'use strict';

// Non-secret readiness and account-binding probe for client-storage preflight.
// Probe results never expose credential values, account identifiers, or root
// identifiers. Real provider work is isolated in createProductionAdapters();
// tests inject adapters and therefore never resolve credentials or use the
// network.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function opaqueHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function profileEnvPrefix(provider, profile) {
  const normalized = String(profile).toUpperCase().replace(/[^A-Z0-9]/g, '_');
  if (provider === 'gdrive') return `GDRIVE_PROFILE_${normalized}`;
  const encoded = Buffer.from(String(profile).toLowerCase(), 'utf8').toString('hex').toUpperCase();
  return `MS_GRAPH_PROFILE_${encoded}`;
}

function defaultCredentialSourceProbe({ provider, profile, toolDir, env = process.env }) {
  const prefix = profileEnvPrefix(provider, profile);
  const envNames = provider === 'gdrive'
    ? [`${prefix}_CLIENT_ID`, `${prefix}_CLIENT_SECRET`, `${prefix}_REFRESH_TOKEN`]
    : [`${prefix}_CLIENT_ID`, `${prefix}_CLIENT_SECRET`, `${prefix}_REFRESH_TOKEN`];
  const localCache = provider === 'gdrive'
    ? path.join(toolDir, 'google-drive', `.oauth-creds.${String(profile).toLowerCase()}.json`)
    : null;
  const environment = envNames.every((name) => Boolean(env[name]));
  const localCachePresent = Boolean(localCache && fs.existsSync(localCache));

  return {
    available: environment || localCachePresent,
    sources: {
      local_cache_present: localCachePresent,
      environment_complete: environment,
      keychain_status: 'not_probed',
      onepassword_status: 'not_probed',
      env_file_status: 'not_probed'
    }
  };
}

async function defaultProviderIdentityProbe() {
  return {
    authenticated: false,
    status: 'not_probed',
    reason: 'provider identity adapter was not supplied'
  };
}

// Production-only adapter wiring. Secrets remain inside this closure and are
// never returned in capability results. Google account identity and canonical
// root are checked independently; quota is intentionally not queried here.
function createProductionAdapters({ toolDir = path.resolve(__dirname, '..') } = {}) {
  const sessions = new Map();

  async function credentialSourceProbe({ provider, profile }) {
    if (provider !== 'gdrive') {
      return {
        available: false,
        sources: { resolver_chain_status: 'unavailable' },
        error_code: 'PROVIDER_CREDENTIAL_ADAPTER_UNAVAILABLE'
      };
    }
    try {
      const { resolveCreds } = require(path.join(toolDir, 'google-drive', 'config.js'));
      const creds = resolveCreds(profile);
      const available = Boolean(creds && creds.clientId && creds.clientSecret && creds.refreshToken);
      if (available) sessions.set(`${provider}:${profile}`, creds);
      return {
        available,
        sources: { resolver_chain_status: available ? 'available' : 'unavailable' },
        error_code: available ? null : 'NAMED_PROFILE_UNAVAILABLE'
      };
    } catch {
      return {
        available: false,
        sources: { resolver_chain_status: 'error' },
        error_code: 'CREDENTIAL_RESOLVER_ERROR'
      };
    }
  }

  async function providerIdentityProbe({ provider, profile, canonicalRemoteRootId }) {
    if (provider !== 'gdrive') {
      return { authenticated: false, status: 'unverified', error_code: 'PROVIDER_IDENTITY_ADAPTER_UNAVAILABLE' };
    }
    const creds = sessions.get(`${provider}:${profile}`);
    if (!creds) {
      return { authenticated: false, status: 'unverified', error_code: 'PROFILE_SESSION_UNAVAILABLE' };
    }
    try {
      const { getAccessToken, apiRequest } = require(path.join(toolDir, 'google-drive', 'client.js'));
      const accessToken = await getAccessToken(creds);
      const about = await apiRequest({
        accessToken,
        method: 'GET',
        path: '/drive/v3/about?fields=user(emailAddress)'
      });
      const remoteRoot = await apiRequest({
        accessToken,
        method: 'GET',
        path: `/drive/v3/files/${encodeURIComponent(canonicalRemoteRootId)}?fields=id,trashed&supportsAllDrives=true`
      });
      const accountIdentity = about && about.user && about.user.emailAddress;
      return {
        authenticated: Boolean(accountIdentity),
        status: 'verified',
        account_identity_sha256: accountIdentity
          ? opaqueHash(String(accountIdentity).trim().toLowerCase())
          : null,
        remote_root_id: remoteRoot && !remoteRoot.trashed ? remoteRoot.id : null,
        error_code: accountIdentity ? null : 'PROVIDER_ACCOUNT_IDENTITY_MISSING'
      };
    } catch {
      return { authenticated: false, status: 'error', error_code: 'PROVIDER_IDENTITY_PROBE_ERROR' };
    }
  }

  return { credentialSourceProbe, providerIdentityProbe };
}

function expectedIdentityHash(fileStorage) {
  if (fileStorage.expected_account_identity_sha256) {
    return String(fileStorage.expected_account_identity_sha256).toLowerCase();
  }
  if (fileStorage.expected_account_identity) {
    return opaqueHash(String(fileStorage.expected_account_identity).trim().toLowerCase());
  }
  return null;
}

function canonicalRemoteRootId(fileStorage) {
  return fileStorage.remote_root_id || fileStorage.remote_root_item_id || null;
}

function sanitizeSourceStatuses(sources) {
  const safeStatuses = new Set(['available', 'unavailable', 'not_probed', 'error', 'unknown']);
  const sanitized = {};
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) return sanitized;
  for (const [key, value] of Object.entries(sources)) {
    if (!/^[a-z0-9_]{1,64}$/i.test(key)) continue;
    if (typeof value === 'boolean') sanitized[key] = value;
    else sanitized[key] = safeStatuses.has(value) ? value : 'unknown';
  }
  return sanitized;
}

function safeAdapterStatus(value) {
  return new Set(['verified', 'unverified', 'not_probed', 'error']).has(value)
    ? value
    : 'unverified';
}

// A storage surface declares the strongest readiness evidence this repository
// can actually obtain for it. API-backed surfaces bind provider account and
// remote root before copying. Mounted-volume surfaces bind the exact registered
// File Provider volume and path, but deliberately grant copy authority only --
// never provider-remote truth or deletion authority.
const READINESS_MODES = Object.freeze({
  gdrive: 'api-bound',
  onedrive: 'mounted-volume-copy-only'
});

function readinessModeForProvider(provider, { clientCode, fileStorage, resolved } = {}) {
  const requested = fileStorage && fileStorage.readiness_mode;
  if (!requested) return READINESS_MODES[provider] || null;
  if (requested === READINESS_MODES[provider]) return requested;
  // A Google account that cannot use the configured OAuth app may still be
  // enrolled as an exact macOS File Provider volume. Permit copy-only mounted
  // readiness only when the private registration binds the resolved volume
  // and the client's canonical Mythos destination. This never grants provider
  // truth or deletion authority, and keeps account identity out of the repo.
  if (
    requested === 'mounted-volume-copy-only' &&
    provider === 'gdrive' &&
    clientCode &&
    resolved &&
    fileStorage.mount_dir &&
    resolved.mountDirName === fileStorage.mount_dir &&
    path.resolve(resolved.mountedPath) === path.resolve(
      resolved.mountRoot,
      'My Drive',
      'Mythos',
      'Clients',
      clientCode
    )
  ) return requested;
  return null;
}

async function probeClientStorageCapabilities({
  clientCode,
  client,
  resolved,
  toolDir = path.resolve(__dirname, '..'),
  env = process.env,
  credentialSourceProbe = defaultCredentialSourceProbe,
  providerIdentityProbe = defaultProviderIdentityProbe
}) {
  const fileStorage = client && client.file_storage ? client.file_storage : {};
  const registeredPath = fileStorage.mounted_path ? path.resolve(fileStorage.mounted_path) : null;
  const registeredMountDir = fileStorage.mount_dir || resolved.mountDirName || null;
  const mountRelative = registeredPath && resolved.mountRoot
    ? path.relative(path.resolve(resolved.mountRoot), registeredPath)
    : null;
  const contained = Boolean(
    mountRelative && !mountRelative.startsWith('..') && !path.isAbsolute(mountRelative)
  );
  const mount = {
    registered: Boolean(registeredPath),
    path_match: registeredPath === path.resolve(resolved.mountedPath),
    basename_match: registeredMountDir === resolved.mountDirName,
    mount_dir_source: fileStorage.mount_dir ? 'registered' : 'derived',
    contained,
    mount_basename_hash: opaqueHash(resolved.mountDirName)
  };
  mount.ok = mount.registered && mount.path_match && mount.basename_match && mount.contained;

  const readinessMode = readinessModeForProvider(resolved.provider, {
    clientCode,
    fileStorage,
    resolved
  });
  const explicitMountDir = Boolean(
    typeof fileStorage.mount_dir === 'string' && fileStorage.mount_dir.trim()
  );

  if (!readinessMode) {
    return {
      schema: 'ClientStorageCapabilityProbe/1.0',
      client: clientCode,
      provider: resolved.provider,
      readiness_mode: 'unsupported',
      ok: false,
      mount,
      credential: { required: false, available: false, sources: {}, error_code: null },
      identity: { required: false, adapter_status: 'not_probed', ok: false, error_code: null },
      setup_required: false,
      registration_upgrade_required: false,
      blocker_code: 'UNSUPPORTED_STORAGE_SURFACE',
      truth_domain: 'unsupported',
      copy_authority: false,
      provider_remote_truth_established: false,
      deletion_authority: false
    };
  }

  if (readinessMode === 'mounted-volume-copy-only') {
    const ok = mount.ok && explicitMountDir;
    let blockerCode = null;
    if (!mount.ok) blockerCode = 'MOUNT_BINDING_MISMATCH';
    else if (!explicitMountDir) blockerCode = 'VOLUME_ENROLLMENT_REQUIRED';

    return {
      schema: 'ClientStorageCapabilityProbe/1.0',
      client: clientCode,
      provider: resolved.provider,
      readiness_mode: readinessMode,
      ok,
      mount,
      credential: {
        required: false,
        named_profile_configured: false,
        available: false,
        sources: {},
        error_code: null
      },
      identity: {
        required: false,
        adapter_status: 'not_probed',
        authenticated: false,
        expected_account_identity_configured: false,
        account_identity_match: false,
        canonical_remote_root_id_configured: false,
        remote_root_id_match: false,
        binding_basis: 'registered_mounted_volume',
        ok: false,
        error_code: null
      },
      setup_required: false,
      registration_upgrade_required: !explicitMountDir,
      blocker_code: blockerCode,
      truth_domain: 'mounted_volume_readiness',
      copy_authority: ok,
      provider_remote_truth_established: false,
      deletion_authority: false
    };
  }

  const profile = typeof fileStorage.credential_profile === 'string' && fileStorage.credential_profile.trim()
    ? fileStorage.credential_profile.trim()
    : null;
  let credential = { available: false, sources: {} };
  let credentialAdapterError = null;
  if (profile) {
    try {
      credential = await credentialSourceProbe({
        provider: resolved.provider,
        profile,
        toolDir,
        env
      });
    } catch {
      credential = { available: false, sources: { adapter_status: 'error' } };
      credentialAdapterError = 'CREDENTIAL_AVAILABILITY_PROBE_ERROR';
    }
  }
  const credentialResult = {
    required: true,
    named_profile_configured: Boolean(profile),
    available: Boolean(credential && credential.available),
    sources: sanitizeSourceStatuses(credential && credential.sources),
    error_code: credentialAdapterError || (
      credential && /^[A-Z0-9_]{1,64}$/.test(credential.error_code || '')
        ? credential.error_code
        : null
    )
  };

  const expectedHash = expectedIdentityHash(fileStorage);
  const expectedRootId = canonicalRemoteRootId(fileStorage);
  let providerEvidence = { authenticated: false, status: 'not_probed' };
  let identityAdapterError = null;
  if (profile && credentialResult.available && expectedHash && expectedRootId) {
    try {
      providerEvidence = await providerIdentityProbe({
        provider: resolved.provider,
        profile,
        expectedAccountIdentitySha256: expectedHash,
        canonicalRemoteRootId: expectedRootId
      });
    } catch {
      providerEvidence = { authenticated: false, status: 'error' };
      identityAdapterError = 'PROVIDER_IDENTITY_PROBE_ERROR';
    }
  }
  const observedHash = providerEvidence.account_identity_sha256
    ? String(providerEvidence.account_identity_sha256).toLowerCase()
    : providerEvidence.account_identity
      ? opaqueHash(String(providerEvidence.account_identity).trim().toLowerCase())
      : null;
  const observedRootId = providerEvidence.remote_root_id || providerEvidence.remote_root_item_id || null;
  const identity = {
    required: true,
    adapter_status: safeAdapterStatus(providerEvidence.status || (providerEvidence.authenticated ? 'verified' : 'unverified')),
    authenticated: Boolean(providerEvidence.authenticated),
    expected_account_identity_configured: Boolean(expectedHash),
    account_identity_match: Boolean(expectedHash && observedHash && expectedHash === observedHash),
    canonical_remote_root_id_configured: Boolean(expectedRootId),
    remote_root_id_match: Boolean(expectedRootId && observedRootId && expectedRootId === observedRootId),
    error_code: identityAdapterError || (
      providerEvidence && /^[A-Z0-9_]{1,64}$/.test(providerEvidence.error_code || '')
        ? providerEvidence.error_code
        : null
    )
  };
  identity.ok = identity.authenticated && identity.account_identity_match && identity.remote_root_id_match;

  const ok = mount.ok && credentialResult.named_profile_configured && credentialResult.available && identity.ok;
  let blockerCode = null;
  if (!mount.ok) blockerCode = 'MOUNT_BINDING_MISMATCH';
  else if (!profile || !expectedHash || !expectedRootId) blockerCode = 'IDENTITY_ENROLLMENT_REQUIRED';
  else if (credentialResult.error_code) blockerCode = credentialResult.error_code;
  else if (!credentialResult.available) blockerCode = 'NAMED_PROFILE_UNAVAILABLE';
  else if (identity.error_code) blockerCode = identity.error_code;
  else if (!identity.account_identity_match) blockerCode = 'PROVIDER_ACCOUNT_MISMATCH';
  else if (!identity.remote_root_id_match) blockerCode = 'CANONICAL_REMOTE_ROOT_MISMATCH';

  return {
    schema: 'ClientStorageCapabilityProbe/1.0',
    client: clientCode,
    provider: resolved.provider,
    readiness_mode: readinessMode || 'unsupported',
    ok,
    mount,
    credential: credentialResult,
    identity,
    setup_required: Boolean(
      profile &&
      !credentialResult.available &&
      (!credentialResult.error_code || credentialResult.error_code === 'NAMED_PROFILE_UNAVAILABLE')
    ),
    registration_upgrade_required: !profile || !expectedHash || !expectedRootId,
    blocker_code: blockerCode,
    truth_domain: 'readiness_binding',
    copy_authority: ok,
    provider_remote_truth_established: false,
    deletion_authority: false
  };
}

module.exports = {
  opaqueHash,
  createProductionAdapters,
  defaultCredentialSourceProbe,
  defaultProviderIdentityProbe,
  sanitizeSourceStatuses,
  readinessModeForProvider,
  probeClientStorageCapabilities
};
