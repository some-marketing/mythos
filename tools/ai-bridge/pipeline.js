#!/usr/bin/env node

/**
 * pipeline.js
 *
 * Thin orchestrator for the Gemini design iteration workflow.
 * Chains: evidence-gather → prompt-builder → gemini-browser → validate-response → extract HTML.
 * Each step is a subprocess call. The pipeline is resumable via --skip-to.
 *
 * Usage:
 *   node tools/ai-bridge/pipeline.js \
 *     --url "https://example.com" \
 *     --selector "#target" \
 *     --objective "Fix the layout" \
 *     --handoff-dir _handoffs/001/ \
 *     [--element-html path/to/element.html] \
 *     [--spec path/to/spec.md] \
 *     [--constraints "Keep structure" "No red"] \
 *     [--target-id "myId"] \
 *     [--target-classes "cls1 cls2"] \
 *     [--brand-tokens path/to/tokens.json] \
 *     [--viewport 1440] \
 *     [--storage path/to/storage_state.json] \
 *     [--skip-to gather|prompt|send|validate|extract]
 *
 * Revision tracking:
 *   On first run, the pipeline saves the original element HTML and Gemini's
 *   output as revisions/original.html and revisions/revision-1.html.
 *   On subsequent runs (--skip-to send), the latest revision is automatically
 *   fed back to Gemini as the "current HTML", and the new output becomes
 *   revision-{N+1}.html.  proposed-element.html always holds the latest.
 *
 * Exit codes:
 *   0 — pipeline completed (or paused at approval gate)
 *   1 — a step failed
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseResponse } = require('./lib/response-parser');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const STEPS = ['gather', 'prompt', 'send', 'validate', 'extract'];

function parseArgs(args) {
  const opts = {
    url: null,
    selector: null,
    objective: null,
    handoffDir: null,
    elementHtml: null,
    spec: null,
    constraints: [],
    targetId: null,
    targetClasses: null,
    brandTokens: null,
    viewport: null,
    storage: null,
    skipTo: null,
    maxRetries: 0
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--url':
        opts.url = args[++i];
        break;
      case '--selector':
        opts.selector = args[++i];
        break;
      case '--objective':
        opts.objective = args[++i];
        break;
      case '--handoff-dir':
        opts.handoffDir = args[++i];
        break;
      case '--element-html':
        opts.elementHtml = args[++i];
        break;
      case '--spec':
        opts.spec = args[++i];
        break;
      case '--constraints':
        while (i + 1 < args.length && !args[i + 1].startsWith('--')) {
          opts.constraints.push(args[++i]);
        }
        break;
      case '--target-id':
        opts.targetId = args[++i];
        break;
      case '--target-classes':
        opts.targetClasses = args[++i];
        break;
      case '--brand-tokens':
        opts.brandTokens = args[++i];
        break;
      case '--viewport':
        opts.viewport = args[++i];
        break;
      case '--storage':
        opts.storage = args[++i];
        break;
      case '--skip-to':
        opts.skipTo = args[++i];
        break;
      case '--max-retries':
        opts.maxRetries = parseInt(args[++i], 10);
        if (isNaN(opts.maxRetries) || opts.maxRetries < 0) {
          die('--max-retries must be a non-negative integer');
        }
        break;
      case '--help':
      case '-h':
        console.log(`Usage: node pipeline.js --url <url> --selector <css> --objective <text> --handoff-dir <path> [options]

Orchestrate the Gemini design iteration pipeline.

Steps:
  1. gather    — Capture element evidence (screenshots, HTML, styles)
  2. prompt    — Build a Trifecta prompt from evidence + objective
  3. send      — Send prompt + screenshot to Gemini via browser
  4. validate  — Validate Gemini's response against inline-style rules
  5. extract   — Extract proposed HTML and pause for approval

Required:
  --url <url>              Page URL to gather evidence from
  --selector <css>         CSS selector for the target element
  --objective <text>       One-sentence description of what to fix/build
  --handoff-dir <path>     Working directory for all pipeline artifacts

Options:
  --element-html <path>    Pre-captured element HTML file (e.g. copied from DevTools).
                           Overrides evidence-gather's HTML but still captures screenshots
                           and computed styles from the live page. --selector is still
                           required for evidence-gather to locate the element.
  --spec <path>            Spec document to include as prompt context
  --constraints <c1> <c2>  Additional constraints (space-separated)
  --target-id <id>         Element ID to preserve in output
  --target-classes <cls>   Element classes to preserve in output
  --brand-tokens <path>    Path to brand token JSON
  --viewport <width>       Viewport width in px (default: 1440)
  --storage <path>         Playwright storage state for auth
  --skip-to <step>         Resume from step: gather, prompt, send, validate, extract
  --max-retries <N>        Maximum retry attempts when validation fails (default: 0).
                           0 = no retries (current behavior). When > 0, validation
                           failures trigger a correction prompt sent back to Gemini.
                           Each turn produces audit artifacts: correction-turn-N.md,
                           gemini-response-turn-N.json, validation-turn-N.json.
                           After N retries, the pipeline escalates to the user.
  --help, -h               Show this help

Revision tracking:
  The pipeline tracks iterative revisions in {handoff-dir}/revisions/:
    original.html      — The first element HTML (user paste or evidence-gather capture)
    revision-1.html    — Gemini's first output
    revision-2.html    — Gemini's second output (fed revision-1 as input)
    ...
  On subsequent runs with --skip-to send, the latest revision is automatically
  used as the "current HTML" in the prompt, so Gemini iterates on its own output.
  proposed-element.html always contains the latest revision.
`);
        process.exit(0);
    }
  }

  return opts;
}

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SCRIPT_DIR = __dirname;

function scriptPath(name) {
  return path.join(SCRIPT_DIR, name);
}

function stepIndex(name) {
  const idx = STEPS.indexOf(name);
  if (idx === -1) die(`Unknown step: ${name}. Valid steps: ${STEPS.join(', ')}`);
  return idx;
}

/**
 * Return the highest revision number found in the revisions directory,
 * or 0 if no revisions exist yet.
 */
