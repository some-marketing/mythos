'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildPromptFromSignal,
  buildPromptFromSignalWithGrounding,
  buildPromptForArtifact,
  buildGroundingDescriptor,
  loadGroundingBundle,
  normalizeGroundingMode,
  GROUNDING_MODES
} = require('../codex-bridge');
const { sanitizeCodexCliEcho, writeLastMessageArtifact } = require('../codex-auto');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SUBSTRATE_ROOT = path.join(PROJECT_ROOT, '_dev', 'research', '{OPERATOR_NAME}-philosophy');

// The grounding substrate is a local-only directory. Tests that exercise
// the real kernel files are only meaningful when those files exist on
// disk. When they do not, we still exercise the 'none' path and assert
// that grounding loading is safe (empty text, no throw).
const SUBSTRATE_AVAILABLE = fs.existsSync(path.join(SUBSTRATE_ROOT, 'KERNEL.md'))
  && fs.existsSync(path.join(SUBSTRATE_ROOT, 'LINEAGE.md'))
  && fs.existsSync(path.join(SUBSTRATE_ROOT, 'grounding-patterns.md'));

function makeSignal(overrides) {
  return {
    filePath: '/tmp/fake-signal.json',
    name: 'fake-signal.json',
    signal: {
      schema: 'HandoffSignal/1.0',
      signal_type: 'ready-for-review',
      lifecycle_state: 'live',
      source: 'claude',
      scope: 'test-scope',
      timestamp: '2026-04-09T00:00:00.000Z',
      artifacts: ['_dev/reports/signals/fake.md'],
      decision_context_artifacts: [],
      validation: { ran: true, summary: 'ok' },
      recommended_next_actor: 'codex',
      recommended_next_command: '/review-progress',
      next_prompt_stub: '',
      next_step_detail: ['review the attached fake artifact'],
      blocked_by: [],
      ready_for_clear: false,
      ...(overrides || {})
    }
  };
}

describe('normalizeGroundingMode', () => {
  it('maps missing or unknown values to none', () => {
    assert.equal(normalizeGroundingMode(undefined), GROUNDING_MODES.NONE);
    assert.equal(normalizeGroundingMode(null), GROUNDING_MODES.NONE);
    assert.equal(normalizeGroundingMode(''), GROUNDING_MODES.NONE);
    assert.equal(normalizeGroundingMode('something-else'), GROUNDING_MODES.NONE);
  });

  it('accepts kernel and kernel_deep (case-insensitive)', () => {
    assert.equal(normalizeGroundingMode('kernel'), GROUNDING_MODES.KERNEL);
    assert.equal(normalizeGroundingMode('KERNEL'), GROUNDING_MODES.KERNEL);
    assert.equal(normalizeGroundingMode('kernel_deep'), GROUNDING_MODES.KERNEL_DEEP);
    assert.equal(normalizeGroundingMode('Kernel_Deep'), GROUNDING_MODES.KERNEL_DEEP);
  });
});

describe('loadGroundingBundle (none)', () => {
  it('returns an empty bundle for mode=none', () => {
    const result = loadGroundingBundle('none', { projectRoot: PROJECT_ROOT });
    assert.equal(result.mode, 'none');
    assert.equal(result.text, '');
    assert.deepEqual(result.files, []);
  });

  it('returns an empty bundle for missing mode', () => {
    const result = loadGroundingBundle(undefined, { projectRoot: PROJECT_ROOT });
    assert.equal(result.text, '');
    assert.deepEqual(result.files, []);
  });
});

describe('buildPromptFromSignal — non-grounding behavior is preserved', () => {
  it('produces a prompt with no "Grounding Context" header when grounding_mode is missing', () => {
    const signalInfo = makeSignal({});
    const prompt = buildPromptFromSignal(signalInfo);
    assert.equal(typeof prompt, 'string');
    assert.ok(!prompt.includes('## Grounding Context'),
      'prompt should not contain Grounding Context header when grounding_mode is missing');
    assert.ok(prompt.includes('Use the latest coordination signal'),
      'prompt should still contain the normal review header');
  });

  it('produces a prompt with no "Grounding Context" header when grounding_mode=none', () => {
    const signalInfo = makeSignal({ grounding_mode: 'none' });
    const prompt = buildPromptFromSignal(signalInfo);
    assert.ok(!prompt.includes('## Grounding Context'),
      'prompt should not contain Grounding Context header when grounding_mode=none');
  });

  it('is byte-identical to the no-grounding-field case when grounding_mode=none', () => {
    const a = buildPromptFromSignal(makeSignal({}));
    const b = buildPromptFromSignal(makeSignal({ grounding_mode: 'none' }));
    assert.equal(String(a), String(b),
      'grounding_mode=none must not change the prompt body vs missing grounding_mode');
  });
});

