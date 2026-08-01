'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { validateClassifyReportSemantics } = require('../lib.js');
const {
  classifyFile: classifyFileImpl,
  classifyFileDetailed: classifyFileDetailedImpl,
  inspectStructuredContactDataset: inspectStructuredContactDatasetImpl,
  isStructuredContactDataset: isStructuredContactDatasetImpl,
  selectReusablePiiMap,
  buildClassificationArtifacts: buildClassificationArtifactsImpl,
  buildReportListing: buildReportListingImpl,
  applyClassificationDecisions
} = require('../classify.js');

const CLEAN = () => false;
const DIRTY = () => true;
const CLASSIFY_SCRIPT = path.resolve(__dirname, '..', 'classify.js');
const EMPTY_POLICY = {
  protectedPaths: [],
  piiMatchers: [],
  structuredContentProfiles: new Set(),
  privateSourceSnapshotEnabled: false
};
const RECORDS_POLICY = {
  protectedPaths: ['projects/ads-approval-portal/**'],
  piiMatchers: [
    '**/*.json', '**/raw/**', '**/raw-redacted/**', '**/leads/**', '**/lead-data/**',
    '**/customers/**', '**/customer-data/**', '**/forms/**', '**/wpforms-entries/**',
    '**/wpforms-entries-apply/**', '**/wpforms-entries-www/**', '**/crm-sync-payloads/**',
    '**/crm-staging-export/**', '**/exports/**',
    /(?:^|\/)[^/]*(?:\d[^/]*){13}(?:\.[^/]*)?$/
  ],
  structuredContentProfiles: new Set(['crm-contact-export-v1']),
  privateSourceSnapshotEnabled: false
};
const INTAKE_POLICY = {
  protectedPaths: [],
  piiMatchers: ['student-exams/**', 'intake/**'],
  structuredContentProfiles: new Set(),
  privateSourceSnapshotEnabled: true
};

function policyFor(client) {
  if (client === 'CLIENT_ALPHA') return RECORDS_POLICY;
  if (client === 'CLIENT_BETA') return INTAKE_POLICY;
  return EMPTY_POLICY;
}

function classifyFile(relPath, absPath, client, markerDirs, dirty) {
  return classifyFileImpl(relPath, absPath, client, markerDirs, dirty, policyFor(client));
}

function classifyFileDetailed(relPath, absPath, client, markerDirs, dirty) {
  return classifyFileDetailedImpl(relPath, absPath, client, markerDirs, dirty, policyFor(client));
}

function inspectStructuredContactDataset(absPath, client) {
  return inspectStructuredContactDatasetImpl(absPath, client, policyFor(client));
}

function isStructuredContactDataset(absPath, client) {
  return isStructuredContactDatasetImpl(absPath, client, policyFor(client));
}

function buildClassificationArtifacts(classified, client, options = {}) {
  return buildClassificationArtifactsImpl(classified, client, {
    ...options,
    classificationPolicy: policyFor(client)
  });
}

function buildReportListing(classified, client = 'CLIENT_PLAIN') {
  return buildReportListingImpl(classified, client, policyFor(client));
}

function recordsPolicyJson() {
  return {
    client_storage_policy: {
      classification: {
        protected_paths: ['projects/ads-approval-portal/**'],
        pii_globs: RECORDS_POLICY.piiMatchers.filter((matcher) => typeof matcher === 'string'),
        pii_filename_profiles: ['long-numeric-record-id-v1'],
        structured_content_profiles: ['crm-contact-export-v1']
      },
      private_source_snapshot: { enabled: false }
    }
  };
}

test('operator decisions resolve only explicit REVIEW entries', () => {
  const classified = [
    { relPath: 'mockup.html', klass: 'REVIEW', semantic_bucket: 'REVIEW', basis: 'ambiguous', size: 1 },
    { relPath: 'source.html', klass: 'REVIEW', semantic_bucket: 'REVIEW', basis: 'ambiguous', size: 2 },
    { relPath: 'dirty.html', klass: 'DEFERRED-DIRTY', semantic_bucket: 'REVIEW', basis: 'dirty', size: 3 }
  ];
  applyClassificationDecisions(classified, {
    decisions: new Map([
      ['mockup.html', { klass: 'MOVE', semantic_bucket: 'HISTORICAL-REFERENCE', basis: 'operator-approved mockup' }],
      ['source.html', { klass: 'KEEP', semantic_bucket: 'REUSABLE-SOURCE', basis: 'operator-approved source' }]
    ])
  });
  assert.equal(classified[0].klass, 'MOVE');
  assert.equal(classified[1].klass, 'KEEP');
  assert.equal(classified[2].klass, 'DEFERRED-DIRTY');
});

test('operator decisions fail closed for missing or non-REVIEW targets', () => {
  assert.throws(
    () => applyClassificationDecisions(
      [{ relPath: 'core.json', klass: 'KEEP', semantic_bucket: 'CORE-METADATA', size: 1 }],
      { decisions: new Map([['core.json', { klass: 'MOVE', semantic_bucket: 'HISTORICAL-REFERENCE', basis: 'invalid' }]]) }
    ),
    /may resolve only REVIEW/
  );
  assert.throws(
    () => applyClassificationDecisions([], {
      decisions: new Map([['missing.html', { klass: 'MOVE', semantic_bucket: 'HISTORICAL-REFERENCE', basis: 'stale' }]])
    }),
    /target is missing/
  );
});

