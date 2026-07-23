'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  SYSTEM_PLAN_DIR,
  clientPlanDir,
  resolveTaskPlanPaths,
  resolveWriteRoot,
  listAllTaskPlans,
  listAmendments
} = require('../resolve-task-plan');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

// ---------------------------------------------------------------------------
// Test 1: Schema contract -- scope_type and storage_root are required
// ---------------------------------------------------------------------------

describe('schema contract', () => {
  it('scope_type and storage_root are in the required array', () => {
    const schemaPath = path.join(PROJECT_ROOT, 'tools', 'planning', 'task-intake.schema.json');
    assert.ok(fs.existsSync(schemaPath), 'task-intake.schema.json must exist');

    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    assert.ok(Array.isArray(schema.required), 'schema.required must be an array');
    assert.ok(
      schema.required.includes('scope_type'),
      'scope_type must be in schema.required'
    );
    assert.ok(
      schema.required.includes('storage_root'),
      'storage_root must be in schema.required'
    );
  });

  it('scope_type enum allows only system and client', () => {
    const schemaPath = path.join(PROJECT_ROOT, 'tools', 'planning', 'task-intake.schema.json');
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    const scopeProp = schema.properties && schema.properties.scope_type;
    assert.ok(scopeProp, 'schema must define properties.scope_type');
    assert.deepStrictEqual(
      scopeProp.enum,
      ['system', 'client'],
      'scope_type enum must be ["system", "client"]'
    );
  });
});

// ---------------------------------------------------------------------------
// Test 2: No client-scoped plans in _dev
// ---------------------------------------------------------------------------