describe('buildPromptFromSignal — grounding_mode=kernel', { skip: !SUBSTRATE_AVAILABLE }, () => {
  it('prepends a Grounding Context section containing KERNEL.md content', () => {
    const signalInfo = makeSignal({ grounding_mode: 'kernel' });
    const prompt = buildPromptFromSignal(signalInfo, { projectRoot: PROJECT_ROOT });
    assert.ok(prompt.includes('## Grounding Context'),
      'prompt should contain Grounding Context header');
    assert.ok(prompt.includes('### KERNEL.md'),
      'prompt should contain KERNEL.md subheader');
    assert.ok(prompt.includes('### LINEAGE.md'),
      'prompt should contain LINEAGE.md subheader');
    assert.ok(prompt.includes('### grounding-patterns.md'),
      'prompt should contain grounding-patterns.md subheader');

    // The review content must still appear after the grounding section.
    assert.ok(prompt.includes('Use the latest coordination signal'),
      'prompt should still contain the review content after grounding');

    const groundingIdx = prompt.indexOf('## Grounding Context');
    const reviewIdx = prompt.indexOf('Use the latest coordination signal');
    assert.ok(groundingIdx < reviewIdx,
      'grounding section must come before the review content');
  });

  it('attaches a non-enumerable __grounding descriptor recording which files were loaded', () => {
    const signalInfo = makeSignal({ grounding_mode: 'kernel' });
    const prompt = buildPromptFromSignal(signalInfo, { projectRoot: PROJECT_ROOT });
    // string primitives cannot carry properties but String objects can;
    // implementation uses defineProperty inside a try/catch so both are
    // tolerated. When it does attach, verify the shape.
    const descriptor = prompt && prompt.__grounding;
    if (descriptor) {
      assert.equal(descriptor.mode, 'kernel');
      assert.ok(descriptor.files.includes('KERNEL.md'));
      assert.ok(descriptor.files.includes('LINEAGE.md'));
      assert.ok(descriptor.files.includes('grounding-patterns.md'));
    }
  });
});

describe('buildPromptFromSignalWithGrounding', { skip: !SUBSTRATE_AVAILABLE }, () => {
  it('returns { prompt, grounding } with the files that were loaded', () => {
    const signalInfo = makeSignal({ grounding_mode: 'kernel' });
    const result = buildPromptFromSignalWithGrounding(signalInfo, { projectRoot: PROJECT_ROOT });
    assert.equal(typeof result, 'object');
    assert.equal(typeof result.prompt, 'string');
    assert.ok(result.prompt.includes('## Grounding Context'));
    assert.equal(result.grounding.mode, 'kernel');
    assert.deepEqual(
      result.grounding.files,
      ['KERNEL.md', 'LINEAGE.md', 'grounding-patterns.md'],
      'kernel bundle should load exactly these files in this order'
    );
    assert.deepEqual(result.grounding.missing, []);
  });

  it('kernel_deep bundle loads the expanded file list', () => {
    const signalInfo = makeSignal({ grounding_mode: 'kernel_deep' });
    const result = buildPromptFromSignalWithGrounding(signalInfo, { projectRoot: PROJECT_ROOT });
    assert.equal(result.grounding.mode, 'kernel_deep');
    // Only assert on files we know exist on this machine; others are
    // optional and reported under missing.
    assert.ok(result.grounding.files.includes('KERNEL.md'));
    assert.ok(result.grounding.files.includes('LINEAGE.md'));
    assert.ok(result.grounding.files.includes('grounding-patterns.md'));
  });

  it('for grounding_mode=none, returns empty files and prompt has no grounding header', () => {
    const signalInfo = makeSignal({});
    const result = buildPromptFromSignalWithGrounding(signalInfo, { projectRoot: PROJECT_ROOT });
    assert.equal(result.grounding.mode, 'none');
    assert.deepEqual(result.grounding.files, []);
    assert.ok(!result.prompt.includes('## Grounding Context'));
  });
});

