'use strict';

/**
 * Tests for the data-sensitivity classifier (S2).
 * Repo convention: node --test (NOT jest).
 *
 * Coverage: positive + negative for EVERY predicate (incl. live_server_logs);
 * fail-closed on null/garbled/unknown; a plainly-public/system-code payload is
 * NOT sensitive; an object payload with a nested credential IS sensitive; a
 * clients/** path reference IS sensitive; the fail-closed-on-unknown invariant.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const C = require('../data-sensitivity-classifier.js');

/** Normalize a raw payload for helper-level tests. */
function ctx(payload) {
  return C.normalizePayload(payload);
}

// ---------------------------------------------------------------------------
// Predicate table shape.
// ---------------------------------------------------------------------------
describe('predicate table', () => {
  it('exports the 6 named predicates with matches docs + fns', () => {
    const names = C.PREDICATES.map((p) => p.name);
    assert.deepEqual(names, [
      'pii',
      'credentials',
      'dotenv',
      'live_server_logs',
      'private_client_substrate',
      'unreleased_client_strategy',
    ]);
    assert.ok(C.PREDICATES.every((p) => typeof p.matches === 'string' && p.matches.length > 0));
    assert.ok(C.PREDICATES.every((p) => typeof p.fn === 'function'));
  });
});

// ---------------------------------------------------------------------------
// Per-predicate positive + negative.
// ---------------------------------------------------------------------------
describe('pii', () => {
  it('positive: email address trips', () => {
    assert.equal(C.piiPredicate(ctx('contact jane.doe@example.com please')).tripped, true);
  });
  it('positive: phone number trips', () => {
    assert.equal(C.piiPredicate(ctx('call me at (902) 555-1234')).tripped, true);
  });
  it('positive: international/E.164 +44 number trips (codex MAJOR)', () => {
    assert.equal(C.piiPredicate(ctx('reach the London office at +44 20 7946 0958')).tripped, true);
  });
  it('positive: compact E.164 +49 number trips', () => {
    assert.equal(C.piiPredicate(ctx('ring +4930123456 for the Berlin desk')).tripped, true);
  });
  it('positive: SIN/SSN-like trips', () => {
    assert.equal(C.piiPredicate(ctx('SIN on file: 123-456-789')).tripped, true);
  });
  it('positive: street address trips', () => {
    assert.equal(C.piiPredicate(ctx('ships to 123 Main Street')).tripped, true);
  });
  it('positive: date-of-birth label trips', () => {
    assert.equal(C.piiPredicate(ctx('date of birth recorded')).tripped, true);
  });
  it('negative: ordinary refactor note does not trip', () => {
    assert.equal(C.piiPredicate(ctx('rename the helper function in utils')).tripped, false);
  });
});

describe('credentials', () => {
  it('positive: api key token trips', () => {
    assert.equal(C.credentialsPredicate(ctx('here is the API key for the service')).tripped, true);
  });
  it('positive: bearer header trips', () => {
    assert.equal(C.credentialsPredicate(ctx('Authorization: Bearer abc123def456')).tripped, true);
  });
  it('positive: PEM private key trips', () => {
    assert.equal(C.credentialsPredicate(ctx('-----BEGIN RSA PRIVATE KEY-----\nMIIE...')).tripped, true);
  });
  it('positive: AWS access key id trips', () => {
    assert.equal(C.credentialsPredicate(ctx('AKIAIOSFODNN7EXAMPLE')).tripped, true);
  });
  it('positive: sk- secret key trips', () => {
    assert.equal(C.credentialsPredicate(ctx('use sk-abcdef0123456789abcdef')).tripped, true);
  });
  it('negative: plain prose does not trip', () => {
    assert.equal(C.credentialsPredicate(ctx('the meeting is at noon tomorrow')).tripped, false);
  });
  it('negative: the word "keyboard" does not false-trip on "key"', () => {
    assert.equal(C.credentialsPredicate(ctx('buy a new keyboard')).tripped, false);
  });
});

describe('dotenv', () => {
  it('positive: .env reference trips', () => {
    assert.equal(C.dotenvPredicate(ctx('copy the values from .env into the runner')).tripped, true);
  });
  it('positive: secret-shaped KEY=VALUE assignment trips', () => {
    assert.equal(C.dotenvPredicate(ctx('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG')).tripped, true);
  });
  it('positive: DB_PASSWORD assignment trips', () => {
    assert.equal(C.dotenvPredicate(ctx('DB_PASSWORD=hunter2')).tripped, true);
  });
  it('negative: non-secret env assignment does not trip', () => {
    assert.equal(C.dotenvPredicate(ctx('NODE_ENV=production')).tripped, false);
  });
  it('negative: ordinary text does not trip', () => {
    assert.equal(C.dotenvPredicate(ctx('the environment is calm today')).tripped, false);
  });
});

