#!/usr/bin/env node
'use strict';

/**
 * Tests for declared-trigger-lint.cjs
 * Uses a temp fixture directory; stdlib only (assert + fs + os + path).
 * Convention follows tools/kernel/hooks/__tests__/*.test.cjs.
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const { spawnSync } = require('child_process');

const LINT = path.resolve(__dirname, '../declared-trigger-lint.cjs');

let pass = 0;
let fail = 0;

function check(name, fn) {
  try {
    fn();
    pass++;
  } catch (err) {
    fail++;
    console.error(`FAIL  ${name}`);
    console.error(err.stack || err.message);
  }
}

// ─── fixture helpers ──────────────────────────────────────────────────────────

function makeRoot(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtlint-test-'));

  // commands dir (content is JSON despite .yaml extension)
  const cmdDir = path.join(root, 'instructions/canonical/commands');
  fs.mkdirSync(cmdDir, { recursive: true });

  // hooks dir
  const hooksDir = path.join(root, 'tools/kernel/hooks');
  fs.mkdirSync(hooksDir, { recursive: true });

  // .claude dir with minimal settings.json
  const claudeDir = path.join(root, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudeDir, 'settings.json'),
    JSON.stringify(opts.settings || { hooks: {} })
  );

  // package.json
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ scripts: opts.scripts || {} })
  );

  return { root, cmdDir, hooksDir };
}

function writeSpec(cmdDir, id, extra = {}) {
  const spec = { id, ...extra };
  fs.writeFileSync(path.join(cmdDir, `${id}.yaml`), JSON.stringify(spec));
}

function writeHook(hooksDir, name, content) {
  fs.writeFileSync(path.join(hooksDir, name), content);
}

function runLint(root, extraArgs = []) {
  const tmpReport = path.join(os.tmpdir(), `dtlint-report-${Date.now()}.md`);
  const result = spawnSync(
    process.execPath,
    [LINT, '--root', root, '--report', tmpReport, ...extraArgs],
    { cwd: root, encoding: 'utf8', env: { ...process.env } }
  );
  let report = '';
  try { report = fs.readFileSync(tmpReport, 'utf8'); } catch { /* ok */ }
  try { fs.unlinkSync(tmpReport); } catch { /* ok */ }
  return { ...result, report };
}

function runLintJson(root) {
  const result = spawnSync(
    process.execPath,
    [LINT, '--root', root, '--json'],
    { cwd: root, encoding: 'utf8', env: { ...process.env } }
  );
  let data = null;
  try { data = JSON.parse(result.stdout); } catch { /* ok */ }
  return { ...result, data };
}

// ─── tests ────────────────────────────────────────────────────────────────────

// A1: spec with no trigger key — no finding
check('A1: spec without trigger key passes', () => {
  const { root, cmdDir } = makeRoot();
  writeSpec(cmdDir, 'no-trigger', { description: 'plain spec' });
  const r = runLintJson(root);
  assert.equal(r.status, 0, 'exit 0');
  assert.equal(r.data.orphaned_triggers, 0);
});

// A2: spec with cadence_triggers and no driver → orphaned finding
check('A2: spec with cadence_triggers and no driver is flagged', () => {
  const { root, cmdDir } = makeRoot();
  writeSpec(cmdDir, 'my-cmd', {
    cadence_triggers: { interval: 'every 5 turns' }
  });
  const r = runLintJson(root);
  assert.equal(r.status, 0, 'always exit 0 in report mode');
  assert.equal(r.data.orphaned_triggers, 1);
  assert.equal(r.data.findings[0].id, 'my-cmd');
});

// A3: spec with bridge_signal inside cadence_triggers and no driver → orphaned
check('A3: nested bridge_signal with no driver is flagged', () => {
  const { root, cmdDir } = makeRoot();
  writeSpec(cmdDir, 'bridged-cmd', {
    cadence_triggers: {
      bridge_signal: { signal_scope: 'test', recommended_next_command: '/test' }
    }
  });
  const r = runLintJson(root);
  assert.equal(r.data.orphaned_triggers, 1);
});

// A4: spec with explicit driver field (non-manual) → passes
check('A4: spec with explicit driver.type=hook passes', () => {
  const { root, cmdDir } = makeRoot();
  writeSpec(cmdDir, 'hooked-cmd', {
    cadence_triggers: { interval: 'every session' },
    driver: { type: 'hook', ref: 'dispatch-session-start.cjs' }
  });
  const r = runLintJson(root);
  assert.equal(r.data.orphaned_triggers, 0);
});

