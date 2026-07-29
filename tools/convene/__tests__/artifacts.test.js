'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeArtifacts } = require('../lib/artifacts');
const { resolveTriad } = require('../lib/profiles');

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'convene-artifacts-test-'));
}

function cleanupTempRoot(root) {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch (_) { /* best-effort */ }
}

describe('convene artifacts', () => {
  it('writes slot-aware prompts, responses, and manifest fields', () => {
    const root = makeTempRoot();
    try {
      const args = {
        scope: 'artifact-test',
        task: 'review this',
        contextFiles: [],
        origin: 'claude',
        timeoutSeconds: 180,
        dryRun: false,
        only: null
      };
      const triad = resolveTriad({ profile: 'kernel' });
      triad.slots = triad.slots.map((slot) => ({ ...slot, is_origin: slot.id === 'alpha' }));
      const participants = triad.slots.filter((slot) => !slot.is_origin);
      const prompts = {
        now: 'prompt for now',
        omega: 'prompt for omega'
      };
      const results = {
        now: {
          actor: 'codex',
          status: 'success',
          duration_ms: 10,
          exit_code: 0,
          error: null,
          output: 'codex output'
        },
        omega: {
          actor: 'gemini',
          status: 'success',
          duration_ms: 20,
          exit_code: 0,
          error: null,
          output: 'gemini output'
        }
      };

      writeArtifacts(root, args, triad, prompts, results, participants);

      assert.equal(fs.existsSync(path.join(root, 'prompts', 'now__codex.md')), true);
      assert.equal(fs.existsSync(path.join(root, 'now__codex.md')), true);
      assert.equal(fs.existsSync(path.join(root, 'codex.md')), true);
      const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
      assert.equal(manifest.schema, 'ConveneRun/3.0');
      assert.deepEqual(manifest.participant_slots, [
        { id: 'now', actor: 'codex' },
        { id: 'omega', actor: 'gemini' }
      ]);
      assert.equal(manifest.triad_slots.find((slot) => slot.id === 'alpha').is_origin, true);
    } finally {
      cleanupTempRoot(root);
    }
  });
});
