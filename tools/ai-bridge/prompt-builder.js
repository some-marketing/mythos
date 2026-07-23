#!/usr/bin/env node

/**
 * prompt-builder.js
 *
 * Template engine that takes evidence directory + objective + constraints
 * and produces a formatted Trifecta prompt ready for gemini-browser.js.
 *
 * Usage:
 *   node tools/ai-bridge/prompt-builder.js \
 *     --evidence-dir _handoffs/001/ \
 *     --objective "Fix the yellow line below vehicle cards" \
 *     --output _handoffs/001/prompt.md
 *
 * Exit codes:
 *   0 — success, prompt file written
 *   1 — error (missing evidence, bad paths, etc.)
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(args) {
  const opts = {
    evidenceDir: null,
    objective: null,
    output: null,
    spec: null,
    constraints: [],
    targetId: null,
    targetClasses: null,
    brandTokens: null,
    dataFile: null,
    designLanguage: null,
    maxHtmlChars: 15000
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--evidence-dir':
        opts.evidenceDir = args[++i];
        break;
      case '--objective':
        opts.objective = args[++i];
        break;
      case '--output':
        opts.output = args[++i];
        break;
      case '--spec':
        opts.spec = args[++i];
        break;
      case '--constraints':
        // Collect all following non-flag args as constraints
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
      case '--data':
        opts.dataFile = args[++i];
        break;
      case '--design-language':
        opts.designLanguage = args[++i];
        break;
      case '--max-html':
        opts.maxHtmlChars = parseInt(args[++i], 10);
        break;
      case '--help':
      case '-h':
        console.log(`Usage: node prompt-builder.js --evidence-dir <path> --objective <text> --output <path> [options]

Build a Trifecta prompt from evidence directory for Gemini.

Required:
  --evidence-dir <path>    Path to evidence directory (from evidence-gather.js)
  --objective <text>       One-sentence description of what to fix/build
  --output <path>          Where to write the prompt file

Options:
  --spec <path>            Path to spec document to include as context
  --constraints <c1> <c2>  Additional constraints (space-separated)
  --target-id <id>         Element ID to preserve in output
  --target-classes <cls>   Element classes to preserve in output
  --brand-tokens <path>    Path to brand token JSON
  --help, -h               Show this help

Output files:
  <output>                 The Trifecta prompt (markdown)
  <output-dir>/prompt-meta.json  Metadata about the generated prompt
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

function readFileOrDie(filePath, label) {
  if (!fs.existsSync(filePath)) die(`${label} not found: ${filePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

function formatComputedStyles(stylesJson) {
  const lines = [];

  function formatNodeStyles(node, prefix) {
    const tag = node.tag || 'element';
    const id = node.id ? `#${node.id}` : '';
    const cls = (node.classes || []).length > 0 ? `.${node.classes.join('.')}` : '';
    const label = `${prefix}${tag}${id}${cls}`;
    const styles = node.styles || {};
    const entries = Object.entries(styles);
    if (entries.length > 0) {
      lines.push(`/* ${label} */`);
      for (const [prop, val] of entries) {
        lines.push(`${prop}: ${val};`);
      }
      lines.push('');
    }
  }

  if (stylesJson.root) {
    formatNodeStyles(stylesJson.root, '');
  }
  if (Array.isArray(stylesJson.children)) {
    for (let i = 0; i < stylesJson.children.length; i++) {
      formatNodeStyles(stylesJson.children[i], `  child[${i}] `);
    }
  }

  return lines.join('\n').trim();
}

function formatBrandTokens(tokensJson) {
  const lines = [];
  for (const [key, value] of Object.entries(tokensJson)) {
    if (typeof value === 'object' && value !== null) {
      for (const [subKey, subVal] of Object.entries(value)) {
        lines.push(`| --${key}-${subKey} | ${subVal} |`);
      }
    } else {
      lines.push(`| --${key} | ${value} |`);
    }
  }
  if (lines.length === 0) return null;
  return '| Token | Value |\n|-------|-------|\n' + lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.evidenceDir) die('--evidence-dir is required');
  if (!opts.objective) die('--objective is required');
  if (!opts.output) die('--output is required');

  const evidenceDir = path.resolve(opts.evidenceDir);

  // Read manifest
  const manifestPath = path.join(evidenceDir, 'evidence', 'manifest.json');
  const manifestStr = readFileOrDie(manifestPath, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(manifestStr);
  } catch {
    die(`Invalid JSON in manifest: ${manifestPath}`);
  }

  // Read element HTML
  const elementHtmlPath = path.join(evidenceDir, manifest.files.element_html);
  let elementHtml = readFileOrDie(elementHtmlPath, 'element.html');

  // Read computed styles
  const stylesPath = path.join(evidenceDir, manifest.files.computed_styles);
  const stylesStr = readFileOrDie(stylesPath, 'computed-styles.json');
  let stylesJson;
  try {
    stylesJson = JSON.parse(stylesStr);
  } catch {
    die(`Invalid JSON in computed styles: ${stylesPath}`);
  }
  const formattedStyles = formatComputedStyles(stylesJson);

  // Optional: spec
  let specSummary = null;
  if (opts.spec) {
    const specText = readFileOrDie(opts.spec, 'spec file');
    // Extract YAML frontmatter or first 500 chars
    const fmMatch = specText.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      specSummary = fmMatch[1].trim();
    } else {
      specSummary = specText.slice(0, 500).trim();
      if (specText.length > 500) specSummary += '\n...';
    }
  }

  // Optional: brand tokens
  let brandTokensTable = null;
  if (opts.brandTokens) {
    const tokensStr = readFileOrDie(opts.brandTokens, 'brand tokens');
    let tokensJson;
    try {
      tokensJson = JSON.parse(tokensStr);
    } catch {
      die(`Invalid JSON in brand tokens: ${path.resolve(opts.brandTokens)}`);
    }
    brandTokensTable = formatBrandTokens(tokensJson);
  }

  // Cap element HTML to avoid drowning out instructions
  if (elementHtml.length > opts.maxHtmlChars) {
    const originalLen = elementHtml.length;
    elementHtml = elementHtml.slice(0, opts.maxHtmlChars) + '\n<!-- ... truncated (' + originalLen + ' chars total) -->';
    console.log(`Element HTML truncated: ${originalLen} -> ${opts.maxHtmlChars} chars`);
  }

  // Auto-detect and read content data (vehicles, products, etc.)
  let contentDataJson = null;
  const dataPath = opts.dataFile
    ? path.resolve(opts.dataFile)
    : path.join(evidenceDir, 'evidence', 'vehicles.json');
  if (fs.existsSync(dataPath)) {
    try {
      contentDataJson = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      console.log(`Content data loaded: ${dataPath} (${Array.isArray(contentDataJson) ? contentDataJson.length + ' items' : 'object'})`);
    } catch (e) {
      console.warn(`WARNING: Could not parse content data: ${e.message}`);
    }
  }

  // Auto-detect and read design language
  let designLangJson = null;
  const dlPaths = [
    opts.designLanguage ? path.resolve(opts.designLanguage) : null,
    path.join(evidenceDir, 'design-language.json'),
    path.join(evidenceDir, '..', 'design-language.json')
  ].filter(Boolean);
  for (const dlPath of dlPaths) {
    if (fs.existsSync(dlPath)) {
      try {
        designLangJson = JSON.parse(fs.readFileSync(dlPath, 'utf8'));
        console.log(`Design language loaded: ${dlPath}`);
        break;
      } catch (e) {
        console.warn(`WARNING: Could not parse design language: ${e.message}`);
      }
    }
  }

  // Build constraints section
  let constraintsSection;
  if (opts.constraints.length > 0) {
    constraintsSection = opts.constraints.map(c => `- ${c}`).join('\n');
  } else {
    constraintsSection = 'None specified';
  }

  // Build target directives
  const targetLines = [];
  if (opts.targetId) {
    targetLines.push(`- Use this element ID: id="${opts.targetId}"`);
  }
  if (opts.targetClasses) {
    targetLines.push(`- Use these classes: class="${opts.targetClasses}"`);
  }

  // Assemble Trifecta prompt
  const sections = [];

  sections.push(`IMPORTANT: Your output MUST use inline style="" attributes on EVERY element. Do NOT use CSS class names or Tailwind. Example: <div style="display:flex; gap:16px;">