describe('live_server_logs', () => {
  it('positive: nginx access log line trips', () => {
    assert.equal(
      C.liveServerLogsPredicate(ctx('66.70.238.182 - - [29/Jun/2026:10:11:12 +0000] "GET /index.php HTTP/1.1" 200 1234')).tripped,
      true,
    );
  });
  it('positive: JS stack frame trips', () => {
    assert.equal(
      C.liveServerLogsPredicate(ctx('TypeError: x is undefined\n    at handler (/srv/app/index.js:42:13)')).tripped,
      true,
    );
  });
  it('positive: python traceback frame trips', () => {
    assert.equal(
      C.liveServerLogsPredicate(ctx('File "/srv/app.py", line 42, in handler')).tripped,
      true,
    );
  });
  it('positive: log-file path trips', () => {
    assert.equal(C.liveServerLogsPredicate(ctx('tail -f /var/log/nginx/error.log')).tripped, true);
  });
  it('positive: "stack trace" token trips', () => {
    assert.equal(C.liveServerLogsPredicate(ctx('paste the full stack trace here')).tripped, true);
  });
  it('negative: ordinary code comment does not trip', () => {
    assert.equal(C.liveServerLogsPredicate(ctx('this function returns the sum of two ints')).tripped, false);
  });
  it('negative: bare prose path citation does NOT trip (codex MINOR — narrowed)', () => {
    // No error/exception/traceback context around the "at <path>:line:col" cite.
    assert.equal(C.liveServerLogsPredicate(ctx('review the change at foo/bar.js:10:5 before merging')).tripped, false);
  });
});

describe('private_client_substrate', () => {
  it('positive: clients/** path reference trips', () => {
    assert.equal(C.privateClientSubstratePredicate(ctx('see clients/{CLIENT_CODE}/superdaves/project.json')).tripped, true);
  });
  it('positive: CRM lead-record token trips', () => {
    assert.equal(C.privateClientSubstratePredicate(ctx('export the lead records from the crm')).tripped, true);
  });
  it('positive: crmstagings token trips', () => {
    assert.equal(C.privateClientSubstratePredicate(ctx('rows stuck in crmstagings')).tripped, true);
  });
  it('negative: framework path does not trip', () => {
    assert.equal(C.privateClientSubstratePredicate(ctx('see frameworks/paid-media/manifest.json')).tripped, false);
  });
  it('negative: generic mention of a client does not trip', () => {
    assert.equal(C.privateClientSubstratePredicate(ctx('the client liked the design')).tripped, false);
  });
});

describe('unreleased_client_strategy', () => {
  it('positive: confidential + pricing trips', () => {
    assert.equal(
      C.unreleasedClientStrategyPredicate(ctx('CONFIDENTIAL: new pricing for Q3 rollout')).tripped,
      true,
    );
  });
  it('positive: draft + campaign strategy trips', () => {
    assert.equal(
      C.unreleasedClientStrategyPredicate(ctx('draft campaign strategy, not for distribution')).tripped,
      true,
    );
  });
  // DISJUNCTION (codex S2 review, BLOCKER): these two formerly asserted the
  // conjunction (marker-or-subject-alone == SAFE). Flipped: EITHER signal alone
  // is now SENSITIVE — over-block is the safe direction so unmarked commercial
  // data cannot egress.
  it('FLIPPED positive: confidentiality marker ALONE now trips', () => {
    assert.equal(C.unreleasedClientStrategyPredicate(ctx('this note is confidential')).tripped, true);
  });
  it('FLIPPED positive: strategy subject ALONE (unmarked pricing) now trips', () => {
    assert.equal(C.unreleasedClientStrategyPredicate(ctx('here is the updated pricing for next quarter')).tripped, true);
  });
  it('FLIPPED positive: unmarked margin/rollout data now trips', () => {
    assert.equal(C.unreleasedClientStrategyPredicate(ctx('Q3 rollout with improved margins')).tripped, true);
  });
  it('negative: neither a marker nor a strategy subject => still safe', () => {
    assert.equal(C.unreleasedClientStrategyPredicate(ctx('the team meeting is at noon on Monday')).tripped, false);
  });
});

