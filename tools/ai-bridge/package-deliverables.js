#!/usr/bin/env node

/**
 * package-deliverables.js
 *
 * Takes approved inline-styled HTML and produces three deliverables:
 *   1. CSS Packet — extracted inline styles as CSS rules with BEM-like classes
 *   2. Clean HTML — inline styles replaced with class references + <link> to CSS
 *   3. Fullpage Mockup — self-contained HTML document wrapping the clean HTML
 *
 * Style extraction uses regex `style="([^"]*)"` — this is a documented heuristic.
 * It works well for Gemini's inline-styled output but is NOT a full HTML parser.
 * Limitations:
 *   - Escaped quotes inside style values will break extraction
 *   - Deeply nested structures get flat sequential class names
 *   - Semantic tag replacement (div→article etc.) is NOT attempted in v1
 *
 * Usage:
 *   node tools/ai-bridge/package-deliverables.js \
 *     --html approved-element.html \
 *     --output-dir deliverables/ \
 *     --client CLIENTA \
 *     --page INVENTORY \
 *     --state SIMPLE \
 *     [--site-chrome path/to/chrome.json] \
 *     [--help]
 *
 * Exit codes:
 *   0 — success, all deliverable files written
 *   1 — error (missing input, write failure, etc.)
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(args) {
  const opts = {
    html: null,
    outputDir: null,
    client: null,
    page: null,
    state: null,
    siteChrome: null
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--html':
        opts.html = args[++i];
        break;
      case '--output-dir':
        opts.outputDir = args[++i];
        break;
      case '--client':
        opts.client = args[++i];
        break;
      case '--page':
        opts.page = args[++i];
        break;
      case '--state':
        opts.state = args[++i];
        break;
      case '--site-chrome':
        opts.siteChrome = args[++i];
        break;
      case '--help':
      case '-h':
        console.log(`Usage: node package-deliverables.js --html <path> --output-dir <path> --client <code> --page <type> --state <state> [options]

Package approved inline-styled HTML into three deliverables:
  1. CSS Packet  — inline styles extracted into CSS rules with BEM-like classes
  2. Clean HTML  — style="" replaced with class="" + <link> to CSS
  3. Fullpage    — self-contained HTML document wrapping clean HTML

Required:
  --html <path>            Path to the approved inline-styled HTML file
  --output-dir <path>      Deliverables output directory
  --client <code>          Client code for naming (e.g., CLIENTA)
  --page <type>            Page type for naming (e.g., INVENTORY)
  --state <state>          View state for naming (e.g., SIMPLE, DETAILED)

Options:
  --site-chrome <path>     Path to site chrome JSON for fullpage wrapping
  --help, -h               Show this help

Output files:
  {CLIENT}_MOCKUP_{PAGE}_{STATE}.css            CSS packet
  {CLIENT}_MOCKUP_{PAGE}_{STATE}.html           Clean HTML with class references
  {CLIENT}_MOCKUP_{PAGE}_{STATE}_FULLPAGE.html  Self-contained fullpage mockup

Heuristics (documented limitations):
  - Style extraction uses regex: style="([^"]*)"
  - Class names are sequential: .{client}-mockup (root), .{client}-mockup__tag-N (children)
  - Escaped quotes inside style values may break extraction
  - Semantic tag replacement (div->article) is NOT attempted in v1
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
// Style extraction
// ---------------------------------------------------------------------------

/**
 * Extract inline styles from HTML and produce:
 *   - A list of CSS rules (className + declarations)
 *   - Clean HTML with style="" replaced by class=""
 *
 * Heuristic: uses regex `style="([^"]*)"` to find inline styles.
 * Root element (first match) gets class `.{prefix}-mockup`.
 * Children get `.{prefix}-mockup__{tag}-{index}`.
 *
 * @param {string} html  - Inline-styled HTML string
 * @param {string} prefix - Client code lowercase for class prefix
 * @returns {{ rules: Array<{className: string, declarations: string, sourceTag: string, index: number}>, cleanHtml: string }}
 */
