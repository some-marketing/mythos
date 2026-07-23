#!/usr/bin/env node
'use strict';

// OpenRouter bridge runner.
//
// Mirrors tools/signals/run-gemini-bridge.js in CLI surface and lifecycle,
// but invokes the OpenAI-compatible adapter (https://openrouter.ai/api/v1)
// for the model call instead of a local CLI binary. OpenRouter is not
// registered in actor-registry.js and has no local-CLI transport, so this
// standalone runner handles the openrouter lane.
//
// Harness contract: OpenRouter cannot execute tools or spawn subagents
// directly. It returns analysis/proposals only. If the model's response
// includes a "## Recommended Next Command" section, the first /slash-command
// found there is surfaced as recommended_next_command in the completion
// signal so the harness can run it under its own permission gate.
//
// Lifecycle contract (matches run-gemini-bridge.js):
//   1. Select the single live coordination signal targeting actor=openrouter
//      (or the --file override).
//   2. Build the prompt body from the signal's artifacts[0] prompt markdown.
//   3. Dry-run prints request details; else calls the adapter.
//   4. Write completion report + run result JSON.
//   5. Close the source signal into _dev/reports/signals/closed/.
//   6. Emit a ready-for-review (or blocked) follow-up signal.
//   7. Print summary text or JSON.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { parseArgs } = require('../workspace/lib/args');
const {
  sanitizeScope,
  validateSignalForDispatch
} = require('./lib/codex-bridge');
const {
  deriveFollowUpActor,
  deriveFollowUpCommand,
  buildFollowUpStepDetail
} = require('./lib/codex-auto');
const {
  closeSignalInfo
} = require('./lib/actor-auto');
const { scanLiveHandoffSignals } = require('./lib/pipeline-loop');
const {
  createHandoffSignal,
  validateHandoffSignal,
  isExactSlashCommand,
  isRecursiveFollowSignalCommand,
  isResolverCommand
} = require('../verify/lib/signal.cjs');
const {
  acquireLock,
  releaseLock
} = require('./lib/codex-auto');
const { createOpenAICompatibleAdapter } = require('../ai-bridge/adapters/openai-compatible');
const {
  checkJurisdictionDataBan,
  sensitivityClassesOf,
  REASONS: JURISDICTION_REASONS
} = require('../kernel/lib/jurisdiction-data-ban-gate');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const ACTOR_ID = 'openrouter';
const ACTOR_LABEL = 'OpenRouter';
const DEFAULT_MODEL = 'openrouter/auto';
const SYSTEM_PROMPT = [
  'You are being consulted through the Mythos harness bridge.',
  'You cannot execute tools or spawn subagents directly.',
  'To request tool or subagent work, recommend an exact Mythos slash command in your response',
  'under a `## Recommended Next Command` section.',
  'The harness will execute approved commands on your behalf.'
].join(' ');