I need you to fix a UI element on a web page.

**Problem:**
${opts.objective}`);

  sections.push(`**Current HTML:**
\`\`\`html
${elementHtml}
\`\`\``);

  sections.push(`**Key Computed Styles:**
\`\`\`css
${formattedStyles}
\`\`\``);

  if (specSummary) {
    sections.push(`**Design Context:**
${specSummary}`);
  }

  if (brandTokensTable) {
    sections.push(`**Brand Tokens:**
${brandTokensTable}`);
  }

  // Design language section
  if (designLangJson) {
    const dl = designLangJson;
    const dlLines = [];
    if (dl.gemini_context) {
      dlLines.push(dl.gemini_context);
    }
    if (dl.personality && dl.personality.summary) {
      dlLines.push(`\nDesign personality: ${dl.personality.summary}`);
    }
    sections.push(`**Design Language:**\n${dlLines.join('\n')}`);
  }

  // Content data section
  if (contentDataJson) {
    sections.push(`**Real Content Data (use these exact values and image URLs):**
\`\`\`json
${JSON.stringify(contentDataJson, null, 2)}
\`\`\``);
  }

  sections.push(`**Stakeholder Constraints:**
${constraintsSection}`);

  sections.push('**Screenshot of current state is attached.**');

  const outputReqs = [
    '- Return a COMPLETE HTML element with ALL styles as inline `style=""` attributes',
    '- EVERY element MUST have a style="" attribute — e.g. `<div style="display:flex; padding:16px; border-radius:12px;">`',
    '- Do NOT use CSS classes, Tailwind, external stylesheets, or `<style>` blocks',
    '- WRONG: `<div class="flex p-4 rounded-lg">` — NO CLASSES ALLOWED',
    '- RIGHT: `<div style="display:flex; padding:16px; border-radius:12px;">` — INLINE STYLES ONLY',
    '- The element must be completely self-contained — I will paste it directly into the browser\'s DevTools Elements panel to preview the result',
    ...targetLines,
    '- Include all child elements with their inline styles',
    '- Preserve all text content, data attributes, and aria labels',
    '- Return ONLY the HTML code block. No explanation before or after the code block.'
  ];

  sections.push(`**OUTPUT REQUIREMENTS (CRITICAL):**
${outputReqs.join('\n')}`);

  const prompt = sections.join('\n\n') + '\n';

  // Write prompt
  const outputPath = path.resolve(opts.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, prompt, 'utf8');
  console.log(`Prompt written: ${outputPath} (${prompt.length} chars)`);

  // Write prompt-meta.json alongside
  const metaPath = path.join(path.dirname(outputPath), 'prompt-meta.json');
  const meta = {
    evidence_dir: evidenceDir,
    objective: opts.objective,
    constraints: opts.constraints,
    target_id: opts.targetId || null,
    target_classes: opts.targetClasses || null,
    spec_path: opts.spec ? path.resolve(opts.spec) : null,
    timestamp: new Date().toISOString(),
    image_paths: ['screenshots/element.png']
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  console.log(`Meta written:   ${metaPath}`);
}

main();