function highestRevision(revisionsDir) {
  if (!fs.existsSync(revisionsDir)) return 0;
  let max = 0;
  for (const name of fs.readdirSync(revisionsDir)) {
    const m = name.match(/^revision-(\d+)\.html$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return max;
}

/**
 * Seed the revisions directory with original.html (the first element HTML).
 * No-op if original.html already exists.
 */
function seedOriginal(revisionsDir, elementHtmlPath) {
  fs.mkdirSync(revisionsDir, { recursive: true });
  const originalPath = path.join(revisionsDir, 'original.html');
  if (!fs.existsSync(originalPath)) {
    fs.copyFileSync(elementHtmlPath, originalPath);
    console.log(`  -> revisions/original.html (seeded from element.html)`);
  }
}

/**
 * Build a correction prompt from validation failures.
 * Used by the retry loop to ask Gemini to fix specific issues.
 *
 * @param {object} validationResult - Parsed validation.json
 * @param {string} originalObjective - The --objective text
 * @param {string} elementHtml - The original element HTML
 * @returns {string} Correction prompt text
 */
function buildCorrectionPrompt(validationResult, originalObjective, elementHtml) {
  const failedChecks = validationResult.checks.filter(c => c.status === 'fail' || c.status === 'warn');

  const failureLines = failedChecks
    .map(c => `- ${c.id}: ${c.message}`)
    .join('\n');

  return `Your previous response did not meet the output requirements. Please try again.

**Original objective:** ${originalObjective}

**What went wrong:**
${failureLines}

**The element HTML you should modify:**
\`\`\`html
${elementHtml}
\`\`\`

**OUTPUT REQUIREMENTS (you must follow these exactly):**
- Return a COMPLETE HTML element with ALL styles as inline style="" attributes
- Do NOT use CSS classes, external stylesheets, or <style> blocks
- Do NOT include <script> tags or event handlers
- Return ONLY the HTML element inside a \`\`\`html code block
- No explanation, no markdown commentary outside the code block`;
}

/**
 * Run the SEND step (gemini-browser.js) with a given prompt file and response output path.
 * Returns the exit status (throws on failure).
 */
function runSendStep(label, promptPath, imagePath, responsePath, storage) {
  const sendArgs = [
    '--prompt', promptPath,
    '--output', responsePath
  ];
  if (fs.existsSync(imagePath)) {
    sendArgs.push('--images', imagePath);
  }
  if (storage) sendArgs.push('--storage', storage);

  runStep(label, scriptPath('gemini-browser.js'), sendArgs);
}

/**
 * Run the VALIDATE step (validate-response.js) with given paths.
 * Returns the parsed validation result. Does NOT call process.exit on failure.
 */
function runValidateStep(label, responsePath, handoffDir, validationPath) {
  console.log(`\n=== ${label} ===\n`);
  try {
    execFileSync(process.execPath, [
      scriptPath('validate-response.js'),
      '--response', responsePath,
      '--evidence-dir', handoffDir,
      '--output', validationPath
    ], {
      stdio: 'inherit',
      env: process.env
    });
  } catch (err) {
    // validate-response.js exits 1 on validation failure — that's expected.
    // We only hard-fail if the script itself crashed (no output written).
    if (!fs.existsSync(validationPath)) {
      console.error(`\nStep failed: ${label} (no output produced)`);
      process.exit(1);
    }
  }

  // Read and return the validation result
  try {
    return JSON.parse(fs.readFileSync(validationPath, 'utf8'));
  } catch {
    die(`Invalid JSON in ${validationPath}`);
  }
}

function runStep(label, scriptFile, args) {
  console.log(`\n=== ${label} ===\n`);
  try {
    execFileSync(process.execPath, [scriptFile, ...args], {
      stdio: 'inherit',
      env: process.env
    });
  } catch (err) {
    console.error(`\nStep failed: ${label}`);
    if (err.status) {
      console.error(`Exit code: ${err.status}`);
    }
    console.error('Fix the issue and re-run with --skip-to to resume from this step.');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.handoffDir) die('--handoff-dir is required');
  if (!opts.objective) die('--objective is required');

  const handoffDir = path.resolve(opts.handoffDir);
  const startStep = opts.skipTo ? stepIndex(opts.skipTo) : 0;

  // Validate required args based on starting step
  if (startStep <= stepIndex('gather')) {
    if (!opts.url) die('--url is required (needed for gather step)');
    if (!opts.selector) die('--selector is required (needed for gather step)');
  }

  // Ensure handoff directory exists
  fs.mkdirSync(handoffDir, { recursive: true });

  console.log('=== GEMINI DESIGN PIPELINE ===');
  console.log(`Handoff dir: ${handoffDir}`);
  console.log(`Objective:   ${opts.objective}`);
  if (opts.skipTo) console.log(`Resuming from: ${opts.skipTo}`);
  console.log('');

  // -----------------------------------------------------------------------
  // Step 1: GATHER EVIDENCE
  // -----------------------------------------------------------------------
  if (startStep <= stepIndex('gather')) {
    const gatherArgs = [
      '--url', opts.url,
      '--selector', opts.selector,
      '--output-dir', handoffDir
    ];
    if (opts.viewport) gatherArgs.push('--viewport', opts.viewport);
    if (opts.storage) gatherArgs.push('--storage', opts.storage);

    runStep('Step 1/5: GATHER EVIDENCE', scriptPath('evidence-gather.js'), gatherArgs);

    // If --element-html was provided, overwrite evidence/element.html with the user's file
    if (opts.elementHtml) {
      const userHtmlPath = path.resolve(opts.elementHtml);
      if (!fs.existsSync(userHtmlPath)) {
        die(`--element-html file not found: ${userHtmlPath}`);
      }
      const targetPath = path.join(handoffDir, 'evidence', 'element.html');
      fs.copyFileSync(userHtmlPath, targetPath);
      console.log(`\n  -> evidence/element.html overwritten with ${userHtmlPath}`);
    }
  } else {
    // Verify gather outputs exist
    const manifestPath = path.join(handoffDir, 'evidence', 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      die(`Skipped gather but evidence/manifest.json not found in ${handoffDir}\nRun without --skip-to to gather evidence first.`);
    }
    console.log('\n--- Step 1/5: GATHER EVIDENCE (skipped — outputs exist) ---\n');
  }

  // -----------------------------------------------------------------------
  // Revision tracking: swap in the latest revision as element.html when
  // resuming from send (or prompt), so Gemini iterates on its own output.
  // -----------------------------------------------------------------------
  const revisionsDir = path.join(handoffDir, 'revisions');
  const elementHtmlPath = path.join(handoffDir, 'evidence', 'element.html');

  if (startStep >= stepIndex('prompt')) {
    const latest = highestRevision(revisionsDir);
    if (latest > 0) {
      const latestPath = path.join(revisionsDir, `revision-${latest}.html`);
      fs.copyFileSync(latestPath, elementHtmlPath);
      console.log(`Revision tracking: using revisions/revision-${latest}.html as element HTML for this run\n`);
    }
  }

  // -----------------------------------------------------------------------
  // Step 2: BUILD PROMPT
  // -----------------------------------------------------------------------
  if (startStep <= stepIndex('prompt')) {
    const promptOutput = path.join(handoffDir, 'prompt.md');
    const promptArgs = [
      '--evidence-dir', handoffDir,
      '--objective', opts.objective,
      '--output', promptOutput
    ];
    if (opts.spec) promptArgs.push('--spec', opts.spec);
    if (opts.constraints.length > 0) {
      promptArgs.push('--constraints', ...opts.constraints);
    }
    if (opts.targetId) promptArgs.push('--target-id', opts.targetId);
    if (opts.targetClasses) promptArgs.push('--target-classes', opts.targetClasses);
    if (opts.brandTokens) promptArgs.push('--brand-tokens', opts.brandTokens);

    runStep('Step 2/5: BUILD PROMPT', scriptPath('prompt-builder.js'), promptArgs);
  } else {
    const promptPath = path.join(handoffDir, 'prompt.md');
    if (!fs.existsSync(promptPath)) {
      die(`Skipped prompt but prompt.md not found in ${handoffDir}\nRun with --skip-to prompt to build the prompt first.`);
    }
    console.log('\n--- Step 2/5: BUILD PROMPT (skipped — outputs exist) ---\n');
  }

  // -----------------------------------------------------------------------
  // Step 3: SEND TO GEMINI
  // -----------------------------------------------------------------------
  if (startStep <= stepIndex('send')) {
    const promptPath = path.join(handoffDir, 'prompt.md');
    const imagePath = path.join(handoffDir, 'screenshots', 'element.png');
    const responsePath = path.join(handoffDir, 'gemini-response.json');

    const sendArgs = [
      '--prompt', promptPath,
      '--output', responsePath
    ];
    if (fs.existsSync(imagePath)) {
      sendArgs.push('--images', imagePath);
    }
    if (opts.storage) sendArgs.push('--storage', opts.storage);

    runStep('Step 3/5: SEND TO GEMINI', scriptPath('gemini-browser.js'), sendArgs);
  } else {
    const responsePath = path.join(handoffDir, 'gemini-response.json');
    if (!fs.existsSync(responsePath)) {
      die(`Skipped send but gemini-response.json not found in ${handoffDir}\nRun with --skip-to send to send the prompt first.`);
    }
    console.log('\n--- Step 3/5: SEND TO GEMINI (skipped — outputs exist) ---\n');
  }

  // -----------------------------------------------------------------------
  // Step 4: VALIDATE RESPONSE (with optional retry loop)
  // -----------------------------------------------------------------------

  // Track per-turn results for escalation reporting
  const turnResults = [];
  let finalResponsePath = path.join(handoffDir, 'gemini-response.json');
  let finalValidationPath = path.join(handoffDir, 'validation.json');

  if (startStep <= stepIndex('validate')) {
    const responsePath = path.join(handoffDir, 'gemini-response.json');
    const validationPath = path.join(handoffDir, 'validation.json');
    const imagePath = path.join(handoffDir, 'screenshots', 'element.png');

    // --- Turn 0: validate the initial response ---
    const turn0Result = runValidateStep(
      'Step 4/5: VALIDATE RESPONSE (Turn 0)',
      responsePath, handoffDir, validationPath
    );
    turnResults.push({
      turn: 0,
      passed: turn0Result.passed,
      error_count: turn0Result.error_count,
      warning_count: turn0Result.warning_count
    });

    // --- Retry loop ---
    if (!turn0Result.passed && opts.maxRetries > 0) {
      // Read original element HTML for correction prompts
      let originalElementHtml = '';
      const origHtmlPath = path.join(handoffDir, 'evidence', 'element.html');
      if (fs.existsSync(origHtmlPath)) {
        originalElementHtml = fs.readFileSync(origHtmlPath, 'utf8');
      }

      let lastValidation = turn0Result;
      let lastResponsePath = responsePath;

      for (let attempt = 1; attempt <= opts.maxRetries; attempt++) {
        console.log(`\n=== RETRY ${attempt}/${opts.maxRetries} ===\n`);

        // 1. Build correction prompt from validation failures
        const correctionText = buildCorrectionPrompt(
          lastValidation, opts.objective, originalElementHtml
        );
        const correctionPath = path.join(handoffDir, `correction-turn-${attempt}.md`);
        fs.writeFileSync(correctionPath, correctionText, 'utf8');
        console.log(`Correction prompt written: ${correctionPath}`);

        // 2. Re-run SEND with correction prompt
        const retryResponsePath = path.join(handoffDir, `gemini-response-turn-${attempt}.json`);
        runSendStep(
          `Step 4/5: RETRY SEND (Turn ${attempt})`,
          correctionPath, imagePath, retryResponsePath, opts.storage
        );

        // 3. Re-run VALIDATE
        const retryValidationPath = path.join(handoffDir, `validation-turn-${attempt}.json`);
        const retryValidation = runValidateStep(
          `Step 4/5: RETRY VALIDATE (Turn ${attempt})`,
          retryResponsePath, handoffDir, retryValidationPath
        );

        turnResults.push({
          turn: attempt,
          passed: retryValidation.passed,
          error_count: retryValidation.error_count,
          warning_count: retryValidation.warning_count
        });

        lastValidation = retryValidation;
        lastResponsePath = retryResponsePath;

        // 4. If passes, proceed to extract
        if (retryValidation.passed) {
          console.log(`\nRetry ${attempt} passed validation. Proceeding to extract.`);
          finalResponsePath = retryResponsePath;
          finalValidationPath = retryValidationPath;
          break;
        }

        // 5. If fails and no retries remain, escalate
        if (attempt === opts.maxRetries) {
          console.log('');
          console.log('=== RETRY LIMIT REACHED ===');
          console.log(`Validation failed after ${opts.maxRetries} retry attempt(s).`);
          console.log('');
          console.log('Turn results:');
          for (const t of turnResults) {
            const status = t.passed ? 'PASS' : 'FAIL';
            console.log(`  Turn ${t.turn}: ${status} — ${t.error_count} errors, ${t.warning_count} warnings`);
          }
          console.log('');
          console.log(`Review turn artifacts in: ${handoffDir}/`);
          console.log('Human decision required: adjust objective, modify element, or accept with issues.');
          process.exit(1);
        }

        // 6. Otherwise loop back (update state for next iteration)
        finalResponsePath = retryResponsePath;
        finalValidationPath = retryValidationPath;
      }
    } else if (!turn0Result.passed && opts.maxRetries === 0) {
      // Original behavior: validation failed, no retries, exit 1
      // (validate-response.js already printed the failures)
      console.error('\nValidation failed. Fix the issue and re-run with --skip-to to resume.');
      console.error('Or use --max-retries <N> to enable automatic retry with correction prompts.');
      process.exit(1);
    }
    // If turn0Result.passed === true, fall through to extract
  } else {
    const validationPath = path.join(handoffDir, 'validation.json');
    if (!fs.existsSync(validationPath)) {
      die(`Skipped validate but validation.json not found in ${handoffDir}\nRun with --skip-to validate to validate the response first.`);
    }
    console.log('\n--- Step 4/5: VALIDATE RESPONSE (skipped — outputs exist) ---\n');
  }

  // -----------------------------------------------------------------------
  // Step 5: EXTRACT PROPOSED HTML
  // -----------------------------------------------------------------------
  console.log('\n=== Step 5/5: EXTRACT PROPOSED HTML ===\n');

  if (!fs.existsSync(finalResponsePath)) {
    die(`Response JSON not found: ${finalResponsePath}`);
  }

  let responseData;
  try {
    responseData = JSON.parse(fs.readFileSync(finalResponsePath, 'utf8'));
  } catch {
    die(`Invalid JSON in ${finalResponsePath}`);
  }

  // Use response-parser to find the first HTML code block
  const responseText = responseData.response_text || '';
  const parsed = parseResponse(responseText);
  const htmlBlock = parsed.code_blocks.find(b =>
    b.language === 'html' || b.content.includes('style=') || b.content.includes('</')
  );

  let extractedHtml = null;

  if (htmlBlock) {
    extractedHtml = htmlBlock.content;
  } else {
    // Fall back to code_blocks from the response JSON itself (gemini-browser.js stores them)
    const fallbackBlocks = responseData.code_blocks || [];
    const fallbackHtml = fallbackBlocks.find(b =>
      b.language === 'html' || b.content.includes('style=') || b.content.includes('</')
    );
    if (!fallbackHtml) {
      die('No HTML code block found in Gemini response.\nRetry with: --skip-to send --objective "Return the HTML as a fenced code block"');
    }
    extractedHtml = fallbackHtml.content;
  }

  const proposedPath = path.join(handoffDir, 'proposed-element.html');
  fs.writeFileSync(proposedPath, extractedHtml, 'utf8');
  console.log(`Proposed HTML extracted (${extractedHtml.length} chars)`);
  console.log(`Written to: ${proposedPath}`);

  // -----------------------------------------------------------------------
  // Revision tracking: save original + revision-N
  // -----------------------------------------------------------------------
  seedOriginal(revisionsDir, elementHtmlPath);

  const prevHighest = highestRevision(revisionsDir);
  const nextRevision = prevHighest + 1;
  const revisionPath = path.join(revisionsDir, `revision-${nextRevision}.html`);
  fs.writeFileSync(revisionPath, extractedHtml, 'utf8');
  console.log(`  -> revisions/revision-${nextRevision}.html`);

  // Print approval gate
  const retryNote = turnResults.length > 1
    ? `\nRetry summary (${turnResults.length} turns):\n` +
      turnResults.map(t => `  Turn ${t.turn}: ${t.passed ? 'PASS' : 'FAIL'} — ${t.error_count} errors, ${t.warning_count} warnings`).join('\n') + '\n'
    : '';

  console.log(`
=== APPROVAL GATE ===
Response validated. Proposed HTML extracted to:
  ${proposedPath}
Revision saved: revisions/revision-${nextRevision}.html
${retryNote}
Paste this into DevTools to preview, then:
  - To iterate with Gemini (revision-${nextRevision} feeds back automatically):
    npm run ai:pipeline -- --handoff-dir ${handoffDir}/ --skip-to send --objective "Fix X"
  - To approve and re-run later stages:
    npm run ai:pipeline -- --handoff-dir ${handoffDir}/ --skip-to package
  - To abort: just don't run anything
`);
}

main();
