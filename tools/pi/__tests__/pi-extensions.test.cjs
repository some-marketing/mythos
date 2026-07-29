'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const EXTENSIONS_DIR = path.join(REPO_ROOT, '.pi', 'extensions');

function readExtension(name) {
  return fs.readFileSync(path.join(EXTENSIONS_DIR, name), 'utf8');
}

function renderResultBlocks(source) {
  const blocks = [];
  const marker = 'renderResult:';
  let cursor = 0;
  while (true) {
    const start = source.indexOf(marker, cursor);
    if (start === -1) break;
    const nextToolBoundary = source.indexOf('\n    },', start + marker.length);
    blocks.push(source.slice(start, nextToolBoundary === -1 ? source.length : nextToolBoundary));
    cursor = start + marker.length;
  }
  return blocks;
}

describe('Pi extension render contract', () => {
  it('bridge renderers return Pi components, not raw string arrays', () => {
    for (const file of fs.readdirSync(EXTENSIONS_DIR).filter((entry) => entry.endsWith('.ts'))) {
      const source = readExtension(file);
      for (const block of renderResultBlocks(source)) {
        assert.doesNotMatch(
          block,
          /return\s+\[/,
          `${file} renderResult returned a raw array; Pi v0.74 expects a Component with render(width)`
        );
      }
    }
  });

  it('Pi exposes the canonical Mythos bridge as an LLM-callable tool', () => {
    const source = readExtension('claude-bridge.ts');
    assert.match(source, /const DISPATCH_TOOL_NAME = "smos_dispatch_bridge"/);
    assert.match(source, /tools\/signals\/dispatch-bridge\.js/);
    assert.match(source, /pi\.registerTool\(\{\s*name: DISPATCH_TOOL_NAME/s);
  });
});