function classify(relPath, { client = 'CLIENT_ALPHA', markerDirs = new Set(), dirty = CLEAN } = {}) {
  return classifyFile(relPath, path.join('/tmp/fake-client', relPath), client, markerDirs, dirty);
}

test('CLIENT_ALPHA PII surfaces redact movable workflow and dataset identities', async (t) => {
  await t.test('movable JSON records are PII-MOVE', () => {
    assert.equal(classify(path.join('workflows', 'dataset-record.json')), 'PII-MOVE');
  });

  await t.test('raw lead/customer/form/CRM/export contexts are PII-MOVE', () => {
    for (const relPath of [
      path.join('datasets', 'raw', 'record.csv'),
      path.join('datasets', 'leads', 'record.csv'),
      path.join('datasets', 'customers', 'record.csv'),
      path.join('datasets', 'wpforms-entries', 'record.csv'),
      path.join('datasets', 'crm-sync-payloads', 'record.jsonl'),
      path.join('datasets', 'exports', 'record.xlsx')
    ]) {
      assert.equal(classify(relPath), 'PII-MOVE');
    }
  });

  await t.test('long numeric record basenames are PII-MOVE without storing a real identifier', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-storage-numeric-record-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const longRel = path.join('datasets', 'record-1234567890123.csv');
    const shortRel = path.join('datasets', 'record-123456789012.csv');
    const longAbs = path.join(root, longRel);
    const shortAbs = path.join(root, shortRel);
    fs.mkdirSync(path.dirname(longAbs), { recursive: true });
    fs.writeFileSync(longAbs, 'metric,total\nsynthetic,1\n');
    fs.writeFileSync(shortAbs, 'metric,total\nsynthetic,1\n');
    assert.equal(classifyFile(longRel, longAbs, 'CLIENT_ALPHA', new Set(), CLEAN), 'PII-MOVE');
    assert.equal(classifyFile(shortRel, shortAbs, 'CLIENT_ALPHA', new Set(), CLEAN), 'MOVE');
  });

  await t.test('structural contact exports are PII-MOVE even outside named PII directories', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-storage-contacts-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const fixtures = [
      {
        name: 'contact.csv',
        content: 'email,phone,display\nsynthetic@example.com,555-0100,Fixture\n'
      },
      {
        name: 'vendor.csv',
        content: [
          'vendor_address1_city,vendor_firstname,vendor_lastname,vendor_geo_city,vendor_ip_address',
          'Example City,Example,Person,Example City,192.0.2.1'
        ].join('\n')
      },
      {
        name: 'contact.jsonl',
        content: JSON.stringify({
          record: {
            city: 'Example City',
            email: 'synthetic@example.com',
            first_name: 'Example',
            last_name: 'Person',
            phone: '555-0100',
            postal: 'A0A 0A0',
            street: 'Example Street'
          }
        })
      }
    ];
    for (const fixture of fixtures) {
      const absPath = path.join(root, fixture.name);
      fs.writeFileSync(absPath, fixture.content);
      assert.equal(isStructuredContactDataset(absPath, 'CLIENT_ALPHA'), true);
      assert.equal(classifyFile(path.join('misc', fixture.name), absPath, 'CLIENT_ALPHA', new Set(), CLEAN), 'PII-MOVE');
    }
    const contactPath = path.join(root, 'contact.csv');
    const artifacts = await buildClassificationArtifacts(
      [
        {
          klass: 'PII-MOVE',
          relPath: path.join('misc', 'contact.csv'),
          absPath: contactPath,
          size: fs.statSync(contactPath).size
        },
        {
          klass: 'KEEP',
          relPath: path.join('archive', 'misc', 'contact.csv-derived-summary.md'),
          absPath: '/does/not/exist',
          size: 1
        }
      ],
      'CLIENT_ALPHA'
    );
    assert.equal(artifacts.listing[1].identity_redacted, true);
    assert.equal(JSON.stringify(artifacts.listing).includes('contact.csv'), false);
  });

  await t.test('telemetry and summary tables are not promoted to PII by weak field overlap', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-storage-noncontacts-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const fixtures = [
      {
        name: 'summary.csv',
        content: 'email,total\nexample.invalid,2\n'
      },
      {
        name: 'telemetry.jsonl',
        content: JSON.stringify({
          city: 'Example City',
          hostname: 'example.invalid',
          pathname: '/form',
          region_name: 'Example',
          zip_code: 'A0A 0A0'
        })
      }
    ];
    for (const fixture of fixtures) {
      const absPath = path.join(root, fixture.name);
      fs.writeFileSync(absPath, fixture.content);
      assert.equal(isStructuredContactDataset(absPath, 'CLIENT_ALPHA'), false);
      assert.equal(classifyFile(path.join('misc', fixture.name), absPath, 'CLIENT_ALPHA', new Set(), CLEAN), 'MOVE');
    }
  });

  await t.test('other clients do not inherit CLIENT_ALPHA structural contact rules', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-storage-other-contact-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const absPath = path.join(root, 'contact.csv');
    fs.writeFileSync(absPath, 'email,phone\nsynthetic@example.com,555-0100\n');
    assert.equal(isStructuredContactDataset(absPath, 'CLIENT_PLAIN'), false);
    assert.equal(classifyFile('contact.csv', absPath, 'CLIENT_PLAIN', new Set(), CLEAN), 'MOVE');
  });

  await t.test('unreadable or truncated structural inputs halt instead of falling through to MOVE', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-storage-indeterminate-contact-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const missingPath = path.join(root, 'missing-contact.csv');
    assert.equal(inspectStructuredContactDataset(missingPath, 'CLIENT_ALPHA').status, 'indeterminate');
    assert.throws(
      () => classifyFile('misc/contact.csv', missingPath, 'CLIENT_ALPHA', new Set(), CLEAN),
      /classification halted/
    );

    const oversizedPath = path.join(root, 'oversized.jsonl');
    fs.writeFileSync(
      oversizedPath,
      JSON.stringify({
        padding: 'x'.repeat(2 * 1024 * 1024),
        city: 'Example City',
        email: 'synthetic@example.com',
        first_name: 'Example',
        last_name: 'Person',
        phone: '555-0100',
        postal: 'A0A 0A0',
        street: 'Example Street'
      })
    );
    assert.equal(inspectStructuredContactDataset(oversizedPath, 'CLIENT_ALPHA').status, 'indeterminate');
    assert.throws(
      () => classifyFile('misc/oversized.jsonl', oversizedPath, 'CLIENT_ALPHA', new Set(), CLEAN),
      /classification halted/
    );
  });

  await t.test('configured PII takes precedence over package-tree JSON', () => {
    assert.equal(classify(path.join('runtime', 'package-lock.json'), { markerDirs: new Set(['runtime']) }), 'PII-MOVE');
  });

  await t.test('dirty PII candidates remain deferred', () => {
    assert.equal(classify(path.join('datasets', 'raw', 'record.csv'), { dirty: DIRTY }), 'DEFERRED-DIRTY');
  });

  await t.test('configured PII takes precedence over protected paths', () => {
    assert.equal(classify(path.join('projects', 'ads-approval-portal', 'exports', 'record.json')), 'PII-MOVE');
  });

  await t.test('PII report entries contain no path identity', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-storage-classify-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const filePath = path.join(root, 'fixture.bin');
    fs.writeFileSync(filePath, 'synthetic private record');
    const [entry] = await buildReportListing([
      { klass: 'PII-MOVE', relPath: path.join('datasets', 'raw', 'record.csv'), absPath: filePath, size: 24 }
    ]);
    assert.deepEqual(Object.keys(entry).sort(), ['basis', 'klass', 'pii_id', 'semantic_bucket', 'sha256_prefix', 'size']);
    assert.equal(entry.semantic_bucket, 'HISTORICAL-REFERENCE');
    assert.equal(entry.sha256_prefix.length, 8);
  });

  await t.test('identical PII content receives unique opaque path identities', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-storage-classify-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const firstPath = path.join(root, 'first.bin');
    const secondPath = path.join(root, 'second.bin');
    fs.writeFileSync(firstPath, 'identical synthetic content');
    fs.writeFileSync(secondPath, 'identical synthetic content');
    const original = await buildClassificationArtifacts(
      [
        { klass: 'PII-MOVE', relPath: path.join('private', 'first.bin'), absPath: firstPath, size: 27 },
        { klass: 'PII-MOVE', relPath: path.join('private', 'second.bin'), absPath: secondPath, size: 27 }
      ],
      'TEST'
    );
    assert.equal(original.listing[0].sha256_prefix, original.listing[1].sha256_prefix);
    assert.notEqual(original.listing[0].pii_id, original.listing[1].pii_id);
    assert.equal('relpath' in original.listing[0], false);
    assert.equal('repo_relpath' in original.listing[0], false);

    fs.writeFileSync(secondPath, 'updated synthetic private content');
    const thirdPath = path.join(root, 'third.bin');
    fs.writeFileSync(thirdPath, 'brand new synthetic private content');
    const updated = await buildClassificationArtifacts(
      [
        { klass: 'PII-MOVE', relPath: path.join('private', 'first.bin'), absPath: firstPath, size: 27 },
        { klass: 'PII-MOVE', relPath: path.join('private', 'second.bin'), absPath: secondPath, size: 33 },
        { klass: 'PII-MOVE', relPath: path.join('private', 'third.bin'), absPath: thirdPath, size: 35 }
      ],
      'TEST',
      { priorMap: original.piiPathMap }
    );
    assert.equal(updated.listing[0].pii_id, original.listing[0].pii_id);
    assert.equal(updated.listing[1].pii_id, original.listing[1].pii_id);
    assert.notEqual(updated.listing[1].sha256_prefix, original.listing[1].sha256_prefix);
    assert.equal(original.listing.some((entry) => entry.pii_id === updated.listing[2].pii_id), false);
    assert.equal(updated.reusedIdentityCount, 2);
    assert.equal(updated.newIdentityCount, 1);
  });

  await t.test('invalid prior identity map regenerates only before any PII migration', () => {
    const invalid = { schema: 'ClientStoragePiiPathMap/0.9', client: 'TEST', entries: [] };
    assert.deepEqual(selectReusablePiiMap(invalid, null, 'TEST'), {
      map: null,
      disposition: 'regenerated_invalid_unmigrated'
    });
    assert.throws(
      () =>
        selectReusablePiiMap(
          invalid,
          { entries: [{ pii_id: '11111111-1111-4111-8111-111111111111' }] },
          'TEST'
        ),
      /refusing to regenerate/
    );
    assert.throws(
      () =>
        selectReusablePiiMap(
          null,
          { entries: [{ pii_id: '11111111-1111-4111-8111-111111111111' }] },
          'TEST'
        ),
      /prior PII path map is missing/
    );
  });

  await t.test('deferred and non-migratable sensitive entries redact paths without content reads', async () => {
    const artifacts = await buildClassificationArtifacts(
      [
        { klass: 'DEFERRED-DIRTY', relPath: path.join('local', 'ignored.bin'), absPath: '/does/not/exist', size: 10 },
        { klass: 'KEEP', relPath: path.join('datasets', 'raw', 'kept.json'), absPath: '/does/not/exist', size: 11 },
        { klass: 'SKIP-STUB', relPath: path.join('datasets', 'raw', 'pointer.gdoc'), absPath: '/does/not/exist', size: 12 },
        { klass: 'KEEP', relPath: 'README.md', absPath: '/does/not/exist', size: 13 },
        { klass: 'MOVE', relPath: 'reference.txt', absPath: '/does/not/exist', size: 14 }
      ],
      'CLIENT_ALPHA'
    );
    for (const entry of artifacts.listing.slice(0, 3)) {
      assert.equal('relpath' in entry, false);
      assert.equal(entry.identity_redacted, true);
      assert.match(entry.report_id, /^[0-9a-f-]{36}$/);
    }
    assert.equal(artifacts.listing[3].relpath, 'README.md');
    assert.equal(artifacts.listing[4].relpath, 'reference.txt');
    assert.equal(artifacts.listing[3].semantic_bucket, 'REUSABLE-SOURCE');
    assert.match(artifacts.listing[3].basis, /legacy caller/);
    assert.equal(artifacts.listing[4].semantic_bucket, 'HISTORICAL-REFERENCE');
    assert.match(artifacts.listing[4].basis, /legacy caller/);
    assert.equal(artifacts.piiPathMap.entries.length, 0);
  });

  await t.test('redaction closure covers direct, sibling, and nested derivatives without changing classes', async () => {
    const classified = [
      { klass: 'KEEP', relPath: path.join('datasets', 'raw', 'id.json'), absPath: '/does/not/exist', size: 1 },
      { klass: 'KEEP', relPath: path.join('archive', 'datasets', 'raw', 'id.json-derivative-identity.md-copy.md'), absPath: '/does/not/exist', size: 2 },
      { klass: 'KEEP', relPath: path.join('datasets', 'raw', 'id.json-derivative-identity.md'), absPath: '/does/not/exist', size: 3 },
      { klass: 'KEEP', relPath: path.join('datasets', 'raw', 'customer-1d5c78c7-83b2-4c52-a613-ef16e2a12345.html'), absPath: '/does/not/exist', size: 4 },
      { klass: 'KEEP', relPath: path.join('plans', 'customer-1d5c78c7-83b2-4c52-a613-ef16e2a12345-summary.md'), absPath: '/does/not/exist', size: 5 },
      { klass: 'KEEP', relPath: path.join('plans', 'unrelated-guidance.md'), absPath: '/does/not/exist', size: 6 }
    ];
    const artifacts = await buildClassificationArtifacts(classified, 'CLIENT_ALPHA');
    assert.equal(artifacts.listing.filter((entry) => entry.identity_redacted).length, 5);
    assert.equal(artifacts.listing.every((entry) => entry.klass === 'KEEP'), true);
    assert.equal(artifacts.listing[5].relpath, path.join('plans', 'unrelated-guidance.md'));
    const serialized = JSON.stringify(artifacts.listing);
    for (const sensitiveIdentity of ['id.json', '1d5c78c7-83b2-4c52-a613-ef16e2a12345']) {
      assert.equal(serialized.includes(sensitiveIdentity), false);
    }
    assert.equal(artifacts.piiPathMap.entries.length, 0);
  });
});