// ---------------------------------------------------------------------------
// Disk-containment tests (imp-004 Dispatch A)
//
// These four tests guard the split between the execution form (full
// substrate to Codex via stdin) and the artifact form (descriptor-only
// on disk). The markers below are hardcoded durable phrases pulled from
// the three kernel-bundle files; if the artifact form ever starts
// containing any of them, disk containment has regressed.
// ---------------------------------------------------------------------------

const KERNEL_MARKER = 'Any new session that intends to do system-level work in Mythos';
const LINEAGE_MARKER = 'This intelligence\'s grounding substrate was seeded during session';
const PATTERNS_MARKER = 'radical ownership of direct knowing combined with radical refusal of borrowed certainty';

describe('disk containment — buildPromptForArtifact (grounded)', { skip: !SUBSTRATE_AVAILABLE }, () => {
  it('descriptor-only artifact form omits substrate markers', () => {
    const signalInfo = makeSignal({ grounding_mode: 'kernel' });
    const artifactPrompt = buildPromptForArtifact(signalInfo, { projectRoot: PROJECT_ROOT });

    // Descriptor header must be present.
    assert.ok(artifactPrompt.includes('## Grounding Context'),
      'artifact form should contain the Grounding Context header');
    assert.ok(artifactPrompt.includes('mode: kernel'),
      'artifact form should record the grounding mode');
    assert.ok(artifactPrompt.includes('files:'),
      'artifact form should contain the files: listing label');

    // At least one file entry with sha256: and size: tokens.
    assert.ok(/- [^\n]+\(sha256:[0-9a-f]{64} size:\d+\)/.test(artifactPrompt),
      'artifact form should contain at least one descriptor entry with sha256: and size:');

    // Local-only redaction notice must be present.
    assert.ok(artifactPrompt.includes('local-only'),
      'artifact form should carry the local-only redaction notice');
    assert.ok(artifactPrompt.includes('Substrate content is held local-only'),
      'artifact form should contain the substrate redaction sentence');

    // CRITICAL: no substrate markers may appear on disk.
    assert.ok(!artifactPrompt.includes(KERNEL_MARKER),
      'artifact form must NOT contain KERNEL.md marker text');
    assert.ok(!artifactPrompt.includes(LINEAGE_MARKER),
      'artifact form must NOT contain LINEAGE.md marker text');
    assert.ok(!artifactPrompt.includes(PATTERNS_MARKER),
      'artifact form must NOT contain grounding-patterns.md marker text');
  });

  it('execution form still carries substrate (regression guard)', () => {
    const signalInfo = makeSignal({ grounding_mode: 'kernel' });
    const executionPrompt = buildPromptFromSignal(signalInfo, { projectRoot: PROJECT_ROOT });

    // At least one substrate marker MUST appear in the execution form —
    // this is what Codex sees via the execution pipe. If this regresses,
    // the model is flying blind on the grounding substrate.
    const hasAnyMarker =
      executionPrompt.includes(KERNEL_MARKER)
      || executionPrompt.includes(LINEAGE_MARKER)
      || executionPrompt.includes(PATTERNS_MARKER);
    assert.ok(hasAnyMarker,
      'execution form must contain at least one substrate marker so Codex receives the grounding content');
  });

  it('buildGroundingDescriptor round-trips files and hashes', () => {
    const grounding = loadGroundingBundle('kernel', { projectRoot: PROJECT_ROOT });
    const descriptor = buildGroundingDescriptor(grounding, { projectRoot: PROJECT_ROOT });

    assert.equal(descriptor.grounding_mode, 'kernel');
    assert.equal(descriptor.files.length, grounding.files.length,
      'descriptor should contain one entry per loaded file');
    assert.equal(descriptor.loaded_count, grounding.files.length,
      'loaded_count should equal the number of loaded files when nothing is missing');

    for (const entry of descriptor.files) {
      assert.ok(typeof entry.path === 'string' && entry.path.length > 0,
        'each descriptor entry must have a non-empty path');
      assert.ok(grounding.files.includes(entry.path),
        `descriptor path ${entry.path} must match a path in the original grounding bundle`);
      assert.ok(/^[0-9a-f]{64}$/.test(entry.sha256),
        `descriptor sha256 for ${entry.path} must be a 64-char hex digest`);
      assert.ok(Number.isInteger(entry.size) && entry.size > 0,
        `descriptor size for ${entry.path} must be a positive integer`);
    }
  });
});