// ---------------------------------------------------------------------------
// Public entrypoint: fail-closed + integration cases.
// ---------------------------------------------------------------------------
describe('classifyPayloadSensitivity — fail-closed', () => {
  it('null payload => unknown + sensitive', () => {
    const r = C.classifyPayloadSensitivity(null);
    assert.equal(r.sensitive, true);
    assert.equal(r.unknown, true);
    assert.equal(r.tripped[0].predicate, C.UNKNOWN_PREDICATE);
  });
  it('undefined payload => unknown + sensitive', () => {
    const r = C.classifyPayloadSensitivity(undefined);
    assert.equal(r.sensitive, true);
    assert.equal(r.unknown, true);
  });
  it('empty string => unknown + sensitive (garbled)', () => {
    const r = C.classifyPayloadSensitivity('   ');
    assert.equal(r.sensitive, true);
    assert.equal(r.unknown, true);
  });
  it('empty object => unknown + sensitive (no classifiable text)', () => {
    const r = C.classifyPayloadSensitivity({});
    assert.equal(r.sensitive, true);
    assert.equal(r.unknown, true);
  });
  it('non-string/object scalar (number) => unknown + sensitive', () => {
    const r = C.classifyPayloadSensitivity(42);
    assert.equal(r.sensitive, true);
    assert.equal(r.unknown, true);
  });
  it('a predicate that throws => unknown + sensitive (fail-closed-on-throw proof)', () => {
    // Monkeypatch one predicate fn to throw, prove the entrypoint fails closed.
    const target = C.PREDICATES.find((p) => p.name === 'pii');
    const orig = target.fn;
    target.fn = () => { throw new Error('boom'); };
    try {
      const r = C.classifyPayloadSensitivity('totally benign system code comment');
      assert.equal(r.sensitive, true);
      assert.equal(r.unknown, true);
      assert.ok(r.tripped.some((t) => t.predicate === C.UNKNOWN_PREDICATE && /pii.*threw/.test(t.evidence)));
    } finally {
      target.fn = orig;
    }
  });
});

describe('classifyPayloadSensitivity — classification', () => {
  it('plainly-public/system-code payload => NOT sensitive', () => {
    const r = C.classifyPayloadSensitivity(
      'Refactor the loop in tools/util/sum.js to use reduce; it adds two integers and returns the total.',
    );
    assert.equal(r.sensitive, false);
    assert.equal(r.unknown, false);
    assert.deepEqual(r.tripped, []);
  });

  it('string payload with PII => sensitive', () => {
    const r = C.classifyPayloadSensitivity('email the lead at user@example.com');
    assert.equal(r.sensitive, true);
    assert.equal(r.unknown, false);
    assert.ok(r.tripped.some((t) => t.predicate === 'pii'));
  });

  it('object payload with a nested credential => sensitive', () => {
    const payload = {
      task: 'summarize this config',
      context: {
        meta: { region: 'us' },
        config: { service: 'meta-ads', authorization: 'Bearer ya29.A0ARrdaM-secrettoken' },
      },
    };
    const r = C.classifyPayloadSensitivity(payload);
    assert.equal(r.sensitive, true);
    assert.equal(r.unknown, false);
    assert.ok(r.tripped.some((t) => t.predicate === 'credentials'));
  });

  it('object payload with an api_key KEY name => sensitive', () => {
    const r = C.classifyPayloadSensitivity({ settings: { api_key: 'abc123' } });
    assert.equal(r.sensitive, true);
    assert.ok(r.tripped.some((t) => t.predicate === 'credentials' || t.predicate === 'dotenv'));
  });

  it('clients/** path reference => sensitive', () => {
    const r = C.classifyPayloadSensitivity('please read clients/{CLIENT_CODE}/eastcoast/project.json and summarize');
    assert.equal(r.sensitive, true);
    assert.equal(r.unknown, false);
    assert.ok(r.tripped.some((t) => t.predicate === 'private_client_substrate'));
  });

  it('multiple predicates can trip on one payload', () => {
    const r = C.classifyPayloadSensitivity(
      'CONFIDENTIAL pricing in clients/{CLIENT_CODE}/project.json; api key sk-abcdef0123456789abcdef; reach user@example.com',
    );
    assert.equal(r.sensitive, true);
    const names = r.tripped.map((t) => t.predicate);
    assert.ok(names.includes('pii'));
    assert.ok(names.includes('credentials'));
    assert.ok(names.includes('private_client_substrate'));
    assert.ok(names.includes('unreleased_client_strategy'));
  });

  it('cyclic object does not throw — still classifies', () => {
    const a = { note: 'benign' };
    a.self = a;
    const r = C.classifyPayloadSensitivity(a);
    assert.equal(r.unknown, false);
    assert.equal(r.sensitive, false);
  });
});