test('artifact outputs override blanket package-tree retention without moving runtime assets', async (t) => {
  const markerDirs = new Set(['runtime']);

  await t.test('image output in screenshot context moves', () => {
    assert.equal(
      classify(path.join('runtime', 'output-screenshots', 'render.png'), { markerDirs }),
      'MOVE'
    );
  });

  await t.test('runtime image asset remains KEEP', () => {
    assert.equal(classify(path.join('runtime', 'assets', 'logo.png'), { markerDirs }), 'KEEP');
  });

  await t.test('dirty artifact output remains deferred', () => {
    assert.equal(
      classify(path.join('runtime', 'output-screenshots', 'render.png'), { markerDirs, dirty: DIRTY }),
      'DEFERRED-DIRTY'
    );
  });

  await t.test('stub skip remains intact', () => {
    assert.equal(classify(path.join('reference', 'pointer.gdoc')), 'SKIP-STUB');
  });
});

test('source extensions and artifact-context exceptions are principled', async (t) => {
  await t.test('workspace placeholders and active root handoffs stay local', () => {
    for (const relPath of [
      '.gitignore',
      path.join('projects', '.gitkeep'),
      'NEXT_SESSION.md',
      'next-session-handoff.md',
      'whats-next.md'
    ]) {
      assert.equal(classify(relPath), 'KEEP');
    }
  });

  await t.test('CSS outside artifact contexts is source and stays KEEP', () => {
    assert.equal(classify(path.join('theme', 'styles.css')), 'KEEP');
  });

  await t.test('rendered CSS in an output context moves', () => {
    assert.equal(classify(path.join('build', 'outputs', 'render.css')), 'MOVE');
  });

  await t.test('standalone HTML fails closed for review', () => {
    assert.equal(classify(path.join('prototype', 'index.html')), 'REVIEW');
  });

  await t.test('captured HTML output moves', () => {
    assert.equal(classify(path.join('captures', 'render.html')), 'MOVE');
  });

  await t.test('content-source and backup HTML externalize as historical reference', () => {
    for (const relPath of [
      path.join('content-source', 'landing.html'),
      path.join('legacy', 'post-content-backup.html'),
      path.join('archive', 'page.snapshot.htm')
    ]) {
      const result = classifyFileDetailed(relPath, path.join('/tmp/fake-client', relPath), 'CLIENT_PLAIN', new Set(), CLEAN);
      assert.equal(result.klass, 'MOVE');
      assert.equal(result.semantic_bucket, 'HISTORICAL-REFERENCE');
      assert.match(result.basis, /HTML/);
    }
  });

  await t.test('compound backup parent segments externalize LMF-shaped HTML', () => {
    for (const relPath of [
      path.join('post-content-backup', '16017.html'),
      path.join('archives', 'site-backup', 'page.html'),
      path.join('legacy', 'content_source', 'page.htm')
    ]) {
      const result = classifyFileDetailed(relPath, path.join('/tmp/fake-client', relPath), 'CLIENT_GAMMA', new Set(), CLEAN);
      assert.equal(result.klass, 'MOVE');
      assert.equal(result.semantic_bucket, 'HISTORICAL-REFERENCE');
    }
  });

  await t.test('template, preset, package, and src HTML stay as reusable source', () => {
    for (const [relPath, markerDirs] of [
      [path.join('templates', 'landing.html'), new Set()],
      [path.join('views', 'checkout-preset.html'), new Set()],
      [path.join('src', 'shell.html'), new Set()],
      [path.join('runtime', 'shell.html'), new Set(['runtime'])]
    ]) {
      const result = classifyFileDetailed(relPath, path.join('/tmp/fake-client', relPath), 'CLIENT_PLAIN', markerDirs, CLEAN);
      assert.equal(result.klass, 'KEEP');
      assert.equal(result.semantic_bucket, 'REUSABLE-SOURCE');
    }
  });

  await t.test('compound reusable parent segments retain LMF-shaped preset HTML', () => {
    for (const relPath of [
      path.join('livecanvas-presets', 'sections', 'CLIENT_GAMMA', '01-homepage-hero.html'),
      path.join('site_components', 'cards', 'offer.html'),
      path.join('theme-layouts', 'landing.htm')
    ]) {
      const result = classifyFileDetailed(relPath, path.join('/tmp/fake-client', relPath), 'CLIENT_GAMMA', new Set(), CLEAN);
      assert.equal(result.klass, 'KEEP');
      assert.equal(result.semantic_bucket, 'REUSABLE-SOURCE');
    }
  });

  await t.test('compound tokens are bounded and historical/output context wins over reusable context', () => {
    assert.equal(classify(path.join('presetting-tools', 'page.html'), { client: 'CLIENT_GAMMA' }), 'REVIEW');
    assert.equal(classify(path.join('backupable-pages', 'page.html'), { client: 'CLIENT_GAMMA' }), 'REVIEW');
    assert.equal(
      classify(path.join('livecanvas-presets', 'post-content-backup', '16017.html'), { client: 'CLIENT_GAMMA' }),
      'MOVE'
    );
    assert.equal(
      classify(path.join('livecanvas-presets', 'outputs', 'render.html'), { client: 'CLIENT_GAMMA' }),
      'MOVE'
    );
    assert.equal(classify(path.join('runtime', 'src', 'shell.html'), { client: 'CLIENT_GAMMA' }), 'KEEP');
  });

  await t.test('operational contracts stay local with explicit semantic basis', () => {
    for (const relPath of [
      path.join('projects', 'website', 'project.json'),
      path.join('projects', 'website', 'README.md'),
      path.join('projects', 'website', 'HOW_TO_RUN.md'),
      path.join('projects', 'website', 'WORKFLOW_GUIDE.md')
    ]) {
      const result = classifyFileDetailed(relPath, path.join('/tmp/fake-client', relPath), 'CLIENT_PLAIN', new Set(), CLEAN);
      assert.equal(result.klass, 'KEEP');
      assert.equal(result.semantic_bucket, 'CORE-METADATA');
    }
    const template = classifyFileDetailed('settings.template.json', '/tmp/fake-client/settings.template.json', 'CLIENT_PLAIN', new Set(), CLEAN);
    assert.equal(template.klass, 'KEEP');
    assert.equal(template.semantic_bucket, 'REUSABLE-SOURCE');
  });

  await t.test('dirty and PII precedence remain fail closed', () => {
    assert.equal(
      classifyFileDetailed(path.join('datasets', 'raw', 'post-content-backup.html'), '/tmp/fake-client/dirty.html', 'CLIENT_ALPHA', new Set(), DIRTY).klass,
      'DEFERRED-DIRTY'
    );
    assert.equal(
      classifyFileDetailed(path.join('datasets', 'raw', 'post-content-backup.html'), '/tmp/fake-client/private.html', 'CLIENT_ALPHA', new Set(), CLEAN).klass,
      'PII-MOVE'
    );
    assert.equal(
      classifyFileDetailed(path.join('datasets', 'raw', 'record.template.json'), '/tmp/fake-client/private-template.json', 'CLIENT_ALPHA', new Set(), CLEAN).klass,
      'PII-MOVE'
    );
    assert.equal(
      classifyFileDetailed(path.join('intake', 'workflow.template.html'), '/tmp/fake-client/intake-template.html', 'CLIENT_BETA', new Set(), CLEAN).klass,
      'PII-MOVE'
    );
    assert.equal(
      classifyFileDetailed(path.join('templates', 'workflow.template.html'), '/tmp/fake-client/dirty-template.html', 'CLIENT_PLAIN', new Set(), DIRTY).klass,
      'DEFERRED-DIRTY'
    );
    assert.equal(
      classifyFileDetailed(path.join('livecanvas-presets', 'page.html'), '/tmp/fake-client/dirty-compound-preset.html', 'CLIENT_PLAIN', new Set(), DIRTY).klass,
      'DEFERRED-DIRTY'
    );
    assert.equal(
      classifyFileDetailed(path.join('intake', 'livecanvas-presets', 'page.html'), '/tmp/fake-client/private-compound-preset.html', 'CLIENT_BETA', new Set(), CLEAN).klass,
      'PII-MOVE'
    );
  });

  await t.test('only inviolable root controls bypass dirty state', () => {
    assert.equal(classify('client.json', { dirty: DIRTY }), 'KEEP');
    assert.equal(classify('README.md', { dirty: DIRTY }), 'DEFERRED-DIRTY');
    assert.equal(classify(path.join('projects', 'website', 'project.json'), { dirty: DIRTY }), 'DEFERRED-DIRTY');
  });

  await t.test('specification source stays KEEP', () => {
    assert.equal(classify(path.join('contracts', 'behavior.spec')), 'KEEP');
  });

  await t.test('unconfigured clients do not inherit CLIENT_ALPHA JSON redaction', () => {
    assert.equal(classify(path.join('workflows', 'dataset-record.json'), { client: 'CLIENT_PLAIN' }), 'MOVE');
  });
});

