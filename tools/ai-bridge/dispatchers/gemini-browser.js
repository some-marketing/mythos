'use strict';

/**
 * dispatchers/gemini-browser.js
 *
 * Dispatch contract wrapper for the existing Gemini browser pipeline.
 *
 * This module adapts the existing tools/ai-bridge scripts (gemini-browser.js,
 * evidence-gather.js, prompt-builder.js, validate-response.js, pipeline.js)
 * into the shared DispatchRequest/DispatchResult contract.
 *
 * It does NOT modify the existing scripts — it wraps them.
 * The existing CLI scripts continue to work exactly as before.
 *
 * Workflow:
 *   1. Accept a DispatchRequest with provider='gemini-browser'
 *   2. Map request fields to the existing script arguments
 *   3. Execute the pipeline (or individual steps) via child_process
 *   4. Read the outputs and package them into a DispatchResult
 *
 * Supported workflow_type: 'design' (visual refinement pipeline)
 *
 * Future: 'research' and 'analysis' types would route to different
 * providers — Gemini is not the right tool for those workflows.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createDispatchResult } = require('../lib/dispatch-contract');
const { parseResponse } = require('../lib/response-parser');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROVIDER = 'gemini-browser';
const SCRIPT_DIR = path.join(__dirname, '..');
const SUPPORTED_WORKFLOW_TYPES = ['design'];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a script path relative to tools/ai-bridge/.
 */
function scriptPath(name) {
  return path.join(SCRIPT_DIR, name);
}

/**
 * Run a Node script synchronously with the given arguments.
 * Returns { exitCode, stdout, stderr }.
 */
