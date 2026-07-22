'use strict';

/**
 * identity.js — optional, pluggable Dart write-identity gate.
 *
 * Some Dart write paths in this tool (createTask/updateTask/deleteTask/addComment,
 * via dart-api.js's ensureWriteIdentity, and the read-only inbox.js) can refuse to
 * proceed unless the configured DART_TOKEN's Dart user matches an expected
 * identity. This guards against a token seeded for the wrong Dart user silently
 * writing to the wrong workspace/account.
 *
 * This check is OPTIONAL and disabled by default. With no expected identity
 * configured, verifyDartIdentity() is a pass-through (`ok: true`) — set
 * DART_EXPECTED_USER_NAME and/or DART_EXPECTED_USER_EMAIL in your environment
 * to enable the gate for your own Dart workspace's user.
 */

const EXPECTED_DART_USER = Object.freeze({
  name: process.env.DART_EXPECTED_USER_NAME || '',
  email: process.env.DART_EXPECTED_USER_EMAIL || '',
});

function normalizeString(value) {
  return String(value || '').trim().toLowerCase();
}

function describeUser(user) {
  if (!user || typeof user !== 'object') return '(unknown user)';
  const name = user.name || '(no name)';
  const email = user.email || '(no email)';
  return `${name} <${email}>`;
}

/**
 * Verify the Dart /config response's `user` belongs to an expected identity.
 * Pass-through (`ok: true`) when no expected identity is configured — this
 * gate is opt-in, not a hardcoded requirement.
 * @param {Object} config - Dart /config response.
 * @param {{name?:string, email?:string}} [expectedUser] - defaults to the
 *   DART_EXPECTED_USER_NAME / DART_EXPECTED_USER_EMAIL env vars.
 * @returns {{ok:boolean, expected:Object, actual:Object, reason:string}}
 */
function verifyDartIdentity(config, expectedUser = EXPECTED_DART_USER) {
  const expectedName = normalizeString(expectedUser.name);
  const expectedEmail = normalizeString(expectedUser.email);

  if (!expectedName && !expectedEmail) {
    return {
      ok: true,
      expected: { name: '', email: '', label: '(not configured)' },
      actual: { name: '', email: '', label: '(not checked)' },
      reason: 'Dart write-identity verification is not configured (set DART_EXPECTED_USER_NAME '
        + 'and/or DART_EXPECTED_USER_EMAIL to enable it) — treating as verified.',
    };
  }

  const actual = config && config.user ? config.user : null;
  const actualName = normalizeString(actual && actual.name);
  const actualEmail = normalizeString(actual && actual.email);

  const ok = actualName === expectedName && actualEmail === expectedEmail;

  return {
    ok,
    expected: {
      name: expectedUser.name,
      email: expectedUser.email,
      label: describeUser(expectedUser),
    },
    actual: {
      name: actual && actual.name ? actual.name : '',
      email: actual && actual.email ? actual.email : '',
      label: describeUser(actual),
    },
    reason: ok
      ? 'Dart API identity matches the configured expected user.'
      : `Dart API identity mismatch: expected ${describeUser(expectedUser)}, got ${describeUser(actual)}.`,
  };
}

module.exports = {
  EXPECTED_DART_USER,
  describeUser,
  verifyDartIdentity,
};