test('LMF-shaped semantic fixture produces the reviewed corrected aggregate with no public REVIEW', async () => {
  const classified = [];
  function addGroup(prefix, count, totalBytes, relPathFor, dirty = CLEAN) {
    for (let index = 0; index < count; index += 1) {
      const relPath = relPathFor(index);
      const size = index === 0 ? totalBytes - (count - 1) : 1;
      classified.push({
        relPath,
        absPath: path.join('/tmp/lmf-semantic-fixture', prefix, String(index)),
        size,
        ...classifyFileDetailed(relPath, path.join('/tmp/lmf-semantic-fixture', prefix, String(index)), 'CLIENT_GAMMA', new Set(), dirty)
      });
    }
  }

  addGroup('core', 11, 32080, (index) => path.join('plans', `core-${index}.md`));
  addGroup('automation', 15, 65589, (index) => path.join('automation', `tool-${index}.js`));
  addGroup('existing-reusable', 1, 2231, () => path.join('templates', 'base.html'));
  addGroup('existing-history', 156, 16854311, (index) => path.join('references', `reference-${index}.txt`));
  addGroup('dirty', 1, 6148, () => path.join('working', 'dirty.txt'), DIRTY);
  addGroup('livecanvas', 8, 16153, (index) =>
    path.join('livecanvas-presets', index % 2 ? 'blocks' : 'sections', 'CLIENT_GAMMA', `${index + 1}-preset.html`)
  );
  addGroup('backup', 39, 182461, (index) => path.join('post-content-backup', `${16017 + index}.html`));

  const artifacts = await buildClassificationArtifacts(classified, 'CLIENT_GAMMA');
  const aggregate = { classes: {}, semantics: {} };
  for (const entry of artifacts.listing) {
    const classSummary = aggregate.classes[entry.klass] || { files: 0, bytes: 0 };
    classSummary.files += 1;
    classSummary.bytes += entry.size;
    aggregate.classes[entry.klass] = classSummary;
    const semanticSummary = aggregate.semantics[entry.semantic_bucket] || { files: 0, bytes: 0 };
    semanticSummary.files += 1;
    semanticSummary.bytes += entry.size;
    aggregate.semantics[entry.semantic_bucket] = semanticSummary;
  }

  assert.deepEqual(aggregate.classes, {
    KEEP: { files: 35, bytes: 116053 },
    MOVE: { files: 195, bytes: 17036772 },
    'DEFERRED-DIRTY': { files: 1, bytes: 6148 }
  });
  assert.deepEqual(aggregate.semantics, {
    'CORE-METADATA': { files: 11, bytes: 32080 },
    'EXECUTABLE-AUTOMATION': { files: 15, bytes: 65589 },
    'REUSABLE-SOURCE': { files: 9, bytes: 18384 },
    'HISTORICAL-REFERENCE': { files: 195, bytes: 17036772 },
    REVIEW: { files: 1, bytes: 6148 }
  });
  assert.equal(artifacts.listing.some((entry) => entry.klass === 'REVIEW'), false);
  assert.equal(artifacts.listing.filter((entry) => entry.klass === 'DEFERRED-DIRTY' && entry.identity_redacted).length, 1);
  assert.equal(artifacts.piiPathMap.entries.length, 0);
});