function extractStyles(html, prefix) {
  const rules = [];
  let childIndex = 0;
  let isFirst = true;

  // Regex to find elements with style attributes.
  // Captures: (1) everything before style= in the tag, (2) the style value, (3) rest of tag
  const styleRegex = /(<[a-zA-Z][a-zA-Z0-9]*\b[^>]*?)style="([^"]*)"([^>]*>)/g;

  const cleanHtml = html.replace(styleRegex, (match, before, styleValue, after) => {
    // Determine the tag name from the opening portion
    const tagMatch = before.match(/<([a-zA-Z][a-zA-Z0-9]*)/);
    const tagName = tagMatch ? tagMatch[1].toLowerCase() : 'element';

    let className;
    if (isFirst) {
      className = `${prefix}-mockup`;
      isFirst = false;
    } else {
      childIndex++;
      className = `${prefix}-mockup__${tagName}-${childIndex}`;
    }

    // Clean up the style declarations — normalize whitespace
    const declarations = styleValue.trim();

    rules.push({
      className,
      declarations,
      sourceTag: tagName,
      index: isFirst ? 0 : childIndex
    });

    // Check if there's already a class="" on this element
    const existingClassMatch = before.match(/class="([^"]*)"/);
    if (existingClassMatch) {
      // Append our class to existing classes
      const merged = `${existingClassMatch[1]} ${className}`;
      const newBefore = before.replace(/class="[^"]*"/, `class="${merged}"`);
      return `${newBefore}${after}`;
    } else {
      // Add class attribute where style was
      return `${before}class="${className}"${after}`;
    }
  });

  return { rules, cleanHtml };
}

// ---------------------------------------------------------------------------
// CSS Packet generation
// ---------------------------------------------------------------------------

/**
 * Generate CSS text from extracted rules.
 */
