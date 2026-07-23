'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PATCH_SCRIPT = path.join(REPO_ROOT, 'scripts/patch-pi-tool-execution.js');

function unpatchedFixture() {
  return [
    'class ToolExecutionComponent {',
    '  maybeConvertImagesForKitty() {',
    '        if (!this.result)',
    '            return;',
    '        const imageBlocks = this.result.content.filter((c) => c.type === "image");',
    '  }',
    '    updateDisplay() {',
    '        const bgFn = this.isPartial',
    '        if (this.result) {',
    '            const imageBlocks = this.result.content.filter((c) => c.type === "image");',
    '            const caps = getCapabilities();',
    '        }',
    '        const component = resultRenderer({ content: this.result.content, details: this.result.details },',
    '  }',
    '    getTextOutput() {',
    '        return getRenderedTextOutput(this.result, this.showImages);',
    '    }',
    '}',
    '',
  ].join('\n');
}

describe('Pi tool-execution patch script', () => {
  it('applies the v0.80.3 result.content guards to an unpatched runtime file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-tool-execution-'));
    const target = path.join(dir, 'tool-execution.js');
    fs.writeFileSync(target, unpatchedFixture());

    const result = spawnSync(process.execPath, [PATCH_SCRIPT], {
      cwd: REPO_ROOT,
      env: { ...process.env, PI_TOOL_EXECUTION_FILE: target },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const patched = fs.readFileSync(target, 'utf8');
    assert.match(patched, /if \(!Array\.isArray\(this\.result\.content\)\)\n            return;/);
    assert.match(patched, /if \(this\.result && !Array\.isArray\(this\.result\.content\)\)\n            this\.result\.content = \[\];/);
    assert.doesNotMatch(patched, /updateDisplay\(\) \{\n        if \(!this\.result\)\n            return;/);
    assert.match(patched, /if \(this\.result && Array\.isArray\(this\.result\.content\)\) \{/);
    assert.match(patched, /const safeContent = Array\.isArray\(this\.result\.content\) \? this\.result\.content : \[\];/);
    assert.match(patched, /const safeResult = this\.result/);
    assert.match(patched, /getRenderedTextOutput\(safeResult, this\.showImages\)/);
  });
});