test('PII identities move between active and retained private sets without changing ID', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-storage-retained-id-'));
  const piiPath = path.join(root, 'record.csv');
  fs.writeFileSync(piiPath, 'email,phone\nsynthetic@example.com,555-0100\n');
  const prior = {
    pii_id: '44444444-4444-4444-8444-444444444444',
    repo_relpath: path.join('datasets', 'raw', 'record.csv'),
    size: fs.statSync(piiPath).size,
    sha256: require('node:crypto').createHash('sha256').update(fs.readFileSync(piiPath)).digest('hex')
  };
  try {
    const retained = await buildClassificationArtifacts(
      [{ klass: 'KEEP', relPath: prior.repo_relpath, absPath: piiPath, size: prior.size }],
      'CLIENT_ALPHA',
      { priorMap: { entries: [prior], retained_entries: [] } }
    );
    assert.equal(retained.piiPathMap.entries.length, 0);
    assert.equal(retained.piiPathMap.retained_entries[0].pii_id, prior.pii_id);

    const reactivated = await buildClassificationArtifacts(
      [{ klass: 'PII-MOVE', relPath: prior.repo_relpath, absPath: piiPath, size: prior.size }],
      'CLIENT_ALPHA',
      { priorMap: retained.piiPathMap }
    );
    assert.equal(reactivated.piiPathMap.entries[0].pii_id, prior.pii_id);
    assert.equal(reactivated.piiPathMap.retained_entries.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('duplicate identities across active and retained private sets fail closed', () => {
  const entry = {
    pii_id: '55555555-5555-4555-8555-555555555555',
    repo_relpath: 'first.csv',
    size: 1,
    sha256: 'a'.repeat(64)
  };
  assert.throws(
    () => selectReusablePiiMap(
      {
        schema: 'ClientStoragePiiPathMap/1.0',
        client: 'CLIENT_ALPHA',
        entries: [entry],
        retained_entries: [{ ...entry, repo_relpath: 'second.csv' }]
      },
      { entries: [{ pii_id: entry.pii_id }] },
      'CLIENT_ALPHA'
    ),
    /invalid/
  );
});

test('preserved-only PII evidence prevents private identity regeneration', () => {
  assert.throws(
    () => selectReusablePiiMap(
      null,
      {
        entries: [],
        preserved_snapshots: [{
          pii_id: '66666666-6666-4666-8666-666666666666',
          size: 0,
          sha256: 'a'.repeat(64)
        }]
      },
      'CLIENT_ALPHA'
    ),
    /missing/
  );
});

test('malformed preserved state prevents private identity regeneration', () => {
  assert.throws(
    () => selectReusablePiiMap(
      null,
      { entries: [], preserved_snapshots: { malformed: true } },
      'CLIENT_ALPHA'
    ),
    /missing/
  );
});

test('consecutive CLI classifications exclude private controls and preserve inventory identity', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-storage-classify-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const clientRoot = path.join(repo, 'clients', 'CLIENT_ALPHA');
  fs.mkdirSync(path.join(clientRoot, 'datasets', 'raw'), { recursive: true });
  fs.writeFileSync(path.join(clientRoot, 'client.json'), JSON.stringify({ code: 'CLIENT_ALPHA', ...recordsPolicyJson() }));
  fs.writeFileSync(path.join(clientRoot, 'datasets', 'raw', 'record.json'), '{"synthetic":true}');
  fs.writeFileSync(
    path.join(clientRoot, 'rename-map.json'),
    JSON.stringify({ schema: 'ClientStorageRenameMap/1.0', client: 'CLIENT_ALPHA', renames: [] })
  );

  for (const args of [
    ['init', '-q'],
    ['add', '.'],
    ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-qm', 'fixture']
  ]) {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }

  function runClassify() {
    const result = spawnSync(process.execPath, [CLASSIFY_SCRIPT, '--client', 'CLIENT_ALPHA'], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: repo, HOME: path.join(root, 'home') }
    });
    assert.equal(result.status, 0, result.stderr);
    const status = JSON.parse(result.stderr.trim().split('\n').at(-1));
    return JSON.parse(fs.readFileSync(path.join(repo, status.report_json), 'utf8'));
  }

  const first = runClassify();
  const second = runClassify();
  assert.deepEqual(
    {
      total_files: second.total_files,
      total_bytes: second.total_bytes,
      counts: second.counts,
      bytes: second.bytes
    },
    {
      total_files: first.total_files,
      total_bytes: first.total_bytes,
      counts: first.counts,
      bytes: first.bytes
    }
  );
  assert.equal(first.total_files, 2);
  assert.equal(first.entries.find((entry) => entry.klass === 'PII-MOVE').pii_id,
    second.entries.find((entry) => entry.klass === 'PII-MOVE').pii_id);
  assert.equal(first.pii_identity_disposition, 'new');
  assert.equal(second.pii_identity_disposition, 'reused');
  for (const report of [first, second]) {
    assert.equal(report.schema, 'ClientStorageClassify/2.0');
    assert.deepEqual(validateClassifyReportSemantics(report), { ok: true, contract: 'semantic-v2' });
    assert.equal(report.entries.every((entry) => typeof entry.semantic_bucket === 'string'), true);
    assert.equal(report.entries.every((entry) => typeof entry.basis === 'string' && entry.basis.length > 0), true);
    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes('pii-path-map.json'), false);
    assert.equal(serialized.includes('rename-map.json'), false);
  }
});