// A5: manual driver without owner/reason/workflow → flagged
check('A5: manual driver missing owner/reason/workflow is flagged', () => {
  const { root, cmdDir } = makeRoot();
  writeSpec(cmdDir, 'manual-cmd', {
    cadence_triggers: { interval: 'on-demand' },
    driver: { type: 'manual', owner: 'operator' }  // missing reason + workflow
  });
  const r = runLintJson(root);
  assert.equal(r.data.orphaned_triggers, 1);
  assert.match(r.data.findings[0].reason, /missing one or more/);
});

// A6: manual driver fully specified → passes
check('A6: manual driver with owner+reason+workflow passes', () => {
  const { root, cmdDir } = makeRoot();
  writeSpec(cmdDir, 'full-manual', {
    cadence_triggers: { interval: 'on-demand' },
    driver: { type: 'manual', owner: 'operator', reason: 'human gate', workflow: 'run /cmd' }
  });
  const r = runLintJson(root);
  assert.equal(r.data.orphaned_triggers, 0);
});

// A7: heuristic — command id appears in settings.json text → passes
check('A7: heuristic match in settings.json passes', () => {
  const { root, cmdDir } = makeRoot({
    settings: { hooks: { SessionStart: [{ command: 'node reconcile-lessons.cjs' }] } }
  });
  writeSpec(cmdDir, 'reconcile-lessons', {
    cadence_triggers: { interval: 'after stage' }
  });
  const r = runLintJson(root);
  assert.equal(r.data.orphaned_triggers, 0);
});

// B1: hook in settings.json → wired, passes
check('B1: hook referenced in settings.json passes', () => {
  const { root, hooksDir } = makeRoot({
    settings: { hooks: { PreToolUse: [{ command: 'node tools/kernel/hooks/my-hook.cjs' }] } }
  });
  writeHook(hooksDir, 'my-hook.cjs', `#!/usr/bin/env node\n'use strict';\n// normal hook\n`);
  const r = runLintJson(root);
  assert.equal(r.data.unwired_hooks, 0);
});

// B2: hook NOT in settings, NOT in dispatch, no UNWIRED marker → flagged
check('B2: unwired hook with no marker is flagged', () => {
  const { root, hooksDir } = makeRoot();
  writeHook(hooksDir, 'stray-hook.cjs', `#!/usr/bin/env node\n'use strict';\n// no wiring\n`);
  const r = runLintJson(root);
  assert.equal(r.data.unwired_hooks, 1);
  assert.equal(r.data.findings[0].hook, 'stray-hook.cjs');
});

// B3: hook with UNWIRED: marker → exempt
check('B3: hook with UNWIRED: marker is exempt', () => {
  const { root, hooksDir } = makeRoot();
  writeHook(hooksDir, 'parked-hook.cjs',
    `#!/usr/bin/env node\n'use strict';\n// UNWIRED: parked until phase-2 ships\n`
  );
  const r = runLintJson(root);
  assert.equal(r.data.unwired_hooks, 0);
});

// B4: hook required by a dispatch-*.cjs → passes
check('B4: hook required by dispatch file passes', () => {
  const { root, hooksDir } = makeRoot();
  writeHook(hooksDir, 'worker-hook.cjs', `#!/usr/bin/env node\n'use strict';\n`);
  // write a dispatch file (must be in settings to avoid flagging it)
  // and the target worker-hook must be required by it
  const settings = {
    hooks: {
      PreToolUse: [{ command: `node tools/kernel/hooks/dispatch-posttool.cjs` }]
    }
  };
  // Patch settings to include the dispatch file so it's wired
  fs.writeFileSync(
    path.join(root, '.claude/settings.json'),
    JSON.stringify({
      hooks: {
        PreToolUse: [{ command: 'node tools/kernel/hooks/dispatch-posttool.cjs' }]
      }
    })
  );
  writeHook(hooksDir, 'dispatch-posttool.cjs',
    `#!/usr/bin/env node\n'use strict';\nrequire('./worker-hook.cjs').main();\n`
  );
  const r = runLintJson(root);
  assert.equal(r.data.unwired_hooks, 0);
});

// General: always exits 0 even with findings
check('always exits 0 in report mode', () => {
  const { root, cmdDir, hooksDir } = makeRoot();
  writeSpec(cmdDir, 'trigger-x', { cadence_triggers: { interval: 'x' } });
  writeHook(hooksDir, 'orphan.cjs', `'use strict';\n`);
  const r = runLintJson(root);
  assert.equal(r.status, 0);
  assert.ok(r.data.findings.length >= 2);
});

// ─── summary ──────────────────────────────────────────────────────────────────

console.log(`\ndeclared-trigger-lint: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