describe('no client-scoped plans in _dev', () => {
  it('every plan in _dev/reports/analysis/task-plans/ has null client_code or scope_type=system', () => {
    const allPlans = listAllTaskPlans(PROJECT_ROOT);
    const systemDir = path.join(PROJECT_ROOT, SYSTEM_PLAN_DIR);
    const devPlans = allPlans.filter((p) => p.storageRoot === systemDir);

    assert.ok(devPlans.length > 0, 'Expected at least one system plan to exist for this test to be meaningful');

    for (const plan of devPlans) {
      if (!fs.existsSync(plan.jsonPath)) continue;

      const data = JSON.parse(fs.readFileSync(plan.jsonPath, 'utf8'));
      const clientCode = data.client_code || null;
      const scopeType = data.scope_type || null;

      // A plan in _dev must either have null client_code OR scope_type === 'system'
      const isSystemScoped = clientCode === null || scopeType === 'system';
      assert.ok(
        isSystemScoped,
        `Plan "${plan.taskId}" in _dev has client_code="${clientCode}" and ` +
        `scope_type="${scopeType}" -- client-scoped plans must not live in _dev`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Test 3: No system-scoped plans in client roots
// ---------------------------------------------------------------------------

describe('no system-scoped plans in client roots', () => {
  it('every plan in clients/*/plans/ has non-null client_code matching the directory', () => {
    const allPlans = listAllTaskPlans(PROJECT_ROOT);
    const clientPlans = allPlans.filter((p) => p.scopeType === 'client');

    // This test is valid even if no client plans exist yet (vacuously true),
    // but we log a note for visibility.
    if (clientPlans.length === 0) {
      return; // No client plans to check
    }

    for (const plan of clientPlans) {
      if (!fs.existsSync(plan.jsonPath)) continue;

      const data = JSON.parse(fs.readFileSync(plan.jsonPath, 'utf8'));
      const clientCode = data.client_code || null;
      const scopeType = data.scope_type || null;

      // Must NOT be system-scoped
      assert.notStrictEqual(
        scopeType,
        'system',
        `Plan "${plan.taskId}" in client root ${plan.clientCode} has scope_type="system" -- system plans must not live in client roots`
      );

      // client_code must be non-null
      assert.ok(
        clientCode !== null && clientCode !== undefined,
        `Plan "${plan.taskId}" in client root ${plan.clientCode} has null client_code`
      );

      // client_code must match the directory
      assert.strictEqual(
        clientCode,
        plan.clientCode,
        `Plan "${plan.taskId}" has client_code="${clientCode}" but lives under clients/${plan.clientCode}/plans/`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Test 4: storage_root matches actual location
// ---------------------------------------------------------------------------

describe('storage_root matches actual file location', () => {
  it('every plan JSON has a storage_root that matches its directory relative to project root', () => {
    const allPlans = listAllTaskPlans(PROJECT_ROOT);

    for (const plan of allPlans) {
      if (!fs.existsSync(plan.jsonPath)) continue;

      const data = JSON.parse(fs.readFileSync(plan.jsonPath, 'utf8'));
      const declaredRoot = data.storage_root;

      if (declaredRoot === undefined || declaredRoot === null) {
        // Plans that predate the migration might lack storage_root;
        // the field is schema-required, so flag it.
        assert.fail(
          `Plan "${plan.taskId}" at ${plan.jsonPath} is missing storage_root`
        );
        continue;
      }

      // Compute the actual relative path from project root to the plan's directory
      const actualDir = path.dirname(plan.jsonPath);
      const actualRelative = path.relative(PROJECT_ROOT, actualDir);

      assert.strictEqual(
        declaredRoot,
        actualRelative,
        `Plan "${plan.taskId}": storage_root="${declaredRoot}" ` +
        `does not match actual location "${actualRelative}"`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Test 5: Resolver returns correct results
// ---------------------------------------------------------------------------

describe('resolver behavior', () => {
  it('resolves a known system plan by task-id', () => {
    // Use the enforcement plan itself as a known system plan
    const systemDir = path.join(PROJECT_ROOT, SYSTEM_PLAN_DIR);
    const systemFiles = fs.existsSync(systemDir)
      ? fs.readdirSync(systemDir).filter((f) => f.endsWith('__plan.json'))
      : [];

    if (systemFiles.length === 0) return; // skip if none exist

    const taskId = systemFiles[0].slice(0, -('__plan.json'.length));
    const result = resolveTaskPlanPaths(PROJECT_ROOT, taskId);

    assert.ok(result, `Expected resolver to find system plan "${taskId}"`);
    assert.strictEqual(result.resolvedFrom, 'system');
    assert.strictEqual(result.clientCode, null);
    assert.ok(result.jsonPath.endsWith('__plan.json'));
    assert.ok(result.markdownPath.endsWith('__plan.md'));
  });

  it('resolves a known client plan by task-id', () => {
    const allPlans = listAllTaskPlans(PROJECT_ROOT);
    const clientPlans = allPlans.filter((p) => p.scopeType === 'client');

    if (clientPlans.length === 0) return; // skip if none exist

    const taskId = clientPlans[0].taskId;
    const result = resolveTaskPlanPaths(PROJECT_ROOT, taskId);

    assert.ok(result, `Expected resolver to find client plan "${taskId}"`);
    assert.strictEqual(result.resolvedFrom, 'client');
    assert.ok(result.clientCode, 'Client plan should have non-null clientCode');
    assert.ok(result.jsonPath.endsWith('__plan.json'));
  });

  it('returns null for a nonexistent task-id', () => {
    const result = resolveTaskPlanPaths(PROJECT_ROOT, 'nonexistent-fake-id-zzz');
    assert.strictEqual(result, null);
  });

  it('returns null for empty input', () => {
    assert.strictEqual(resolveTaskPlanPaths(PROJECT_ROOT, ''), null);
    assert.strictEqual(resolveTaskPlanPaths(PROJECT_ROOT, null), null);
    assert.strictEqual(resolveTaskPlanPaths(PROJECT_ROOT, undefined), null);
  });

  it('resolves explicit paths correctly', () => {
    const systemDir = path.join(PROJECT_ROOT, SYSTEM_PLAN_DIR);
    const systemFiles = fs.existsSync(systemDir)
      ? fs.readdirSync(systemDir).filter((f) => f.endsWith('__plan.json'))
      : [];

    if (systemFiles.length === 0) return;

    const explicitPath = path.join(SYSTEM_PLAN_DIR, systemFiles[0]);
    const result = resolveTaskPlanPaths(PROJECT_ROOT, explicitPath);

    assert.ok(result, 'Expected resolver to handle explicit path');
    assert.strictEqual(result.resolvedFrom, 'explicit-path');
  });

  it('throws on ambiguous task-id (same id in multiple roots)', () => {
    // Create a temporary fixture: write a fake plan in a temp client dir
    // that duplicates a known system plan id
    const systemDir = path.join(PROJECT_ROOT, SYSTEM_PLAN_DIR);
    const systemFiles = fs.existsSync(systemDir)
      ? fs.readdirSync(systemDir).filter((f) => f.endsWith('__plan.json'))
      : [];

    if (systemFiles.length === 0) return;

    const taskId = systemFiles[0].slice(0, -('__plan.json'.length));

    // Create a temp client dir with a plans/ subdirectory containing the same id
    const tempClient = 'ZZTEST' + Date.now();
    const tempPlansDir = path.join(PROJECT_ROOT, 'clients', tempClient, 'plans');
    const tempJsonPath = path.join(tempPlansDir, systemFiles[0]);

    try {
      fs.mkdirSync(tempPlansDir, { recursive: true });
      fs.writeFileSync(tempJsonPath, JSON.stringify({
        task_id: taskId,
        scope_type: 'client',
        storage_root: `clients/${tempClient}/plans`,
        client_code: tempClient
      }));

      assert.throws(
        () => resolveTaskPlanPaths(PROJECT_ROOT, taskId),
        (err) => {
          assert.ok(err instanceof Error);
          assert.ok(
            err.message.includes('Ambiguous'),
            `Expected "Ambiguous" in error message, got: ${err.message}`
          );
          return true;
        },
        'Expected resolver to throw on ambiguous task-id'
      );
    } finally {
      // Cleanup
      try { fs.unlinkSync(tempJsonPath); } catch (_e) { /* ignore */ }
      try { fs.rmdirSync(tempPlansDir); } catch (_e) { /* ignore */ }
      try { fs.rmdirSync(path.join(PROJECT_ROOT, 'clients', tempClient)); } catch (_e) { /* ignore */ }
    }
  });
});

// ---------------------------------------------------------------------------
// Test 6: resolveWriteRoot
// ---------------------------------------------------------------------------

describe('resolveWriteRoot', () => {
  it('returns system plan dir for scope_type=system', () => {
    const result = resolveWriteRoot(PROJECT_ROOT, 'system');
    const expected = path.join(PROJECT_ROOT, SYSTEM_PLAN_DIR);
    assert.strictEqual(result, expected);
  });

  it('returns client plan dir for scope_type=client with clientCode', () => {
    const result = resolveWriteRoot(PROJECT_ROOT, 'client', 'CLIENTA');
    const expected = path.join(PROJECT_ROOT, 'clients', 'CLIENTA', 'plans');
    assert.strictEqual(result, expected);
  });

  it('throws when scope_type=client without clientCode', () => {
    assert.throws(
      () => resolveWriteRoot(PROJECT_ROOT, 'client'),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('client_code') || err.message.includes('client scope'));
        return true;
      }
    );
  });

  it('throws when scope_type is null', () => {
    assert.throws(
      () => resolveWriteRoot(PROJECT_ROOT, null),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('scope_type'));
        return true;
      }
    );
  });

  it('throws when scope_type is undefined', () => {
    assert.throws(
      () => resolveWriteRoot(PROJECT_ROOT, undefined),
      (err) => {
        assert.ok(err instanceof Error);
        return true;
      }
    );
  });

  it('throws when scope_type is an invalid string', () => {
    assert.throws(
      () => resolveWriteRoot(PROJECT_ROOT, 'bogus'),
      (err) => {
        assert.ok(err instanceof Error);
        return true;
      }
    );
  });
});

describe('listAmendments', () => {
  it('does not treat advisory sidecars as amendment artifacts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smos-amendments-'));
    try {
      fs.writeFileSync(path.join(root, 'demo__amendment__20260715T120000Z.json'), '{}\n');
      fs.writeFileSync(path.join(root, 'demo__amendment__20260715T120000Z.json.advisory.json'), '{}\n');

      const amendments = listAmendments(root, 'demo');
      assert.strictEqual(amendments.length, 1);
      assert.strictEqual(amendments[0].timestamp, '20260715T120000Z');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Test 7: Command contracts do not hardcode _dev paths for task-plan lookup
// ---------------------------------------------------------------------------

describe('command contracts reference shared resolver, not hardcoded paths', () => {
  const COMMAND_DIR = path.join(PROJECT_ROOT, '.claude', 'commands');

  // The patterns that indicate a hardcoded _dev task-plan path used as an
  // argument/lookup pattern (not as a general reference or description).
  const HARDCODED_PATTERNS = [
    '_dev/reports/analysis/task-plans/$ARGUMENTS',
    '_dev/reports/analysis/task-plans/<task-id>',
    '_dev/reports/analysis/task-plans/<plan-id>'
  ];

  const COMMANDS_TO_CHECK = [
    'plan-task.md',
    'create-plan.md',
    'run-plan.md',
    'review-task-plan.md',
    'claim-intake.md',
    'whats-next.md'
  ];

  for (const cmdFile of COMMANDS_TO_CHECK) {
    it(`${cmdFile} does not contain hardcoded _dev task-plan lookup patterns`, () => {
      const cmdPath = path.join(COMMAND_DIR, cmdFile);
      if (!fs.existsSync(cmdPath)) {
        // Command file may not exist; not a test failure for lane enforcement
        return;
      }

      const content = fs.readFileSync(cmdPath, 'utf8');

      for (const pattern of HARDCODED_PATTERNS) {
        assert.ok(
          !content.includes(pattern),
          `${cmdFile} contains hardcoded pattern "${pattern}" -- ` +
          'commands should reference <storage_root> or the shared resolver instead'
        );
      }
    });
  }
});