function help() {
  console.log(`
Run the OpenRouter bridge for the latest live openrouter-targeted coordination signal.

Usage:
  node tools/signals/run-openrouter-bridge.js [options]

Options:
  --file <name>   Consume a specific live signal file from _dev/reports/signals/
  --model <name>  Model override (default: ${DEFAULT_MODEL})
  --dry-run       Print the request details without calling the API
                  (the cross-jurisdiction data-ban gate still runs pre-egress)
  --exception-file <path>  JSON operator exception for the jurisdiction gate
  --json          Print machine-readable output
  --help          Show this help
`.trim());
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function appendArchiveLog(projectRoot, entry) {
  const logDir = path.join(projectRoot, '_dev', 'logs');
  const logPath = path.join(logDir, 'archive.jsonl');
  ensureDir(logDir);
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
}

function formatStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function selectOpenRouterSignal(projectRoot, fileName) {
  const signalDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  const signals = scanLiveHandoffSignals(signalDir).filter((info) => {
    const target = String(info.signal.recommended_next_actor || '').trim().toLowerCase();
    return target === ACTOR_ID;
  });
  const candidateNames = signals.map((info) => info.name);

  if (signals.length === 0) {
    return {
      signal: null,
      error: 'no_live_signals',
      reason: `No live coordination signals targeting actor "${ACTOR_ID}".`,
      candidates: 0,
      candidateNames
    };
  }

  if (fileName) {
    const match = signals.find((info) => info.name === fileName);
    if (!match) {
      return {
        signal: null,
        error: 'file_not_found',
        reason: `Requested signal file "${fileName}" is not in the live openrouter-targeted set. Live candidates: ${candidateNames.join(', ') || '(none)'}`,
        candidates: signals.length,
        candidateNames
      };
    }
    return { signal: match, error: null, reason: null, candidates: signals.length, candidateNames };
  }

  if (signals.length === 1) {
    return { signal: signals[0], error: null, reason: null, candidates: 1, candidateNames };
  }

  return {
    signal: null,
    error: 'ambiguous',
    reason: `${signals.length} live openrouter-targeted signals match. Pass --file <signal.json> to disambiguate. Live candidates: ${candidateNames.join(', ')}`,
    candidates: signals.length,
    candidateNames
  };
}

function buildArtifacts(projectRoot, signalInfo, timestamp) {
  const safeScope = sanitizeScope(signalInfo.signal.scope || signalInfo.signal.signal_scope || 'general');
  const analysisDir = path.join(projectRoot, '_dev', 'reports', 'analysis');
  const signalDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  return {
    completionReportMdPath: path.join(analysisDir, `openrouter-bridge__${safeScope}__${timestamp}.md`),
    completionReportJsonPath: path.join(analysisDir, `openrouter-bridge__${safeScope}__${timestamp}.json`),
    completionSignalPath: path.join(signalDir, `ready-for-review__${timestamp}__${safeScope}.json`)
  };
}

function loadPromptBody(projectRoot, signalInfo) {
  const artifacts = Array.isArray(signalInfo.signal.artifacts) ? signalInfo.signal.artifacts : [];
  if (artifacts.length === 0) {
    return signalInfo.signal.next_prompt_stub
      || signalInfo.signal.recommended_next_command
      || '(no prompt body available)';
  }
  const promptRelPath = artifacts[0];
  const promptAbsPath = path.resolve(projectRoot, promptRelPath);
  if (!fs.existsSync(promptAbsPath)) {
    return `(prompt artifact not found: ${promptRelPath})`;
  }
  return fs.readFileSync(promptAbsPath, 'utf8');
}

const INLINE_MAX_BYTES = 32 * 1024;
const INLINE_SKIP_BYTES = 512 * 1024;
const BINARY_PROBE_BYTES = 4 * 1024;
const CONTENT_SCAN_BYTES = 8 * 1024;

// Denylist patterns applied to the relative path (case-insensitive, substring).
// A match causes inlining to be skipped (fail-closed).
const PATH_DENYLIST = [
  // .env files — allowed only if path ends with .example
  { test: (r) => /\.env/i.test(r) && !/\.example$/i.test(r) },
  { test: (r) => /credentials/i.test(r) },
  { test: (r) => /secrets?/i.test(r) },
  { test: (r) => /(^|[\\/.-])tokens?(\.[^/]+)?$/i.test(r) },
  { test: (r) => /password/i.test(r) },
  { test: (r) => /private[-_]key/i.test(r) },
  { test: (r) => /\.(pem|key)$/i.test(r) },
  { test: (r) => /keychain/i.test(r) },
  { test: (r) => /(^|[\\/])\.aws[\\/]/i.test(r) },
  { test: (r) => /(^|[\\/])\.ssh[\\/]/i.test(r) }
];

// Regexes applied to first 8 KB of file content (case-insensitive).
const CONTENT_SECRET_PATTERNS = [
  /-----BEGIN PRIVATE KEY-----/i,
  /-----BEGIN OPENSSH PRIVATE KEY-----/i,
  /-----BEGIN RSA PRIVATE KEY-----/i,
  /api[_-]?key\s*[:=]/i,
  /password\s*[:=]/i,
  /bearer\s+[A-Za-z0-9._\-]{20,}/i
];

function isDeniedPath(relativePath) {
  return PATH_DENYLIST.some((entry) => entry.test(relativePath));
}

function hasDeniedContent(buf) {
  const snippet = buf.slice(0, CONTENT_SCAN_BYTES).toString('utf8');
  return CONTENT_SECRET_PATTERNS.some((re) => re.test(snippet));
}

function inlineContextArtifacts(projectRoot, signalInfo, basePrompt) {
  const signal = signalInfo.signal || {};
  const allArtifacts = Array.isArray(signal.artifacts) ? signal.artifacts : [];
  const contextArtifacts = Array.isArray(signal.decision_context_artifacts)
    ? signal.decision_context_artifacts
    : allArtifacts.slice(1);

  if (contextArtifacts.length === 0) return basePrompt;

  const blocks = [];
  for (const relPath of contextArtifacts) {
    const absPath = path.resolve(projectRoot, relPath);
    const relative = path.relative(projectRoot, absPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      blocks.push(`\n## Inlined Context: ${relPath}\n\n[skipped: path is outside PROJECT_ROOT]\n`);
      continue;
    }
    if (isDeniedPath(relative)) {
      blocks.push(`\n## Inlined Context: ${relPath}\n\n[skipped: sensitive-path (denylist)]\n`);
      continue;
    }
    if (!fs.existsSync(absPath)) {
      blocks.push(`\n## Inlined Context: ${relPath}\n\n[skipped: file not found]\n`);
      continue;
    }
    let stat;
    try { stat = fs.statSync(absPath); } catch (e) {
      blocks.push(`\n## Inlined Context: ${relPath}\n\n[skipped: stat error]\n`);
      continue;
    }
    if (stat.size > INLINE_SKIP_BYTES) {
      blocks.push(`\n## Inlined Context: ${relPath}\n\n[skipped: too large]\n`);
      continue;
    }
    let fd;
    let probe;
    try {
      fd = fs.openSync(absPath, 'r');
      probe = Buffer.alloc(Math.min(BINARY_PROBE_BYTES, stat.size));
      fs.readSync(fd, probe, 0, probe.length, 0);
      fs.closeSync(fd);
    } catch (e) {
      try { if (fd != null) fs.closeSync(fd); } catch (_) {}
      blocks.push(`\n## Inlined Context: ${relPath}\n\n[skipped: read error]\n`);
      continue;
    }
    if (probe.indexOf(0) !== -1) {
      blocks.push(`\n## Inlined Context: ${relPath}\n\n[skipped: binary file]\n`);
      continue;
    }
    let contentScanBuf;
    try {
      const scanLen = Math.min(CONTENT_SCAN_BYTES, stat.size);
      contentScanBuf = Buffer.alloc(scanLen);
      const scanFd = fs.openSync(absPath, 'r');
      try {
        fs.readSync(scanFd, contentScanBuf, 0, scanLen, 0);
      } finally {
        fs.closeSync(scanFd);
      }
    } catch (e) {
      blocks.push(`\n## Inlined Context: ${relPath}\n\n[skipped: read error]\n`);
      continue;
    }
    if (hasDeniedContent(contentScanBuf)) {
      blocks.push(`\n## Inlined Context: ${relPath}\n\n[skipped: sensitive-content (denylist)]\n`);
      continue;
    }
    let content;
    try {
      const buf = fs.readFileSync(absPath);
      if (buf.length > INLINE_MAX_BYTES) {
        content = buf.slice(0, INLINE_MAX_BYTES).toString('utf8') +
          `\n[…truncated at 32KB of ${buf.length} total bytes…]`;
      } else {
        content = buf.toString('utf8');
      }
    } catch (e) {
      blocks.push(`\n## Inlined Context: ${relPath}\n\n[skipped: read error]\n`);
      continue;
    }
    blocks.push(`\n## Inlined Context: ${relPath}\n\n\`\`\`\n${content}\n\`\`\`\n`);
  }

  if (blocks.length === 0) return basePrompt;
  return basePrompt + '\n' + blocks.join('');
}

function extractRecommendedNextCommand(outputText) {
  const lines = String(outputText || '').split('\n');
  let inSection = false;
  let raw = null;
  for (const line of lines) {
    if (/^##\s+Recommended Next Command/.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection) {
      if (/^##\s/.test(line)) break;
      const trimmed = line.trim();
      if (trimmed.startsWith('/')) { raw = trimmed; break; }
    }
  }
  if (raw === null) {
    return { command: '/review-progress', rejected: null };
  }
  if (!isExactSlashCommand(raw)) {
    return { command: '/review-progress', rejected: { command: raw, reason: 'failed isExactSlashCommand' } };
  }
  if (isRecursiveFollowSignalCommand(raw)) {
    return { command: '/review-progress', rejected: { command: raw, reason: 'is a recursive follow-signal command' } };
  }
  if (isResolverCommand(raw)) {
    return { command: '/review-progress', rejected: { command: raw, reason: 'is a resolver command' } };
  }
  return { command: raw, rejected: null };
}

function buildBlockedMissingKeyResult(projectRoot, signalInfo, artifacts) {
  return {
    mode: 'blocked',
    reason: 'missing_api_key',
    success: false,
    actor: ACTOR_ID,
    signalName: signalInfo.name,
    completionSignalPath: artifacts.completionSignalPath,
    completionReportPath: artifacts.completionReportJsonPath,
    promptPath: null
  };
}

/**
 * Resolve the OpenRouter API key. The pi harness stores its working provider
 * credentials in ~/.pi/agent/auth.json (auth-storage); that is the source the
 * running session itself uses, so it is authoritative. The OPENROUTER_API_KEY
 * env var is a secondary fallback (it can go stale independently of auth.json).
 * The resolved key is never printed.
 */
function resolveOpenRouterApiKey() {
  // 1. auth.json (the working source pi uses)
  try {
    const os = require('os');
    const authPath = path.join(os.homedir(), '.pi', 'agent', 'auth.json');
    const raw = fs.readFileSync(authPath, 'utf8');
    const parsed = JSON.parse(raw);
    const key = parsed && parsed.openrouter && parsed.openrouter.key;
    if (typeof key === 'string' && key.startsWith('sk-or-')) return key;
  } catch { /* fall through to env */ }
  // 2. env fallback
  return process.env.OPENROUTER_API_KEY || '';
}

// ---------------------------------------------------------------------------
// Cross-jurisdiction data-ban resolution (S4).
//
// Static registry of model slugs that are KNOWN PRC-jurisdiction and therefore
// REQUIRE a well-formed dispatch-target descriptor before any egress. This map
// lives in-code (NOT derived from the descriptor files) on purpose: if the
// descriptor for a known-PRC slug is MISSING or GARBLED, resolution returns a
// label-less sentinel that the jurisdiction gate treats as PRC and BLOCKS
// (fail-closed), instead of silently degrading to a non-PRC allow.
// ---------------------------------------------------------------------------
const PRC_JURISDICTION_MODEL_DESCRIPTORS = Object.freeze({
  'z-ai/glm-5.2': 'glm-5.2-hosted.json'
});

/**
 * Resolve the dispatch-target descriptor for the model about to be called.
 *   - Known PRC slug => load its descriptor; missing/garbled => fail-closed
 *     sentinel (no `labels` => gate treats as PRC and blocks).
 *   - Any other slug => a well-formed, non-PRC descriptor so a normal
 *     openrouter call passes through the gate UNCHANGED.
 * @returns {{descriptor:object, source:string, descriptorPath:(string|null)}}
 */
function resolveDispatchTarget(projectRoot, model) {
  const slug = String(model || '').trim().toLowerCase();
  const descriptorFile = PRC_JURISDICTION_MODEL_DESCRIPTORS[slug];
  if (!descriptorFile) {
    return {
      descriptor: { id: model || ACTOR_ID, provider: 'openrouter', labels: [] },
      source: 'non-prc-default',
      descriptorPath: null
    };
  }
  const descriptorPath = path.join(
    projectRoot, '_dev', 'config', 'dispatch-targets', descriptorFile
  );
  let raw;
  try {
    raw = fs.readFileSync(descriptorPath, 'utf8');
  } catch (err) {
    // Missing descriptor for a known-PRC slug => fail-closed sentinel.
    return {
      descriptor: { id: slug, provider: 'openrouter', load_error: 'missing-descriptor' },
      source: 'missing-descriptor',
      descriptorPath
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // Garbled descriptor for a known-PRC slug => fail-closed sentinel.
    return {
      descriptor: { id: slug, provider: 'openrouter', load_error: 'garbled-descriptor' },
      source: 'garbled-descriptor',
      descriptorPath
    };
  }
  return { descriptor: parsed, source: 'descriptor-file', descriptorPath };
}

/**
 * Persist the durable operator-exception receipt for an allowed-via-exception
 * cross-jurisdiction dispatch. The raw payload is NEVER persisted — only a
 * sha256 + byte length + source-signal reference (redaction contract).
 * `stamp` is caller-supplied (no Date.now()).
 * @returns {string} the receipt path written.
 */
function writeJurisdictionExceptionReceipt(projectRoot, params) {
  const { stamp, decision, descriptor, model, scope, promptBody, signalName } = params;
  const dir = path.join(projectRoot, '_dev', 'state', 'jurisdiction-exceptions');
  ensureDir(dir);
  const receiptPath = path.join(dir, `${stamp}.json`);
  const receipt = (decision && decision.exceptionReceipt) || {};
  const payloadStr = typeof promptBody === 'string' ? promptBody : JSON.stringify(promptBody);
  const record = {
    kind: 'jurisdiction-data-ban-exception-receipt',
    schema: 'JurisdictionExceptionReceipt/1.0',
    approval_source: receipt.approval_source || null,
    reason: receipt.reason || null,
    timestamp: receipt.timestamp || null,
    receipt_written_stamp: stamp,
    target: receipt.target || descriptor.id || null,
    provider: descriptor.provider || 'openrouter',
    model,
    jurisdiction: descriptor.jurisdiction || 'PRC',
    sensitivity_class: sensitivityClassesOf(decision ? decision.sensitivity : null),
    overrides_block_reason: receipt.overrides || null,
    granted_classes: receipt.granted_classes || null,
    migration_path: descriptor.migration_path || null,
    payload_reference: {
      redaction: 'raw payload NOT persisted; sha256 + byte length + source signal only',
      sha256: crypto.createHash('sha256').update(payloadStr).digest('hex'),
      byte_length: Buffer.byteLength(payloadStr),
      source_signal: signalName || null
    },
    scope
  };
  fs.writeFileSync(receiptPath, JSON.stringify(record, null, 2) + '\n');
  return receiptPath;
}

async function runOpenRouterForSignal(projectRoot, signalInfo, opts = {}) {
  const dispatchCheck = validateSignalForDispatch(signalInfo, projectRoot);
  if (!dispatchCheck.valid) {
    return {
      mode: 'skipped',
      reason: 'invalid_signal',
      actor: ACTOR_ID,
      errors: dispatchCheck.errors,
      signalName: signalInfo.name,
      signalPath: signalInfo.filePath
    };
  }

  const apiKey = resolveOpenRouterApiKey();
  const timestamp = opts.timestamp || formatStamp();
  const model = opts.model || DEFAULT_MODEL;
  const basePrompt = loadPromptBody(projectRoot, signalInfo);
  const artifacts = buildArtifacts(projectRoot, signalInfo, timestamp);
  const scope = signalInfo.signal.scope || signalInfo.signal.signal_scope || 'general';

  // Build the FULL outbound payload (base prompt + inlined decision context) up
  // front so the jurisdiction gate inspects exactly what the endpoint would
  // receive. inlineContextArtifacts is a pure read; it needs no lock.
  const promptBody = inlineContextArtifacts(projectRoot, signalInfo, basePrompt);

  // ------------------------------------------------------------------
  // MANDATORY pre-egress cross-jurisdiction DATA-BAN gate (S4). ALWAYS-ON.
  //
  // This runs BEFORE any payload can leave the process — before the
  // missing-key branch, before --dry-run, before the lock, before the adapter
  // call. The data-ban is a hard safety invariant, NOT a flagged feature: a
  // sensitive payload bound for a PRC-hosted endpoint is REFUSED here and never
  // reaches the wire, even under --dry-run. A missing/garbled descriptor for a
  // known-PRC model slug fails closed (blocks). Non-PRC targets are outside the
  // gate's remit and pass through UNCHANGED.
  // ------------------------------------------------------------------
  const targetResolution = resolveDispatchTarget(projectRoot, model);
  const banDecision = checkJurisdictionDataBan({
    target: targetResolution.descriptor,
    payload: { system_prompt: SYSTEM_PROMPT, user_prompt: promptBody },
    exception: opts.exception
  });

  if (!banDecision.allowed) {
    // REFUSE. No payload egresses. Caller exits non-zero with the block reason.
    return {
      mode: 'blocked',
      reason: 'jurisdiction_data_ban',
      success: false,
      actor: ACTOR_ID,
      model,
      signalName: signalInfo.name,
      banReason: banDecision.reason,
      prcJurisdiction: banDecision.prcJurisdiction,
      sensitivity: banDecision.sensitivity,
      descriptorSource: targetResolution.source,
      descriptorPath: targetResolution.descriptorPath
        ? path.relative(projectRoot, targetResolution.descriptorPath)
        : null
    };
  }

  // Allowed-via-exception => persist the durable receipt (S4 owns persistence;
  // S3 only validated the exception). This is the ONLY place the receipt lands.
  let exceptionReceiptPath = null;
  if (
    banDecision.reason === JURISDICTION_REASONS.EXCEPTION_APPLIED &&
    banDecision.exceptionReceipt
  ) {
    exceptionReceiptPath = writeJurisdictionExceptionReceipt(projectRoot, {
      stamp: timestamp,
      decision: banDecision,
      descriptor: targetResolution.descriptor,
      model,
      scope,
      promptBody,
      signalName: signalInfo.name
    });
  }

  if (!apiKey && !opts.dryRun) {
    const sourceRelPath = path.relative(projectRoot, signalInfo.filePath);
    const missingKeyReport = {
      actor: ACTOR_ID,
      signal_id: signalInfo.name,
      outcome: 'blocked',
      success: false,
      adapter_status: 'missing_key',
      summary: 'OPENROUTER_API_KEY not set',
      timestamp,
      recommended_next_command: '/normalize-signals'
    };
    ensureDir(path.dirname(artifacts.completionReportJsonPath));
    fs.writeFileSync(artifacts.completionReportJsonPath, JSON.stringify(missingKeyReport, null, 2) + '\n');
    const missingKeySignal = createHandoffSignal(
      ACTOR_ID,
      scope,
      'blocked',
      {
        artifacts: [
          path.relative(projectRoot, artifacts.completionReportJsonPath),
          ...(Array.isArray(signalInfo.signal.artifacts) ? signalInfo.signal.artifacts : [])
        ],
        validation: { ran: false, summary: 'OPENROUTER_API_KEY not set' },
        recommended_next_actor: 'operator',
        recommended_next_command: '/normalize-signals',
        next_step_detail: [
          'No OpenRouter key in ~/.pi/agent/auth.json or OPENROUTER_API_KEY. Store via tools/boot/keychain-store.sh or /login, then re-run the openrouter bridge.'
        ],
        blocked_by: ['OPENROUTER_API_KEY not set'],
        ready_for_clear: false,
        signal_scope: signalInfo.signal.signal_scope || '',
        workflow_scope: signalInfo.signal.workflow_scope || signalInfo.signal.signal_scope || '',
        workflow_kind: 'bridge',
        supersedes_signal: sourceRelPath,
        superseded_at: signalInfo.signal.timestamp || ''
      }
    );
    const missingKeyValidation = validateHandoffSignal(missingKeySignal, { projectRoot });
    if (!missingKeyValidation.valid) {
      throw new Error(`Blocked signal validation failed: ${missingKeyValidation.errors.join('; ')}`);
    }
    ensureDir(path.dirname(artifacts.completionSignalPath));
    fs.writeFileSync(artifacts.completionSignalPath, JSON.stringify(missingKeySignal, null, 2) + '\n');
    return buildBlockedMissingKeyResult(projectRoot, signalInfo, artifacts);
  }
  const sourceRelPath = path.relative(projectRoot, signalInfo.filePath);

  if (opts.dryRun) {
    return {
      mode: 'dry-run',
      actor: ACTOR_ID,
      model,
      promptLength: basePrompt.length,
      artifacts,
      signalName: signalInfo.name,
      exceptionReceiptPath: exceptionReceiptPath || null
    };
  }

  // Acquire lock before reading/closing the source signal
  if (!acquireLock(signalInfo.filePath)) {
    return {
      mode: 'skipped',
      reason: 'lock-acquire-failed',
      actor: ACTOR_ID,
      signalName: signalInfo.name,
      signalPath: signalInfo.filePath
    };
  }

  let runResult = null;
  try {
    // promptBody was already built (and cleared by the jurisdiction gate) above.
    // opts.adapter allows tests to inject a mock egress; production omits it.
    const adapter = opts.adapter || createOpenAICompatibleAdapter({
      baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      apiKey,
      endpointRef: 'OPENROUTER_BASE_URL'
    });

    const startedAt = Date.now();
    let adapterResult;
    try {
      adapterResult = await adapter.invoke({
        model_id: model,
        system_prompt: SYSTEM_PROMPT,
        user_prompt: promptBody,
        options: {
          temperature: 0.2,
          max_output_tokens: 4000,
          timeout_ms: 120000
        }
      });
    } catch (invokeError) {
      adapterResult = { status: 'invoke_error', output_text: '', error: invokeError };
    }
    const durationMs = Date.now() - startedAt;

    const success = adapterResult.status === 'success';
    const outputText = adapterResult.output_text || '';
    const outcome = success ? 'success' : 'api_failure';

    // F3: Validate recommended next command
    const nextCmdResult = success
      ? extractRecommendedNextCommand(outputText)
      : { command: '/review-progress', rejected: null };
    const recommendedNextCommand = nextCmdResult.command;
    const rejectedCommand = nextCmdResult.rejected;

    // Write completion report markdown
    const reportLines = [
      `# ${ACTOR_LABEL} Bridge Completion Report`,
      '',
      `- Timestamp: ${timestamp}`,
      `- Scope: \`${scope}\``,
      `- Model: ${model}`,
      `- Outcome: ${outcome}`,
      `- Duration ms: ${durationMs}`,
      `- Source signal: \`${sourceRelPath}\``,
      `- Trigger command: \`${signalInfo.signal.recommended_next_command || ''}\``,
      ''
    ];
    if (success) {
      reportLines.push('## Output', '', outputText || '(empty)', '');
    } else {
      reportLines.push('## Error', '', adapterResult.error ? adapterResult.error.message : adapterResult.status, '');
    }
    if (rejectedCommand) {
      reportLines.push(
        '## Rejected Proposed Command',
        '',
        `- Rejected command: \`${rejectedCommand.command}\``,
        `- Reason: ${rejectedCommand.reason}`,
        `- Fallback used: \`${recommendedNextCommand}\``,
        ''
      );
    }
    ensureDir(path.dirname(artifacts.completionReportMdPath));
    fs.writeFileSync(artifacts.completionReportMdPath, `${reportLines.join('\n')}\n`);

    // Write completion report JSON
    const reportJson = {
      actor: ACTOR_ID,
      signal_id: signalInfo.name,
      outcome,
      success,
      model,
      duration_ms: durationMs,
      timestamp,
      output_text: outputText,
      adapter_result: adapterResult,
      rejected_next_command: rejectedCommand || null
    };
    fs.writeFileSync(artifacts.completionReportJsonPath, JSON.stringify(reportJson, null, 2) + '\n');

    const followUpActor = deriveFollowUpActor(signalInfo);
    const reportRelPath = path.relative(projectRoot, artifacts.completionReportMdPath);
    const followUpCommand = success ? recommendedNextCommand : deriveFollowUpCommand(signalInfo, reportRelPath, false);
    const blockedBy = success ? [] : [adapterResult.error ? adapterResult.error.message : adapterResult.status];

    const completionSignal = createHandoffSignal(
      ACTOR_ID,
      scope,
      success ? 'ready-for-review' : 'blocked',
      {
        artifacts: [
          reportRelPath,
          path.relative(projectRoot, artifacts.completionReportJsonPath),
          ...(Array.isArray(signalInfo.signal.artifacts) ? signalInfo.signal.artifacts : [])
        ],
        validation: {
          ran: true,
          summary: `${ACTOR_ID} api outcome: ${outcome}` + (success ? '' : ` (${adapterResult.status})`)
        },
        recommended_next_actor: followUpActor,
        recommended_next_command: followUpCommand,
        next_step_detail: buildFollowUpStepDetail(signalInfo, reportRelPath, success),
        blocked_by: blockedBy,
        ready_for_clear: false,
        signal_scope: signalInfo.signal.signal_scope || '',
        workflow_scope: signalInfo.signal.workflow_scope || signalInfo.signal.signal_scope || '',
        workflow_kind: 'bridge',
        supersedes_signal: sourceRelPath,
        superseded_at: signalInfo.signal.timestamp || ''
      }
    );

    const completionValidation = validateHandoffSignal(completionSignal, { projectRoot });
    if (!completionValidation.valid) {
      console.error(`Completion signal validation failed: ${completionValidation.errors.join('; ')}`);
      process.exit(1);
    }

    const closedSourcePath = closeSignalInfo(
      projectRoot,
      signalInfo,
      'signals:run:openrouter',
      'openrouter_bridge_run_consumed_signal'
    );

    ensureDir(path.dirname(artifacts.completionSignalPath));
    fs.writeFileSync(artifacts.completionSignalPath, JSON.stringify(completionSignal, null, 2) + '\n');

    appendArchiveLog(projectRoot, {
      ts: new Date().toISOString(),
      event: 'openrouter.bridge.run',
      actor: ACTOR_ID,
      scope,
      outcome,
      model,
      source_signal: sourceRelPath,
      completion_signal: path.relative(projectRoot, artifacts.completionSignalPath),
      duration_ms: durationMs
    });

    runResult = {
      mode: 'executed',
      actor: ACTOR_ID,
      outcome,
      success,
      model,
      durationMs,
      completionReportMdPath: artifacts.completionReportMdPath,
      completionReportJsonPath: artifacts.completionReportJsonPath,
      completionSignalPath: artifacts.completionSignalPath,
      closedSourcePath,
      recommendedNextCommand,
      rejectedNextCommand: rejectedCommand || null,
      exceptionReceiptPath: exceptionReceiptPath || null
    };
  } finally {
    releaseLock(signalInfo.filePath);
  }

  return runResult;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) {
    help();
    process.exit(0);
  }

  const selection = selectOpenRouterSignal(PROJECT_ROOT, args.file || '');
  if (!selection.signal) {
    if (Boolean(args.json)) {
      console.log(JSON.stringify({
        mode: 'blocked',
        error: selection.error,
        reason: selection.reason,
        candidates: selection.candidates,
        candidate_names: selection.candidateNames
      }, null, 2));
    } else {
      console.error(`Blocked: ${selection.reason}`);
      if (selection.error === 'ambiguous') {
        console.error('Pass --file <signal.json> to disambiguate.');
      }
    }
    process.exit(1);
  }
  const signalInfo = selection.signal;

  let exception = null;
  if (args.exception_file) {
    try {
      exception = JSON.parse(
        fs.readFileSync(path.resolve(PROJECT_ROOT, String(args.exception_file)), 'utf8')
      );
    } catch (e) {
      console.error(`ERROR: failed to read --exception-file: ${e.message}`);
      process.exit(1);
    }
  }

  const result = await runOpenRouterForSignal(PROJECT_ROOT, signalInfo, {
    dryRun: Boolean(args.dry_run),
    model: args.model || '',
    exception
  });

  if (Boolean(args.json)) {
    console.log(JSON.stringify({
      mode: result.mode,
      actor: ACTOR_ID,
      outcome: result.outcome || null,
      success: result.success,
      reason: result.reason || '',
      model: result.model || '',
      duration_ms: result.durationMs || 0,
      completion_report_path: (() => {
        const p = result.completionReportMdPath || result.completionReportPath || result.completionReportJsonPath;
        return p ? path.relative(PROJECT_ROOT, p) : '';
      })(),
      completion_signal_path: result.completionSignalPath ? path.relative(PROJECT_ROOT, result.completionSignalPath) : '',
      closed_source_path: result.closedSourcePath ? path.relative(PROJECT_ROOT, result.closedSourcePath) : '',
      recommended_next_command: result.recommendedNextCommand || '',
      rejected_next_command: result.rejectedNextCommand || null,
      ban_reason: result.banReason || null,
      prc_jurisdiction: result.prcJurisdiction || false
    }, null, 2));
    if (result.success === false) process.exit(1);
    return;
  }

  if (result.mode === 'blocked' && result.reason === 'jurisdiction_data_ban') {
    console.error(
      'REFUSED: cross-jurisdiction DATA-BAN gate blocked this dispatch.\n' +
      `Reason: ${result.banReason}\n` +
      `Target model: ${result.model} (PRC-jurisdiction: ${result.prcJurisdiction})\n` +
      `Descriptor source: ${result.descriptorSource}` +
      (result.descriptorPath ? ` (${result.descriptorPath})` : '') + '\n' +
      'No payload was sent to the endpoint. The data-ban is a safety invariant ' +
      'and cannot be bypassed without a valid operator exception.'
    );
    process.exit(1);
  }

  if (result.mode === 'dry-run') {
    console.log(`Dry run for signal: ${signalInfo.name}`);
    console.log(`Actor: ${ACTOR_ID}`);
    console.log(`Model: ${result.model}`);
    console.log(`Prompt length: ${result.promptLength} chars`);
    console.log(`Expected completion report: ${path.relative(PROJECT_ROOT, result.artifacts.completionReportMdPath)}`);
    console.log(`Expected completion signal: ${path.relative(PROJECT_ROOT, result.artifacts.completionSignalPath)}`);
    return;
  }

  if (result.mode === 'blocked' && result.reason === 'missing_api_key') {
    console.error(
      'ERROR: OPENROUTER_API_KEY is not set.\n' +
      'Store it via tools/boot/keychain-store.sh and export it before running this runner.'
    );
    console.error(`Blocked signal written: ${path.relative(PROJECT_ROOT, result.completionSignalPath)}`);
    process.exit(1);
  }

  if (result.mode === 'skipped') {
    console.log(`Skipped signal ${signalInfo.name}: ${result.reason}`);
    return;
  }

  console.log(`Consumed signal: ${signalInfo.name}`);
  console.log(`Actor: ${ACTOR_ID}`);
  console.log(`Model: ${result.model}`);
  console.log(`Outcome: ${result.outcome}`);
  console.log(`Completion report: ${path.relative(PROJECT_ROOT, result.completionReportMdPath)}`);
  console.log(`Completion signal: ${path.relative(PROJECT_ROOT, result.completionSignalPath)}`);
  console.log(`Closed source signal: ${path.relative(PROJECT_ROOT, result.closedSourcePath)}`);
  console.log(`Recommended next command: ${result.recommendedNextCommand}`);
  if (result.success === false) process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  ACTOR_ID,
  DEFAULT_MODEL,
  buildArtifacts,
  loadPromptBody,
  inlineContextArtifacts,
  extractRecommendedNextCommand,
  runOpenRouterForSignal,
  selectOpenRouterSignal,
  buildBlockedMissingKeyResult,
  resolveDispatchTarget,
  writeJurisdictionExceptionReceipt,
  PRC_JURISDICTION_MODEL_DESCRIPTORS
};