function runScript(scriptFile, args) {
  try {
    const stdout = execFileSync(process.execPath, [scriptFile, ...args], {
      encoding: 'utf8',
      env: process.env,
      timeout: 120000
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      exitCode: err.status || 1,
      stdout: err.stdout || '',
      stderr: err.stderr || err.message || ''
    };
  }
}

/**
 * Read a JSON file, returning null if it does not exist or fails to parse.
 */
function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Dispatch implementation
// ---------------------------------------------------------------------------

/**
 * Dispatch a request through the Gemini browser pipeline.
 *
 * For 'design' workflows, this runs the full pipeline:
 *   evidence-gather -> prompt-builder -> gemini-browser -> validate-response -> extract
 *
 * The request.context should contain:
 *   - url: Target page URL
 *   - selector: CSS selector for the target element
 *   - handoffDir: Working directory for all pipeline artifacts
 *
 * The request.options can contain:
 *   - images: Array of image paths
 *   - storage: Path to Playwright storage state
 *   - viewport: Viewport width
 *   - spec: Path to spec document
 *   - constraints: Array of constraint strings
 *   - targetId: Element ID to preserve
 *   - targetClasses: Element classes to preserve
 *   - brandTokens: Path to brand token JSON
 *   - skipTo: Resume from a specific step
 *   - maxRetries: Maximum retry attempts
 *   - promptFile: Pre-built prompt file (skip evidence-gather and prompt-builder)
 *
 * @param {object} request - A DispatchRequest
 * @returns {object} A DispatchResult
 */
async function dispatch(request) {
  const { workflow_type, context, prompt, options } = request;
  const startTime = Date.now();

  // Validate workflow type
  if (!SUPPORTED_WORKFLOW_TYPES.includes(workflow_type)) {
    return createDispatchResult({
      provider: PROVIDER,
      workflow_type,
      status: 'error',
      response: null,
      validation: null,
      artifacts: [],
      metadata: {
        error_message: `Gemini browser dispatcher only supports workflow types: ${SUPPORTED_WORKFLOW_TYPES.join(', ')}. Got: "${workflow_type}".`,
        timestamp: new Date().toISOString()
      }
    });
  }

  // --- Mode 1: Full pipeline (has url + selector + handoffDir) ---
  if (context.url && context.selector && context.handoffDir) {
    return dispatchPipeline(request, startTime);
  }

  // --- Mode 2: Direct prompt send (has promptFile or prompt text) ---
  if (options.promptFile || prompt) {
    return dispatchDirect(request, startTime);
  }

  return createDispatchResult({
    provider: PROVIDER,
    workflow_type,
    status: 'error',
    response: null,
    validation: null,
    artifacts: [],
    metadata: {
      error_message: 'Gemini dispatcher requires either (url + selector + handoffDir) for pipeline mode, or (promptFile or prompt) for direct mode.',
      timestamp: new Date().toISOString()
    }
  });
}

/**
 * Run the full pipeline: gather -> prompt -> send -> validate -> extract.
 */
async function dispatchPipeline(request, startTime) {
  const { workflow_type, context, options } = request;
  const handoffDir = path.resolve(context.handoffDir);

  // Build pipeline arguments
  const args = [
    '--url', context.url,
    '--selector', context.selector,
    '--objective', request.prompt,
    '--handoff-dir', handoffDir
  ];

  if (options.viewport) args.push('--viewport', String(options.viewport));
  if (options.storage) args.push('--storage', options.storage);
  if (options.spec) args.push('--spec', options.spec);
  if (options.targetId) args.push('--target-id', options.targetId);
  if (options.targetClasses) args.push('--target-classes', options.targetClasses);
  if (options.brandTokens) args.push('--brand-tokens', options.brandTokens);
  if (options.skipTo) args.push('--skip-to', options.skipTo);
  if (options.elementHtml) args.push('--element-html', options.elementHtml);
  if (options.maxRetries != null) args.push('--max-retries', String(options.maxRetries));

  if (Array.isArray(options.constraints)) {
    args.push('--constraints', ...options.constraints);
  }

  // Run the pipeline
  const result = runScript(scriptPath('pipeline.js'), args);
  const elapsed = Date.now() - startTime;

  // Read pipeline outputs
  const responsePath = path.join(handoffDir, 'gemini-response.json');
  const validationPath = path.join(handoffDir, 'validation.json');
  const proposedPath = path.join(handoffDir, 'proposed-element.html');

  const responseData = readJsonSafe(responsePath);
  const validationData = readJsonSafe(validationPath);
  const proposedHtml = fs.existsSync(proposedPath)
    ? fs.readFileSync(proposedPath, 'utf8')
    : null;

  // Collect artifact paths
  const artifacts = [];
  if (fs.existsSync(responsePath)) artifacts.push(responsePath);
  if (fs.existsSync(validationPath)) artifacts.push(validationPath);
  if (fs.existsSync(proposedPath)) artifacts.push(proposedPath);

  // Determine status
  let status;
  if (result.exitCode === 0 && proposedHtml) {
    status = validationData && validationData.passed ? 'success' : 'validation_fail';
  } else {
    status = 'error';
  }

  return createDispatchResult({
    provider: PROVIDER,
    workflow_type,
    status,
    response: responseData,
    validation: validationData,
    artifacts,
    metadata: {
      handoff_dir: handoffDir,
      proposed_html: proposedHtml,
      conversation_url: responseData?.conversation_url || null,
      elapsed_ms: elapsed,
      pipeline_exit_code: result.exitCode,
      timestamp: new Date().toISOString()
    }
  });
}

/**
 * Send a prompt directly to Gemini without the full pipeline.
 * Used when evidence has already been gathered and a prompt is ready.
 */
async function dispatchDirect(request, startTime) {
  const { workflow_type, prompt, options } = request;

  // Write prompt to a temp file if it's inline text
  let promptFile = options.promptFile;
  let tempPromptFile = null;

  if (!promptFile && prompt) {
    const os = require('os');
    tempPromptFile = path.join(os.tmpdir(), `dispatch-prompt-${Date.now()}.md`);
    fs.writeFileSync(tempPromptFile, prompt, 'utf8');
    promptFile = tempPromptFile;
  }

  if (!promptFile || !fs.existsSync(promptFile)) {
    return createDispatchResult({
      provider: PROVIDER,
      workflow_type,
      status: 'error',
      response: null,
      validation: null,
      artifacts: [],
      metadata: {
        error_message: `Prompt file not found: ${promptFile}`,
        timestamp: new Date().toISOString()
      }
    });
  }

  // Determine output path
  const outputPath = options.outputPath || path.join(
    path.dirname(promptFile),
    `gemini-response-${Date.now()}.json`
  );

  // Build gemini-browser.js arguments
  const args = [
    '--prompt', promptFile,
    '--output', outputPath
  ];

  if (options.images && options.images.length > 0) {
    args.push('--images', options.images.join(','));
  }
  if (options.storage) args.push('--storage', options.storage);
  if (options.timeout) args.push('--timeout', String(options.timeout));

  // Run gemini-browser.js
  const result = runScript(scriptPath('gemini-browser.js'), args);
  const elapsed = Date.now() - startTime;

  // Clean up temp file
  if (tempPromptFile && fs.existsSync(tempPromptFile)) {
    try { fs.unlinkSync(tempPromptFile); } catch { /* ignore */ }
  }

  // Read response
  const responseData = readJsonSafe(outputPath);

  // Collect artifacts
  const artifacts = [];
  if (fs.existsSync(outputPath)) artifacts.push(outputPath);

  const status = result.exitCode === 0 && responseData ? 'success' : 'error';

  return createDispatchResult({
    provider: PROVIDER,
    workflow_type,
    status,
    response: responseData,
    validation: null,
    artifacts,
    metadata: {
      prompt_file: promptFile,
      output_path: outputPath,
      conversation_url: responseData?.conversation_url || null,
      elapsed_ms: elapsed,
      exit_code: result.exitCode,
      timestamp: new Date().toISOString()
    }
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  provider: PROVIDER,
  implemented: true,
  supportedWorkflowTypes: SUPPORTED_WORKFLOW_TYPES,
  dispatch
};