function generateCssPacket(rules, client, page, state) {
  const lines = [];

  lines.push(`/**`);
  lines.push(` * ${client}_MOCKUP_${page}_${state}.css`);
  lines.push(` *`);
  lines.push(` * Auto-generated CSS packet from inline-styled HTML.`);
  lines.push(` * Generated by: tools/ai-bridge/package-deliverables.js`);
  lines.push(` * Timestamp: ${new Date().toISOString()}`);
  lines.push(` *`);
  lines.push(` * Extraction method: regex heuristic (style="([^"]*)")`);
  lines.push(` * ${rules.length} rule(s) extracted.`);
  lines.push(` */`);
  lines.push('');

  for (const rule of rules) {
    lines.push(`/* Source: <${rule.sourceTag}> */`);
    lines.push(`.${rule.className} {`);

    // Split declarations by semicolons and format each on its own line
    const decls = rule.declarations
      .split(';')
      .map(d => d.trim())
      .filter(d => d.length > 0);

    for (const decl of decls) {
      // Ensure each declaration ends with semicolon
      lines.push(`  ${decl};`);
    }

    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Clean HTML generation
// ---------------------------------------------------------------------------

/**
 * Wrap clean HTML with a link to the CSS packet and paste-instructions comment.
 */
function generateCleanHtml(cleanHtml, cssFilename, client, page, state) {
  const lines = [];

  lines.push(`<!--`);
  lines.push(`  ${client}_MOCKUP_${page}_${state}.html`);
  lines.push(`  Auto-generated clean HTML with CSS class references.`);
  lines.push(`  Generated by: tools/ai-bridge/package-deliverables.js`);
  lines.push(``);
  lines.push(`  PASTE INSTRUCTIONS:`);
  lines.push(`  1. Include the CSS file: <link rel="stylesheet" href="${cssFilename}">`);
  lines.push(`  2. Copy the HTML below into your page where the element should appear.`);
  lines.push(`  3. The element requires the companion CSS packet to render correctly.`);
  lines.push(`-->`);
  lines.push(`<link rel="stylesheet" href="${cssFilename}">`);
  lines.push('');
  lines.push(cleanHtml);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Fullpage Mockup generation
// ---------------------------------------------------------------------------

/**
 * Build a self-contained fullpage HTML document.
 * If site chrome JSON is provided, includes header/nav/footer approximations.
 */
function generateFullpageMockup(cleanHtml, cssText, chromeData, client, page, state) {
  const title = `${client} Mockup — ${page} (${state})`;

  let headerHtml = '';
  let footerHtml = '';

  if (chromeData) {
    // Build approximate header from chrome data
    if (chromeData.header) {
      const h = chromeData.header;
      const bgColor = h.backgroundColor || h.background_color || '#333';
      const height = h.height || '60px';
      const color = h.color || h.textColor || h.text_color || '#fff';
      const text = h.text || h.siteName || h.site_name || client;
      headerHtml = `  <header style="background: ${bgColor}; height: ${height}; color: ${color}; display: flex; align-items: center; padding: 0 20px; font-family: sans-serif; font-size: 18px; font-weight: bold;">${text}</header>\n`;
    }

    // Build approximate nav from chrome data
    if (chromeData.nav) {
      const n = chromeData.nav;
      const bgColor = n.backgroundColor || n.background_color || '#444';
      const height = n.height || '40px';
      const color = n.color || n.textColor || n.text_color || '#ddd';
      const items = n.items || n.links || [];
      const navLinks = items.map(item => {
        const label = typeof item === 'string' ? item : (item.label || item.text || 'Link');
        return `<a href="#" style="color: ${color}; text-decoration: none; margin: 0 10px;">${label}</a>`;
      }).join('');
      headerHtml += `  <nav style="background: ${bgColor}; height: ${height}; display: flex; align-items: center; padding: 0 20px; font-family: sans-serif; font-size: 14px;">${navLinks}</nav>\n`;
    }

    // Build approximate footer from chrome data
    if (chromeData.footer) {
      const f = chromeData.footer;
      const bgColor = f.backgroundColor || f.background_color || '#333';
      const height = f.height || '80px';
      const color = f.color || f.textColor || f.text_color || '#999';
      const text = f.text || `\u00A9 ${new Date().getFullYear()} ${client}`;
      footerHtml = `  <footer style="background: ${bgColor}; min-height: ${height}; color: ${color}; display: flex; align-items: center; justify-content: center; padding: 20px; font-family: sans-serif; font-size: 14px;">${text}</footer>\n`;
    }
  }

  const lines = [];
  lines.push('<!DOCTYPE html>');
  lines.push(`<html lang="en">`);
  lines.push('<head>');
  lines.push(`  <meta charset="UTF-8">`);
  lines.push(`  <meta name="viewport" content="width=device-width, initial-scale=1.0">`);
  lines.push(`  <title>${title}</title>`);
  lines.push(`  <style>`);
  lines.push(`    /* Reset */`);
  lines.push(`    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }`);
  lines.push(`    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }`);
  lines.push('');
  lines.push(`    /* Extracted CSS */`);
  // Indent the CSS packet inside the style block
  const indentedCss = cssText
    .split('\n')
    .map(line => line.length > 0 ? `    ${line}` : '')
    .join('\n');
  lines.push(indentedCss);
  lines.push(`  </style>`);
  lines.push('</head>');
  lines.push('<body>');

  if (headerHtml) {
    lines.push(headerHtml);
  }

  lines.push('  <main>');
  // Indent the clean HTML inside main
  const indentedHtml = cleanHtml
    .split('\n')
    .map(line => line.length > 0 ? `    ${line}` : '')
    .join('\n');
  lines.push(indentedHtml);
  lines.push('  </main>');

  if (footerHtml) {
    lines.push(footerHtml);
  }

  lines.push('</body>');
  lines.push('</html>');
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));

  // Validate required args
  if (!opts.html) die('--html is required');
  if (!opts.outputDir) die('--output-dir is required');
  if (!opts.client) die('--client is required');
  if (!opts.page) die('--page is required');
  if (!opts.state) die('--state is required');

  // Read input HTML
  const htmlPath = path.resolve(opts.html);
  if (!fs.existsSync(htmlPath)) die(`HTML file not found: ${htmlPath}`);
  const inputHtml = fs.readFileSync(htmlPath, 'utf8');

  if (inputHtml.trim().length === 0) die('HTML file is empty');

  // Check for inline styles
  const styleCount = (inputHtml.match(/style="/g) || []).length;
  if (styleCount === 0) {
    console.log('WARNING: No inline style="" attributes found in input HTML.');
    console.log('         The CSS packet will be empty. This may be intentional if');
    console.log('         the HTML already uses classes.');
  }

  // Read site chrome if provided
  let chromeData = null;
  if (opts.siteChrome) {
    const chromePath = path.resolve(opts.siteChrome);
    if (!fs.existsSync(chromePath)) die(`Site chrome file not found: ${chromePath}`);
    try {
      chromeData = JSON.parse(fs.readFileSync(chromePath, 'utf8'));
    } catch {
      die(`Invalid JSON in site chrome file: ${chromePath}`);
    }
  }

  // Normalize naming
  const client = opts.client.toUpperCase();
  const page = opts.page.toUpperCase();
  const state = opts.state.toUpperCase();
  const prefix = opts.client.toLowerCase();
  const baseName = `${client}_MOCKUP_${page}_${state}`;

  // Ensure output directory exists
  const outputDir = path.resolve(opts.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`Input:    ${htmlPath} (${inputHtml.length} chars, ${styleCount} inline styles)`);
  console.log(`Output:   ${outputDir}`);
  console.log(`Naming:   ${baseName}`);
  console.log('');

  // -----------------------------------------------------------------------
  // Step 1: Extract styles
  // -----------------------------------------------------------------------
  console.log('Extracting inline styles...');
  const { rules, cleanHtml } = extractStyles(inputHtml, prefix);
  console.log(`  Extracted ${rules.length} CSS rule(s)`);

  // -----------------------------------------------------------------------
  // Step 2: Generate CSS Packet
  // -----------------------------------------------------------------------
  const cssFilename = `${baseName}.css`;
  const cssText = generateCssPacket(rules, client, page, state);
  const cssPath = path.join(outputDir, cssFilename);
  fs.writeFileSync(cssPath, cssText, 'utf8');
  console.log(`  -> ${cssFilename} (${cssText.length} chars)`);

  // -----------------------------------------------------------------------
  // Step 3: Generate Clean HTML
  // -----------------------------------------------------------------------
  const htmlFilename = `${baseName}.html`;
  const cleanHtmlDoc = generateCleanHtml(cleanHtml, cssFilename, client, page, state);
  const cleanHtmlPath = path.join(outputDir, htmlFilename);
  fs.writeFileSync(cleanHtmlPath, cleanHtmlDoc, 'utf8');
  console.log(`  -> ${htmlFilename} (${cleanHtmlDoc.length} chars)`);

  // -----------------------------------------------------------------------
  // Step 4: Generate Fullpage Mockup
  // -----------------------------------------------------------------------
  const fullpageFilename = `${baseName}_FULLPAGE.html`;
  const fullpageHtml = generateFullpageMockup(cleanHtml, cssText, chromeData, client, page, state);
  const fullpagePath = path.join(outputDir, fullpageFilename);
  fs.writeFileSync(fullpagePath, fullpageHtml, 'utf8');
  console.log(`  -> ${fullpageFilename} (${fullpageHtml.length} chars)`);

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log('');
  console.log('Deliverables packaged successfully:');
  console.log(`  CSS:      ${cssPath}`);
  console.log(`  HTML:     ${cleanHtmlPath}`);
  console.log(`  Fullpage: ${fullpagePath}`);

  if (chromeData) {
    console.log('  Site chrome: applied');
  } else {
    console.log('  Site chrome: not provided (basic document wrapper used)');
  }
}

main();