test('CLI classification defers and redacts ignored, untracked, and dirty paths', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-storage-git-state-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const clientRoot = path.join(repo, 'clients', 'CLIENT_ALPHA');
  const rawDir = path.join(clientRoot, 'datasets', 'raw');
  fs.mkdirSync(rawDir, { recursive: true });
  fs.writeFileSync(
    path.join(repo, '.gitignore'),
    '/clients/CLIENT_ALPHA/datasets/raw/ignored-local.json\n/clients/CLIENT_ALPHA/ignored-source.css\n'
  );
  fs.writeFileSync(path.join(clientRoot, 'client.json'), JSON.stringify({ code: 'CLIENT_ALPHA', ...recordsPolicyJson() }));
  fs.writeFileSync(path.join(rawDir, 'dirty-local.json'), '{"version":1}');
  fs.writeFileSync(path.join(rawDir, 'customer-1d5c78c7-83b2-4c52-a613-ef16e2a12345.html'), '<html></html>');
  fs.mkdirSync(path.join(clientRoot, 'plans'), { recursive: true });
  fs.writeFileSync(
    path.join(clientRoot, 'plans', 'customer-1d5c78c7-83b2-4c52-a613-ef16e2a12345-summary.md'),
    'synthetic summary'
  );
  fs.writeFileSync(path.join(clientRoot, 'reference.txt'), 'clean reference');

  for (const args of [
    ['init', '-q'],
    ['add', '.'],
    ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-qm', 'fixture']
  ]) {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  fs.writeFileSync(path.join(rawDir, 'ignored-local.json'), '{"ignored":true}');
  fs.writeFileSync(path.join(clientRoot, 'ignored-source.css'), '/* ignored local source */');
  fs.writeFileSync(path.join(rawDir, 'dirty-local.json'), '{"version":2}');
  fs.writeFileSync(path.join(clientRoot, 'untracked-local.bin'), 'untracked local');

  const result = spawnSync(process.execPath, [CLASSIFY_SCRIPT, '--client', 'CLIENT_ALPHA'], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo, HOME: path.join(root, 'home') }
  });
  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stderr.trim().split('\n').at(-1));
  const jsonText = fs.readFileSync(path.join(repo, status.report_json), 'utf8');
  const mdText = fs.readFileSync(path.join(repo, status.report_md), 'utf8');
  const report = JSON.parse(jsonText);
  assert.equal(report.counts['DEFERRED-DIRTY'], 4);
  assert.equal(report.counts.MOVE, 1);
  assert.equal(report.counts.KEEP, 1);
  assert.equal(report.counts['PII-MOVE'], 2);
  assert.equal(report.semantic_counts.REVIEW, 4);
  assert.equal(report.semantic_counts['HISTORICAL-REFERENCE'], 3);
  assert.equal(report.semantic_counts['CORE-METADATA'], 1);
  assert.equal(report.entries.filter((entry) => entry.klass === 'DEFERRED-DIRTY').length, 4);
  assert.equal(
    report.entries
      .filter((entry) => entry.klass === 'DEFERRED-DIRTY')
      .every((entry) => !Object.prototype.hasOwnProperty.call(entry, 'relpath') && entry.identity_redacted),
    true
  );
  assert.equal(report.entries.some((entry) => entry.klass === 'MOVE' && entry.relpath === 'reference.txt'), true);
  for (const privateName of [
    'ignored-local.json',
    'ignored-source.css',
    'dirty-local.json',
    'untracked-local.bin',
    'customer-1d5c78c7-83b2-4c52-a613-ef16e2a12345.html',
    'customer-1d5c78c7-83b2-4c52-a613-ef16e2a12345-summary.md'
  ]) {
    assert.equal(jsonText.includes(privateName), false);
    assert.equal(mdText.includes(privateName), false);
  }
});