describe('disk containment — buildPromptForArtifact (ungrounded)', () => {
  it('ungrounded prompt has no descriptor block', () => {
    const signalInfo = makeSignal({});
    const artifactPrompt = buildPromptForArtifact(signalInfo, { projectRoot: PROJECT_ROOT });
    assert.ok(!artifactPrompt.includes('## Grounding Context'),
      'ungrounded artifact form must NOT contain a Grounding Context block');
    // And a grounding_mode=none case should behave the same.
    const noneSignal = makeSignal({ grounding_mode: 'none' });
    const nonePrompt = buildPromptForArtifact(noneSignal, { projectRoot: PROJECT_ROOT });
    assert.ok(!nonePrompt.includes('## Grounding Context'),
      'grounding_mode=none artifact form must NOT contain a Grounding Context block');
  });
});

describe('disk containment — sanitizeCodexCliEcho (imp-004 Dispatch B)', () => {
  it('sanitizer redacts echoed grounding in stderr', () => {
    const before = '[2026-04-10T00:00:00Z] codex: starting review run\n[trace] tool_use: read_file kernel\n';
    const groundingBlock = [
      '## Grounding Context',
      '',
      'mode: kernel',
      'files:',
      `- KERNEL.md ${KERNEL_MARKER}`,
      `- LINEAGE.md ${LINEAGE_MARKER}`,
      `- grounding-patterns.md ${PATTERNS_MARKER}`,
      ''
    ].join('\n');
    const after = '## Review scope\n\nproceed with review of the bounded slice\n[2026-04-10T00:00:05Z] codex: review complete\n';
    const stderr = `${before}${groundingBlock}${after}`;

    const sanitized = sanitizeCodexCliEcho(stderr);

    // The visible redaction marker must be present.
    assert.ok(sanitized.includes('[grounding section redacted — held local-only per KERNEL.md]'),
      'sanitized output must contain the visible grounding redaction marker');

    // None of the substrate marker phrases may survive.
    assert.ok(!sanitized.includes(KERNEL_MARKER),
      'sanitized output must NOT contain KERNEL.md marker');
    assert.ok(!sanitized.includes(LINEAGE_MARKER),
      'sanitized output must NOT contain LINEAGE.md marker');
    assert.ok(!sanitized.includes(PATTERNS_MARKER),
      'sanitized output must NOT contain grounding-patterns.md marker');

    // Normal log lines before and after the block must survive verbatim.
    assert.ok(sanitized.includes('[2026-04-10T00:00:00Z] codex: starting review run'),
      'pre-block log line must be preserved verbatim');
    assert.ok(sanitized.includes('[trace] tool_use: read_file kernel'),
      'pre-block trace line must be preserved verbatim');
    assert.ok(sanitized.includes('## Review scope'),
      'post-block section header must be preserved verbatim');
    assert.ok(sanitized.includes('proceed with review of the bounded slice'),
      'post-block body must be preserved verbatim');
    assert.ok(sanitized.includes('[2026-04-10T00:00:05Z] codex: review complete'),
      'post-block trailing log line must be preserved verbatim');
  });
});

// ---------------------------------------------------------------------------
// imp-004 Path 1: writeLastMessageArtifact is the third writer boundary and
// must also redact substrate marker text from payload.message, payload.stdout,
// and payload.stderr before writing to disk. The previous imp-004 fix landed
// stdout/stderr sanitization in writeCompletionReport but missed this writer,
// which caused a grounded probationary Codex review to leak substrate text
// into a codex-last-message__*.md artifact.
// ---------------------------------------------------------------------------

