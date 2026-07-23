'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');

const CLI = path.resolve(__dirname, '../verify-report-claims.cjs');
function run(root, manifest) {
  const manifestPath = path.join(root, 'claims.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  return spawnSync(process.execPath, [CLI, '--claim-manifest=' + manifestPath, root], { encoding: 'utf8' });
}

test('bounded citation produces structural pass but never semantic acceptance', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smos-claims-'));
  fs.writeFileSync(path.join(root, 'report.md'), '# Report');
  fs.writeFileSync(path.join(root, 'evidence.md'), 'line one\nline two\n');
  const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'evidence.md'))).digest('hex');
  const result = run(root, { schema: 'ReportClaimManifest/1.0', report_path: 'report.md', claims: [{ id: 'c1', type: 'citation_exists', path: 'evidence.md', expected_sha256: digest, line: 2 }] });
  assert.equal(result.status, 0, result.stderr);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.state, 'structural_pass');
  assert.equal(verdict.semantic_status, 'requires_model_review');
  assert.equal(verdict.can_rewrite_report, false);
});

test('stale citation, unbounded glob, traversal, and symlink escape fail', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smos-claims-bad-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'smos-claims-outside-'));
  fs.writeFileSync(path.join(root, 'report.md'), '# Report'); fs.writeFileSync(path.join(root, 'evidence.md'), 'now');
  fs.writeFileSync(path.join(outside, 'secret'), 'secret'); fs.symlinkSync(path.join(outside, 'secret'), path.join(root, 'escape'));
  const stale = run(root, { schema: 'ReportClaimManifest/1.0', report_path: 'report.md', claims: [{ id: 'c', type: 'citation_exists', path: 'evidence.md', expected_sha256: '0'.repeat(64) }] });
  assert.equal(JSON.parse(stale.stdout).state, 'stale');
  const glob = run(root, { schema: 'ReportClaimManifest/1.0', report_path: 'report.md', claims: [{ id: 'c', type: 'file_count', path: '.', filename: '*.md', expected_count: 1 }] });
  assert.equal(JSON.parse(glob.stdout).state, 'unsupported_query');
  for (const badPath of ['../escape', 'escape']) {
    const escaped = run(root, { schema: 'ReportClaimManifest/1.0', report_path: 'report.md', claims: [{ id: 'c', type: 'citation_exists', path: badPath, expected_sha256: '0'.repeat(64) }] });
    assert.equal(JSON.parse(escaped.stdout).state, 'out_of_bounds');
  }
});

test('legacy CLI route remains available', () => {
  const result = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: node verify-report-claims/);
});
