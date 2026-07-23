'use strict';

// smos-hooks-self-test — sovereign-core-harness P1 acceptance (b) + (c).
//
// (b) Asserts the fork's NATIVE hook surface is wired: mythos-hooks.ts registers
//     the lifecycle events and the self-test command, and bridges to the kernel
//     managed runtime (no external AI-agent dependency for its core function).
// (c) Mechanically enforces the proxy-honesty tripwire: every proxy-tier
//     extension carries the explicit "PROXY — retains Anthropic dependency"
//     label and makes NO native MCP/subagent capability claim.
//
// This is the static/structural self-test. The LIVE self-test is the pi command
// `smos-hooks-self-test` run against the built sovereign build (see
// _dev/reports/analysis/sovereign-core-harness-p1/hooks-self-test-live.txt).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const EXTENSIONS_DIR = path.join(REPO_ROOT, '.pi', 'extensions');
const MANIFEST = path.join(REPO_ROOT, 'packages', 'sam-cli', 'extensions.manifest.json');

function readExtension(name) {
  return fs.readFileSync(path.join(EXTENSIONS_DIR, name), 'utf8');
}

const PROXY_LABEL = 'PROXY — retains Anthropic dependency';

// Native-capability claims a proxy shim must never make about itself.
const AFFIRMATIVE_NATIVE_CLAIMS = [
  /\b(?:provides?|implements?|supports?|offers?|has|is|gives?)\s+(?:a\s+)?native\s+MCP\b/i,
  /\b(?:provides?|implements?|supports?|offers?|has|is|gives?)\s+(?:a\s+)?native\s+sub-?agent/i,
  /\b(?:provides?|implements?|supports?|offers?|has|is|gives?)\s+(?:a\s+)?native\s+(?:dispatch|coordinator)\b/i,
  /COORDINATOR mode ready/i,
];

describe('smos-hooks native surface (P1 acceptance b)', () => {
  const source = readExtension('mythos-hooks.ts');

  it('registers the four pi lifecycle events', () => {
    for (const evt of ['session_start', 'tool_call', 'user_bash', 'session_shutdown']) {
      assert.match(source, new RegExp(`pi\\.on\\(\\s*["']${evt}["']`), `missing lifecycle bind: ${evt}`);
    }
  });

  it('registers the smos-hooks-self-test command', () => {
    assert.match(source, /pi\.registerCommand\(\s*["']smos-hooks-self-test["']/);
  });

  it('probes credential verification directly instead of the fleet-aware boot path', () => {
    const selfTestBody = source.match(/function selfTest\(\)[\s\S]*?return \{ ok: allOk, report: lines\.join\("\\n"\) \};\n\}/)?.[0] || '';
    assert.match(selfTestBody, /bridgeCredentialVerify\(\)/);
    assert.doesNotMatch(selfTestBody, /bridgeBoot\(\)/);
  });

  it('bridges to the kernel managed runtime (thin bridge, not a duplicated policy engine)', () => {
    assert.match(source, /codex:hook/, 'expected bridge to the kernel hook-emulation runtime');
    assert.match(source, /codex:boot/, 'expected bridge to the credential verifier');
  });

  it('the referenced managed-runtime bridge target exists on disk', () => {
    assert.ok(
      fs.existsSync(path.join(REPO_ROOT, 'tools', 'codex', 'lib', 'hook-emulation.js')),
      'kernel hook-emulation runtime missing — native bridge would be dead'
    );
  });
});

describe('extension manifest tiering (P1 step 3)', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

  it('every manifest extension file exists', () => {
    for (const ext of manifest.extensions) {
      assert.ok(fs.existsSync(path.join(EXTENSIONS_DIR, ext.file)), `missing: ${ext.file}`);
    }
  });

  it('records the pinned upstream commit', () => {
    assert.equal(manifest.fork.pinned_commit, 'a23abe4a695df8b69b613f73e9fdda2a8af894d4');
    assert.equal(manifest.fork.pinned_tag, 'v0.80.3');
  });

  it('native entries claim native; proxy entries do not', () => {
    for (const ext of manifest.extensions) {
      if (ext.tier === 'native') assert.equal(ext.native_claim, true, `${ext.file} native tier must claim native`);
      if (ext.tier === 'proxy') assert.equal(ext.native_claim, false, `${ext.file} proxy tier must not claim native`);
    }
  });
});

describe('proxy-honesty tripwire (P1 acceptance c)', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const proxies = manifest.extensions.filter((e) => e.tier === 'proxy');

  it('there are proxy extensions to check', () => {
    assert.ok(proxies.length >= 3, 'expected at least the 3 known proxy shims');
  });

  it('rejects affirmative native claims without rejecting explicit disclaimers', () => {
    const positive = 'This extension provides native MCP capability.';
    const negative = 'This extension is not native MCP capability and has no native MCP client.';
    assert.ok(AFFIRMATIVE_NATIVE_CLAIMS.some((pattern) => pattern.test(positive)));
    assert.ok(AFFIRMATIVE_NATIVE_CLAIMS.every((pattern) => !pattern.test(negative)));
  });

  for (const proxy of manifest ? manifest.extensions.filter((e) => e.tier === 'proxy') : []) {
    it(`${proxy.file} carries the explicit proxy label`, () => {
      assert.ok(readExtension(proxy.file).includes(PROXY_LABEL), `${proxy.file} missing "${PROXY_LABEL}"`);
    });

    it(`${proxy.file} makes no native-capability claim`, () => {
      const src = readExtension(proxy.file);
      for (const pattern of AFFIRMATIVE_NATIVE_CLAIMS) {
        assert.doesNotMatch(src, pattern, `${proxy.file} contains a forbidden native claim: ${pattern}`);
      }
    });
  }
});