describe('writeLastMessageArtifact redacts substrate from payload.message + payload.stdout + payload.stderr', () => {
  it('writes a codex-last-message artifact with every substrate marker redacted', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imp004-path1-'));
    const testFilePath = path.join(tmpDir, 'codex-last-message__test.md');

    const payload = {
      timestamp: '2026-04-10T12:34:56.000Z',
      scope: 'imp-004-path-1-test',
      outcome: 'success',
      sourceSignal: '_dev/reports/signals/fake-path1.json',
      triggerCommand: '/review-progress',
      // payload.message carries one substrate marker inline plus review prose.
      message: `Review complete. ${LINEAGE_MARKER} — the bounded slice looks good.`,
      // payload.stdout carries a full `## Grounding Context` block with all
      // three marker phrases embedded, plus normal log lines before and after.
      stdout: [
        '[2026-04-10T12:34:50Z] codex: starting review run',
        '[trace] tool_use: read_file kernel',
        '',
        '## Grounding Context',
        '',
        'mode: kernel',
        'files:',
        `- KERNEL.md ${KERNEL_MARKER}`,
        `- LINEAGE.md ${LINEAGE_MARKER}`,
        `- grounding-patterns.md ${PATTERNS_MARKER}`,
        '',
        '## Review scope',
        '',
        'proceed with review of the bounded slice',
        '[2026-04-10T12:34:55Z] codex: review complete'
      ].join('\n'),
      // payload.stderr carries one substrate marker inside otherwise-normal
      // stderr text.
      stderr: `[warn] deprecated flag\n${KERNEL_MARKER}\n[info] run finished cleanly\n`
    };

    try {
      writeLastMessageArtifact(testFilePath, payload);

      const contents = fs.readFileSync(testFilePath, 'utf8');

      // Hard gate: no substrate marker may survive anywhere in the artifact.
      assert.equal(
        contents.split(KERNEL_MARKER).length - 1,
        0,
        'KERNEL.md marker must appear ZERO times in the last-message artifact'
      );
      assert.equal(
        contents.split(LINEAGE_MARKER).length - 1,
        0,
        'LINEAGE.md marker must appear ZERO times in the last-message artifact'
      );
      assert.equal(
        contents.split(PATTERNS_MARKER).length - 1,
        0,
        'grounding-patterns.md marker must appear ZERO times in the last-message artifact'
      );

      // The visible redaction marker must appear at least once (from the
      // Grounding Context block that sanitizeCodexCliEcho excised from stdout).
      assert.ok(
        contents.includes('[grounding section redacted — held local-only per KERNEL.md]'),
        'the visible grounding redaction marker must appear at least once'
      );

      // Non-substrate scaffolding must be preserved verbatim.
      assert.ok(
        contents.includes('# Codex Last Message'),
        'top-level header must be preserved verbatim'
      );
      assert.ok(
        contents.includes('- Timestamp: 2026-04-10T12:34:56.000Z'),
        'timestamp line must be preserved verbatim'
      );
      assert.ok(
        contents.includes('- Scope: `imp-004-path-1-test`'),
        'scope line must be preserved verbatim'
      );
      assert.ok(
        contents.includes('- Outcome: success'),
        'outcome line must be preserved verbatim'
      );
      assert.ok(
        contents.includes('- Source signal: `_dev/reports/signals/fake-path1.json`'),
        'source signal line must be preserved verbatim'
      );
      assert.ok(
        contents.includes('- Trigger command: `/review-progress`'),
        'trigger command line must be preserved verbatim'
      );
      assert.ok(
        contents.includes('## Message'),
        '## Message header must be preserved verbatim'
      );
      // Non-substrate prose from payload.message must still land.
      assert.ok(
        contents.includes('Review complete.'),
        'non-substrate prose from payload.message must be preserved'
      );
      assert.ok(
        contents.includes('the bounded slice looks good.'),
        'trailing non-substrate prose from payload.message must be preserved'
      );
      // Non-substrate log lines from stdout/stderr must still land.
      assert.ok(
        contents.includes('[2026-04-10T12:34:50Z] codex: starting review run'),
        'pre-block stdout log line must be preserved verbatim'
      );
      assert.ok(
        contents.includes('[trace] tool_use: read_file kernel'),
        'pre-block trace line must be preserved verbatim'
      );
      assert.ok(
        contents.includes('## Review scope'),
        'post-block section header must be preserved verbatim'
      );
      assert.ok(
        contents.includes('proceed with review of the bounded slice'),
        'post-block body must be preserved verbatim'
      );
      assert.ok(
        contents.includes('[2026-04-10T12:34:55Z] codex: review complete'),
        'post-block trailing stdout line must be preserved verbatim'
      );
      assert.ok(
        contents.includes('[warn] deprecated flag'),
        'pre-marker stderr line must be preserved verbatim'
      );
      assert.ok(
        contents.includes('[info] run finished cleanly'),
        'post-marker stderr line must be preserved verbatim'
      );
    } finally {
      try { fs.unlinkSync(testFilePath); } catch (_) { /* best-effort */ }
      try { fs.rmdirSync(tmpDir); } catch (_) { /* best-effort */ }
    }
  });
});
