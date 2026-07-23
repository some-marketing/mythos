#!/usr/bin/env node

/**
 * design-language-extract.js
 *
 * Analyze captured evidence (element.html + optional computed-styles.json)
 * and produce a structured design language document that captures the site's
 * visual PERSONALITY — not just raw CSS values.
 *
 * Primary analysis source: the HTML file (inline styles, class patterns,
 * structural semantics). Falls back to computed-styles.json when available.
 *
 * Usage:
 *   node tools/ai-bridge/design-language-extract.js \
 *     --evidence-dir _handoffs/001/evidence/ \
 *     --output design-language.json
 *
 * Exit codes:
 *   0 — success
 *   1 — error (missing files, parse failure)
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(args) {
  const opts = { evidenceDir: null, output: null };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--evidence-dir':
        opts.evidenceDir = args[++i];
        break;
      case '--output':
        opts.output = args[++i];
        break;
      case '--help':
      case '-h':
        console.log(`Usage: node design-language-extract.js --evidence-dir <path> --output <path>

Analyze captured evidence and produce a design language document.

Required:
  --evidence-dir <path>  Directory containing element.html (and optionally computed-styles.json)
  --output <path>        Where to write the design language JSON

The script works primarily from the HTML file, parsing inline styles, CSS
custom properties, class naming patterns, and structural semantics. When
computed-styles.json is present, it supplements the analysis.
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
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Extract all inline style="..." values from HTML.
 * Returns an array of { property, value } objects.
 */
function extractInlineStyles(html) {
  const results = [];
  // Match style="..." attributes — handles single and double quotes
  const styleAttrRe = /style=["']([^"']*)["']/gi;
  let m;
  while ((m = styleAttrRe.exec(html)) !== null) {
    const declarations = m[1];
    if (!declarations.trim()) continue;
    for (const decl of declarations.split(';')) {
      const trimmed = decl.trim();
      if (!trimmed) continue;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;
      const property = trimmed.slice(0, colonIdx).trim().toLowerCase();
      const value = trimmed.slice(colonIdx + 1).trim();
      if (property && value) {
        results.push({ property, value });
      }
    }
  }
  return results;
}

/**
 * Extract CSS custom properties (--variable: value) from inline styles.
 */
function extractCustomProperties(html) {
  const results = [];
  const styleAttrRe = /style=["']([^"']*)["']/gi;
  let m;
  while ((m = styleAttrRe.exec(html)) !== null) {
    const declarations = m[1];
    for (const decl of declarations.split(';')) {
      const trimmed = decl.trim();
      if (!trimmed) continue;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;
      const property = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();
      if (property.startsWith('--')) {
        results.push({ property, value });
      }
    }
  }
  return results;
}

/**
 * Extract all CSS class names from the HTML.
 */
function extractClassNames(html) {
  const classes = new Set();
  const classRe = /class=["']([^"']*)["']/gi;
  let m;
  while ((m = classRe.exec(html)) !== null) {
    for (const cls of m[1].split(/\s+/)) {
      if (cls) classes.add(cls);
    }
  }
  return [...classes];
}

/**
 * Parse a CSS color value into a normalized form.
 * Handles rgb(), rgba(), hex, and named colors.
 */
function normalizeColor(value) {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  // Skip transparent and similar non-colors
  if (v === 'transparent' || v === 'inherit' || v === 'initial' || v === 'currentcolor') return null;
  // Already normalized enough for grouping
  return v;
}

/**
 * Extract color values from a string. Handles rgb/rgba/hex/hsl.
 */
function extractColors(text) {
  const colors = [];
  // rgb/rgba
  const rgbRe = /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)/gi;
  let m;
  while ((m = rgbRe.exec(text)) !== null) {
    const c = normalizeColor(m[0]);
    if (c) colors.push(c);
  }
  // hex
  const hexRe = /#(?:[0-9a-fA-F]{3,4}){1,2}\b/g;
  while ((m = hexRe.exec(text)) !== null) {
    const c = normalizeColor(m[0]);
    if (c) colors.push(c);
  }
  // hsl/hsla
  const hslRe = /hsla?\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*(?:,\s*[\d.]+\s*)?\)/gi;
  while ((m = hslRe.exec(text)) !== null) {
    const c = normalizeColor(m[0]);
    if (c) colors.push(c);
  }
  return colors;
}

/**
 * Parse a CSS length value to px (approximate). Returns null if unparseable.
 */
function parseLengthToPx(value, baseFontSize = 16) {
  if (!value || typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (v === '0' || v === '0px') return 0;
  const pxMatch = v.match(/^([\d.]+)px$/);
  if (pxMatch) return parseFloat(pxMatch[1]);
  const remMatch = v.match(/^([\d.]+)rem$/);
  if (remMatch) return parseFloat(remMatch[1]) * baseFontSize;
  const emMatch = v.match(/^([\d.]+)em$/);
  if (emMatch) return parseFloat(emMatch[1]) * baseFontSize;
  const ptMatch = v.match(/^([\d.]+)pt$/);
  if (ptMatch) return parseFloat(ptMatch[1]) * (4 / 3);
  return null;
}

/**
 * Extract all numeric CSS length values from text (padding, margin, gap, etc.)
 */
function extractSpacingValues(text) {
  const values = [];
  // Match standalone length values like 24px, 1.5rem, 16px
  const lengthRe = /(?:^|[\s:,;])(\d+(?:\.\d+)?(?:px|rem|em|pt))\b/gi;
  let m;
  while ((m = lengthRe.exec(text)) !== null) {
    const px = parseLengthToPx(m[1]);
    if (px !== null && px > 0) values.push(px);
  }
  return values;
}

/**
 * Extract font-size values specifically.
 */
function extractFontSizes(inlineStyles, computedStyles) {
  const sizes = new Set();

  // From inline styles
  for (const { property, value } of inlineStyles) {
    if (property === 'font-size') {
      const px = parseLengthToPx(value);
      if (px !== null && px > 0) sizes.add(px);
    }
  }

  // From computed styles
  if (computedStyles) {
    const collectFromNode = (node) => {
      if (node.styles && node.styles['font-size']) {
        const px = parseLengthToPx(node.styles['font-size']);
        if (px !== null && px > 0) sizes.add(px);
      }
    };
    if (computedStyles.root) collectFromNode(computedStyles.root);
    if (computedStyles.children) {
      for (const child of computedStyles.children) collectFromNode(child);
    }
  }

  return [...sizes].sort((a, b) => a - b);
}

/**
 * Extract font-weight values.
 */
function extractFontWeights(inlineStyles, computedStyles) {
  const weights = {};

  const addWeight = (w) => {
    const numW = parseInt(w, 10);
    const key = isNaN(numW) ? w : String(numW);
    weights[key] = (weights[key] || 0) + 1;
  };

  for (const { property, value } of inlineStyles) {
    if (property === 'font-weight') addWeight(value);
  }

  if (computedStyles) {
    const collectFromNode = (node) => {
      if (node.styles && node.styles['font-weight']) {
        addWeight(node.styles['font-weight']);
      }
    };
    if (computedStyles.root) collectFromNode(computedStyles.root);
    if (computedStyles.children) {
      for (const child of computedStyles.children) collectFromNode(child);
    }
  }

  return weights;
}

/**
 * Extract font-family values.
 */
function extractFontFamilies(inlineStyles, computedStyles) {
  const families = new Set();

  const addFamily = (value) => {
    // Split comma-separated font stacks, take the primary
    for (const f of value.split(',')) {
      const cleaned = f.trim().replace(/["']/g, '');
      if (cleaned) families.add(cleaned);
    }
  };

  for (const { property, value } of inlineStyles) {
    if (property === 'font-family') addFamily(value);
  }

  if (computedStyles) {
    const collectFromNode = (node) => {
      if (node.styles && node.styles['font-family']) {
        addFamily(node.styles['font-family']);
      }
    };
    if (computedStyles.root) collectFromNode(computedStyles.root);
    if (computedStyles.children) {
      for (const child of computedStyles.children) collectFromNode(child);
    }
  }

  return [...families];
}

/**
 * Extract box-shadow values and group by depth.
 */
function extractShadows(inlineStyles, computedStyles) {
  const shadows = [];

  const addShadow = (value) => {
    if (!value || value === 'none') return;
    shadows.push(value);
  };

  for (const { property, value } of inlineStyles) {
    if (property === 'box-shadow') addShadow(value);
  }

  if (computedStyles) {
    const collectFromNode = (node) => {
      if (node.styles && node.styles['box-shadow']) {
        addShadow(node.styles['box-shadow']);
      }
    };
    if (computedStyles.root) collectFromNode(computedStyles.root);
    if (computedStyles.children) {
      for (const child of computedStyles.children) collectFromNode(child);
    }
  }

  // Group by depth: extract blur radius as proxy for depth
  const levels = [];
  const unique = [...new Set(shadows)];
  for (const s of unique) {
    // Parse "Xpx Ypx Bpx Spx color" pattern
    const parts = s.match(/([\d.]+)px/g);
    if (parts && parts.length >= 3) {
      const blur = parseFloat(parts[2]);
      let level = 'subtle';
      if (blur > 20) level = 'heavy';
      else if (blur > 10) level = 'medium';
      else if (blur > 4) level = 'light';
      levels.push({ value: s, blur, level });
    } else {
      levels.push({ value: s, blur: 0, level: 'unknown' });
    }
  }

  return levels;
}

/**
 * Extract border-radius values.
 */
function extractRadii(inlineStyles, computedStyles) {
  const radii = new Set();

  const addRadius = (value) => {
    if (!value || value === '0px') return;
    const px = parseLengthToPx(value);
    if (px !== null && px > 0) radii.add(px);
  };

  for (const { property, value } of inlineStyles) {
    if (property === 'border-radius') {
      // May have shorthand like "8px 8px 0 0"
      for (const part of value.split(/\s+/)) {
        addRadius(part);
      }
    }
  }

  if (computedStyles) {
    const collectFromNode = (node) => {
      if (node.styles && node.styles['border-radius']) {
        for (const part of node.styles['border-radius'].split(/\s+/)) {
          addRadius(part);
        }
      }
    };
    if (computedStyles.root) collectFromNode(computedStyles.root);
    if (computedStyles.children) {
      for (const child of computedStyles.children) collectFromNode(child);
    }
  }

  return [...radii].sort((a, b) => a - b);
}

/**
 * Extract transition/animation timing values.
 */
function extractTransitions(inlineStyles, computedStyles) {
  const durations = new Set();
  const easings = new Set();

  const parseTransition = (value) => {
    if (!value || value === 'none' || value === 'all 0s ease 0s') return;
    // Parse individual transitions separated by commas
    for (const t of value.split(',')) {
      const trimmed = t.trim();
      // Duration: look for time values
      const timeMatch = trimmed.match(/([\d.]+)(ms|s)\b/g);
      if (timeMatch) {
        for (const tm of timeMatch) {
          const val = parseFloat(tm);
          const unit = tm.replace(/[\d.]/g, '');
          const ms = unit === 's' ? val * 1000 : val;
          if (ms > 0) durations.add(ms);
        }
      }
      // Easing
      const easingMatch = trimmed.match(/\b(ease|ease-in|ease-out|ease-in-out|linear|cubic-bezier\([^)]+\))/i);
      if (easingMatch) easings.add(easingMatch[1].toLowerCase());
    }
  };

  for (const { property, value } of inlineStyles) {
    if (property === 'transition' || property === 'transition-duration' || property === 'transition-timing-function') {
      parseTransition(value);
    }
  }

  if (computedStyles) {
    const collectFromNode = (node) => {
      if (!node.styles) return;
      for (const prop of ['transition', 'transition-duration', 'transition-timing-function']) {
        if (node.styles[prop]) parseTransition(node.styles[prop]);
      }
    };
    if (computedStyles.root) collectFromNode(computedStyles.root);
    if (computedStyles.children) {
      for (const child of computedStyles.children) collectFromNode(child);
    }
  }

  return {
    durations: [...durations].sort((a, b) => a - b),
    easings: [...easings]
  };
}

// ---------------------------------------------------------------------------
// Spacing scale detection
// ---------------------------------------------------------------------------

/**
 * Analyze spacing values and detect a base unit and scale.
 */
function analyzeSpacingScale(allSpacingPx) {
  if (allSpacingPx.length === 0) return { base_unit: 'unknown', scale: [] };

  // Count occurrences
  const freq = {};
  for (const v of allSpacingPx) {
    const rounded = Math.round(v);
    freq[rounded] = (freq[rounded] || 0) + 1;
  }

  const unique = Object.keys(freq).map(Number).sort((a, b) => a - b);

  // Detect base unit: try 4px, 8px, and common bases
  const candidates = [4, 8, 5, 6, 10];
  let bestBase = 4;
  let bestScore = 0;

  for (const base of candidates) {
    let score = 0;
    for (const val of unique) {
      if (val % base === 0) score += freq[val];
    }
    if (score > bestScore) {
      bestScore = score;
      bestBase = base;
    }
  }

  return {
    base_unit: `${bestBase}px`,
    scale: unique.map(v => `${v}px`)
  };
}

// ---------------------------------------------------------------------------
// Typographic scale detection
// ---------------------------------------------------------------------------

/**
 * Detect modular ratio from a set of font sizes.
 */
function detectScaleRatio(sizes) {
  if (sizes.length < 2) return null;

  // Try common ratios
  const knownRatios = [
    { name: 'minor-second', value: 1.067 },
    { name: 'major-second', value: 1.125 },
    { name: 'minor-third', value: 1.2 },
    { name: 'major-third', value: 1.25 },
    { name: 'perfect-fourth', value: 1.333 },
    { name: 'augmented-fourth', value: 1.414 },
    { name: 'perfect-fifth', value: 1.5 },
    { name: 'golden-ratio', value: 1.618 }
  ];

  // Calculate actual ratios between consecutive sizes
  const ratios = [];
  for (let i = 1; i < sizes.length; i++) {
    if (sizes[i - 1] > 0) {
      ratios.push(sizes[i] / sizes[i - 1]);
    }
  }

  if (ratios.length === 0) return null;

  const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;

  // Find closest known ratio
  let closest = knownRatios[0];
  let closestDiff = Math.abs(avgRatio - closest.value);
  for (const r of knownRatios) {
    const diff = Math.abs(avgRatio - r.value);
    if (diff < closestDiff) {
      closest = r;
      closestDiff = diff;
    }
  }

  // Only report if reasonably close (within 15%)
  if (closestDiff / closest.value < 0.15) {
    return { name: closest.name, value: closest.value, actual_avg: Math.round(avgRatio * 1000) / 1000 };
  }

  return { name: 'custom', value: Math.round(avgRatio * 1000) / 1000, actual_avg: Math.round(avgRatio * 1000) / 1000 };
}

// ---------------------------------------------------------------------------
// Color analysis
// ---------------------------------------------------------------------------

/**
 * Convert rgb/rgba string to { r, g, b, a } object.
 */
function parseRgb(color) {
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (m) {
    return { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]), a: m[4] !== undefined ? parseFloat(m[4]) : 1 };
  }
  return null;
}

/**
 * Convert hex to { r, g, b, a }.
 */
function parseHex(color) {
  let hex = color.replace('#', '');
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  if (hex.length === 4) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  if (hex.length === 6) {
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: 1 };
  }
  if (hex.length === 8) {
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: parseInt(hex.slice(6, 8), 16) / 255 };
  }
  return null;
}

/**
 * Get perceived brightness (0-255) using relative luminance approximation.
 */
function brightness(c) {
  if (!c) return 128;
  return (c.r * 299 + c.g * 587 + c.b * 114) / 1000;
}

/**
 * Get saturation (0-1) from RGB.
 */
function saturation(c) {
  if (!c) return 0;
  const max = Math.max(c.r, c.g, c.b) / 255;
  const min = Math.min(c.r, c.g, c.b) / 255;
  if (max === 0) return 0;
  return (max - min) / max;
}

/**
 * Group colors and identify primary/secondary/accent.
 */
function analyzeColors(colorStrings) {
  if (colorStrings.length === 0) {
    return { palette: [], primary: null, secondary: null, accent: null };
  }

  // Deduplicate
  const unique = [...new Set(colorStrings)];

  // Count occurrences
  const freq = {};
  for (const c of colorStrings) {
    freq[c] = (freq[c] || 0) + 1;
  }

  // Parse all to RGB for analysis
  const parsed = [];
  for (const c of unique) {
    let rgb = parseRgb(c);
    if (!rgb) rgb = parseHex(c);
    if (rgb) {
      // Skip fully transparent
      if (rgb.a === 0) continue;
      parsed.push({ original: c, rgb, freq: freq[c] || 1 });
    }
  }

  // Sort by frequency
  parsed.sort((a, b) => b.freq - a.freq);

  // Classify: primary = most frequent non-neutral, secondary = next, accent = most saturated non-primary
  const neutralThreshold = 0.1;
  const nonNeutrals = parsed.filter(p => saturation(p.rgb) > neutralThreshold);
  const neutrals = parsed.filter(p => saturation(p.rgb) <= neutralThreshold);

  let primary = null;
  let secondary = null;
  let accent = null;

  if (nonNeutrals.length >= 1) primary = nonNeutrals[0].original;
  if (nonNeutrals.length >= 2) secondary = nonNeutrals[1].original;

  // Accent: highest saturation that is not the primary
  const bySaturation = [...nonNeutrals].sort((a, b) => saturation(b.rgb) - saturation(a.rgb));
  for (const s of bySaturation) {
    if (s.original !== primary) {
      accent = s.original;
      break;
    }
  }
  // If no accent found from non-neutrals, try primary itself
  if (!accent && primary) accent = primary;

  // If we have no non-neutrals, fall back to the most common overall
  if (!primary && parsed.length > 0) primary = parsed[0].original;
  if (!secondary && parsed.length > 1) secondary = parsed[1].original;

  return {
    palette: parsed.map(p => p.original),
    primary,
    secondary,
    accent
  };
}

// ---------------------------------------------------------------------------
// Personality interpretation
// ---------------------------------------------------------------------------

function interpretPersonality(tokens) {
  const { typography, spacing, shadows, transitions } = tokens;

  // --- Weight: bold vs delicate ---
  const weightNums = Object.keys(typography.weights).map(Number).filter(n => !isNaN(n));
  const weightFreqs = typography.weights;
  let totalWeightScore = 0;
  let totalWeightCount = 0;
  for (const [w, count] of Object.entries(weightFreqs)) {
    const num = parseInt(w, 10);
    if (!isNaN(num)) {
      totalWeightScore += num * count;
      totalWeightCount += count;
    }
  }
  const avgWeight = totalWeightCount > 0 ? totalWeightScore / totalWeightCount : 400;

  // Shadow depth also contributes to perceived weight
  const avgShadowBlur = shadows.levels.length > 0
    ? shadows.levels.reduce((s, l) => s + l.blur, 0) / shadows.levels.length
    : 0;

  let weight;
  if (avgWeight >= 600 || avgShadowBlur > 12) weight = 'bold';
  else if (avgWeight >= 450 || avgShadowBlur > 5) weight = 'medium';
  else weight = 'light';

  // --- Density: spacious vs dense ---
  const spacingValues = spacing.scale.map(s => parseFloat(s));
  const avgSpacing = spacingValues.length > 0
    ? spacingValues.reduce((a, b) => a + b, 0) / spacingValues.length
    : 16;

  let density;
  if (avgSpacing >= 24) density = 'spacious';
  else if (avgSpacing >= 12) density = 'balanced';
  else density = 'dense';

  // --- Speed: snappy vs smooth ---
  const avgDuration = transitions.durations.length > 0
    ? transitions.durations.reduce((a, b) => a + b, 0) / transitions.durations.length
    : 200;
  const hasEaseOut = transitions.easings.some(e => e.includes('ease-out') || e.includes('ease-in-out'));

  let speed;
  if (avgDuration <= 150) speed = 'snappy';
  else if (avgDuration <= 350 && !hasEaseOut) speed = 'moderate';
  else speed = 'smooth';

  // --- Confidence: assertive vs subtle ---
  // Based on contrast (weight distribution spread), color saturation, and shadow usage
  const weightSpread = weightNums.length > 0 ? Math.max(...weightNums) - Math.min(...weightNums) : 0;
  const hasBoldWeights = weightNums.some(w => w >= 700);
  const hasShadows = shadows.levels.length > 0;

  let confidence;
  if (hasBoldWeights && (weightSpread >= 300 || hasShadows)) confidence = 'assertive';
  else if (weightSpread >= 200 || hasShadows) confidence = 'neutral';
  else confidence = 'subtle';

  // --- Summary ---
  const summaryParts = [];

  // Typography description
  const familyCount = typography.families.length;
  if (familyCount > 0) {
    const primaryFont = typography.families[0];
    const isSerif = /serif/i.test(primaryFont) && !/sans/i.test(primaryFont);
    const isMono = /mono|courier|consolas/i.test(primaryFont);
    const fontDesc = isSerif ? 'traditional serif typography' : isMono ? 'technical monospace typography' : 'clean sans-serif typography';
    summaryParts.push(`The design uses ${fontDesc}`);
  } else {
    summaryParts.push('The design uses system typography');
  }

  // Weight and spacing
  summaryParts.push(`with ${weight} visual weight and ${density} content density`);

  // Motion
  if (transitions.durations.length > 0) {
    summaryParts.push(`${speed} transitions (avg ${Math.round(avgDuration)}ms)`);
  } else {
    summaryParts.push('minimal animation');
  }

  // Shadow/depth
  if (shadows.levels.length > 0) {
    const depthDesc = avgShadowBlur > 15 ? 'deep' : avgShadowBlur > 6 ? 'moderate' : 'subtle';
    summaryParts.push(`and ${depthDesc} shadow depth`);
  } else {
    summaryParts.push('and a flat, shadow-free aesthetic');
  }

  const summary = summaryParts.join(', ') + '.';

  return { weight, density, speed, confidence, summary };
}

/**
 * Build a Gemini-ready context paragraph from tokens and personality.
 */
function buildGeminiContext(tokens, personality) {
  const parts = [];

  // Typography
  if (tokens.typography.families.length > 0) {
    parts.push(`Use font families: ${tokens.typography.families.join(', ')}.`);
  }
  if (tokens.typography.sizes.length > 0) {
    parts.push(`Font size scale: ${tokens.typography.sizes.map(s => s + 'px').join(', ')}.`);
  }
  if (Object.keys(tokens.typography.weights).length > 0) {
    parts.push(`Font weights in use: ${Object.keys(tokens.typography.weights).join(', ')}.`);
  }

  // Colors
  if (tokens.colors.primary) {
    parts.push(`Primary color: ${tokens.colors.primary}.`);
  }
  if (tokens.colors.secondary) {
    parts.push(`Secondary color: ${tokens.colors.secondary}.`);
  }
  if (tokens.colors.accent) {
    parts.push(`Accent color: ${tokens.colors.accent}.`);
  }

  // Spacing
  parts.push(`Spacing base unit: ${tokens.spacing.base_unit}. Use spacing values from this scale: ${tokens.spacing.scale.join(', ')}.`);

  // Shadows
  if (tokens.shadows.levels.length > 0) {
    parts.push(`Box shadows: ${tokens.shadows.levels.map(l => l.value).join('; ')}.`);
  } else {
    parts.push('No box shadows — use a flat design approach.');
  }

  // Radii
  if (tokens.radii.scale.length > 0) {
    parts.push(`Border radii: ${tokens.radii.scale.map(r => r + 'px').join(', ')}.`);
  }

  // Transitions
  if (tokens.transitions.durations.length > 0) {
    parts.push(`Transitions: durations ${tokens.transitions.durations.map(d => d + 'ms').join(', ')}; easings: ${tokens.transitions.easings.join(', ') || 'ease'}.`);
  }

  // Personality summary
  parts.push(`Design personality: ${personality.summary}`);

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Embedded <style> block extraction
// ---------------------------------------------------------------------------

/**
 * Extract CSS declarations from embedded <style> blocks in the HTML.
 * Returns { declarations: [{property, value}], ruleTexts: [string] }
 */
function extractEmbeddedStyles(html) {
  const declarations = [];
  const ruleTexts = [];
  const styleBlockRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = styleBlockRe.exec(html)) !== null) {
    const cssText = m[1];
    ruleTexts.push(cssText);
    // Parse individual declarations from within rule blocks
    const declRe = /([a-z\-]+)\s*:\s*([^;{}]+)/gi;
    let d;
    while ((d = declRe.exec(cssText)) !== null) {
      declarations.push({ property: d[1].trim().toLowerCase(), value: d[2].trim() });
    }
  }
  return { declarations, ruleTexts };
}

// ---------------------------------------------------------------------------
// Structural / class-name analysis
// ---------------------------------------------------------------------------

/**
 * Analyze class naming conventions to infer design system patterns.
 * Returns insights about component structure, BEM usage, etc.
 */
function analyzeClassPatterns(classNames) {
  const patterns = {
    bem_blocks: new Set(),
    bem_elements: new Set(),
    bem_modifiers: new Set(),
    prefixes: {},
    component_count: 0,
    uses_bem: false,
    uses_utility: false
  };

  for (const cls of classNames) {
    // BEM detection: block__element--modifier
    const bemMatch = cls.match(/^([a-z][a-z0-9-]*)(?:__([a-z][a-z0-9-]*))?(?:--([a-z][a-z0-9-]*))?$/i);
    if (bemMatch) {
      if (bemMatch[1]) patterns.bem_blocks.add(bemMatch[1]);
      if (bemMatch[2]) patterns.bem_elements.add(bemMatch[1] + '__' + bemMatch[2]);
      if (bemMatch[3]) patterns.bem_modifiers.add(cls);
    }

    // Prefix detection (e.g., clienta-*, bde-*, noUi-*)
    const prefixMatch = cls.match(/^([a-z]+-)/i);
    if (prefixMatch) {
      const prefix = prefixMatch[1];
      patterns.prefixes[prefix] = (patterns.prefixes[prefix] || 0) + 1;
    }

    // Utility class detection (Tailwind-like or similar)
    if (/^(text-|bg-|p-|m-|flex|grid|w-|h-|rounded|shadow|border)/.test(cls)) {
      patterns.uses_utility = true;
    }
  }

  patterns.uses_bem = patterns.bem_elements.size > 0 || patterns.bem_modifiers.size > 0;
  patterns.component_count = patterns.bem_blocks.size;

  return {
    uses_bem: patterns.uses_bem,
    uses_utility: patterns.uses_utility,
    component_count: patterns.component_count,
    top_prefixes: Object.entries(patterns.prefixes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([prefix, count]) => ({ prefix, count })),
    bem_blocks: [...patterns.bem_blocks].slice(0, 20),
    modifier_count: patterns.bem_modifiers.size
  };
}

/**
 * Count HTML heading tags to infer typography hierarchy.
 */
function extractHeadingHierarchy(html) {
  const hierarchy = {};
  for (let level = 1; level <= 6; level++) {
    const re = new RegExp(`<h${level}[\\s>]`, 'gi');
    const matches = html.match(re);
    if (matches && matches.length > 0) {
      hierarchy[`h${level}`] = matches.length;
    }
  }
  return hierarchy;
}

/**
 * Count repeated structural patterns (cards, grid items, list items).
 */
function countRepeatedPatterns(html) {
  const patterns = {};
  // Common repeating component patterns
  const repeaters = [
    { name: 'cards', re: /class="[^"]*card[^"]*"/gi },
    { name: 'grid_items', re: /class="[^"]*grid[_-]?item[^"]*"/gi },
    { name: 'list_items', re: /<li[\s>]/gi },
    { name: 'articles', re: /<article[\s>]/gi },
    { name: 'buttons', re: /<button[\s>]/gi },
    { name: 'links', re: /<a[\s]/gi },
    { name: 'images', re: /<img[\s]/gi },
    { name: 'inputs', re: /<input[\s]/gi },
    { name: 'selects', re: /<select[\s]/gi },
    { name: 'sections', re: /<section[\s>]/gi }
  ];

  for (const { name, re } of repeaters) {
    const matches = html.match(re);
    if (matches && matches.length > 0) {
      patterns[name] = matches.length;
    }
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// Recursive computed-styles walking
// ---------------------------------------------------------------------------

/**
 * Walk a computed-styles tree recursively, collecting all node styles.
 * The evidence-gather.js captures root + children, but the tree may
 * have been extended by later tooling.
 */
function walkComputedNodes(computedStyles) {
  const nodes = [];
  if (!computedStyles) return nodes;

  const visit = (node) => {
    if (!node) return;
    nodes.push(node);
    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) visit(child);
    }
  };

  if (computedStyles.root) visit(computedStyles.root);
  // Also handle flat children array at top level
  if (computedStyles.children && Array.isArray(computedStyles.children)) {
    for (const child of computedStyles.children) visit(child);
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// Main analysis
// ---------------------------------------------------------------------------

function analyze(html, computedStyles) {
  // 1. Extract raw data from HTML
  const inlineStyles = extractInlineStyles(html);
  const customProps = extractCustomProperties(html);
  const classNames = extractClassNames(html);
  const embedded = extractEmbeddedStyles(html);

  // Merge embedded style declarations with inline styles for analysis
  const allStyleDeclarations = [...inlineStyles, ...embedded.declarations];

  // 2. Structural analysis
  const classPatterns = analyzeClassPatterns(classNames);
  const headingHierarchy = extractHeadingHierarchy(html);
  const repeatedPatterns = countRepeatedPatterns(html);

  // Flatten all computed-style nodes for uniform access
  const allComputedNodes = walkComputedNodes(computedStyles);

  // 3. Collect all colors from every source
  const allColorStrings = [];

  // Colors from inline + embedded styles
  for (const { property, value } of allStyleDeclarations) {
    if (/color|background|border-color|shadow/i.test(property)) {
      allColorStrings.push(...extractColors(value));
    }
  }

  // Colors from computed styles (recursive)
  for (const node of allComputedNodes) {
    if (!node.styles) continue;
    for (const [prop, val] of Object.entries(node.styles)) {
      if (/color|background|border/i.test(prop)) {
        allColorStrings.push(...extractColors(val));
      }
    }
  }

  // Colors from the full HTML (catches things in data attributes, etc.)
  allColorStrings.push(...extractColors(html));

  // 4. Typography
  const fontSizes = extractFontSizes(allStyleDeclarations, computedStyles);
  const fontWeights = extractFontWeights(allStyleDeclarations, computedStyles);
  const fontFamilies = extractFontFamilies(allStyleDeclarations, computedStyles);
  const scaleRatio = detectScaleRatio(fontSizes);

  // 5. Spacing
  const allSpacingProperties = ['padding', 'margin', 'gap', 'padding-top', 'padding-right',
    'padding-bottom', 'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left'];
  const spacingValues = [];

  for (const { property, value } of allStyleDeclarations) {
    if (allSpacingProperties.some(p => property.startsWith(p)) || property === 'gap') {
      spacingValues.push(...extractSpacingValues(value));
    }
  }

  // From custom properties that look like spacing
  for (const { property, value } of customProps) {
    if (/gap|space|pad|margin/i.test(property)) {
      spacingValues.push(...extractSpacingValues(value));
    }
    // Also collect generic custom property lengths
    const px = parseLengthToPx(value);
    if (px !== null && px > 0) spacingValues.push(px);
  }

  // From computed styles (recursive)
  for (const node of allComputedNodes) {
    if (!node.styles) continue;
    for (const prop of allSpacingProperties) {
      if (node.styles[prop]) {
        for (const part of node.styles[prop].split(/\s+/)) {
          const px = parseLengthToPx(part);
          if (px !== null && px > 0) spacingValues.push(px);
        }
      }
    }
    if (node.styles.gap) {
      for (const part of node.styles.gap.split(/\s+/)) {
        const px = parseLengthToPx(part);
        if (px !== null && px > 0) spacingValues.push(px);
      }
    }
  }

  // 6. Shadows, radii, transitions
  const shadows = extractShadows(allStyleDeclarations, computedStyles);
  const radii = extractRadii(allStyleDeclarations, computedStyles);
  const transitions = extractTransitions(allStyleDeclarations, computedStyles);

  // 7. Build tokens
  const spacingAnalysis = analyzeSpacingScale(spacingValues);
  const colorAnalysis = analyzeColors(allColorStrings);

  const tokens = {
    colors: colorAnalysis,
    typography: {
      families: fontFamilies,
      sizes: fontSizes,
      weights: fontWeights,
      scale_ratio: scaleRatio ? scaleRatio.value : null,
      scale_name: scaleRatio ? scaleRatio.name : null
    },
    spacing: spacingAnalysis,
    shadows: { levels: shadows },
    radii: { scale: radii },
    transitions
  };

  // 8. Interpret personality
  const personality = interpretPersonality(tokens);

  // 9. Build Gemini context
  const geminiContext = buildGeminiContext(tokens, personality);

  return {
    extracted: new Date().toISOString(),
    source: {
      html_chars: html.length,
      inline_styles_count: inlineStyles.length,
      embedded_style_declarations: embedded.declarations.length,
      custom_properties: customProps.map(p => ({ property: p.property, value: p.value })),
      class_count: classNames.length,
      computed_nodes: allComputedNodes.length,
      has_computed_styles: !!computedStyles
    },
    structure: {
      class_patterns: classPatterns,
      heading_hierarchy: headingHierarchy,
      repeated_patterns: repeatedPatterns
    },
    tokens,
    personality,
    gemini_context: geminiContext
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.evidenceDir) die('--evidence-dir is required');
  if (!opts.output) die('--output is required');

  const evidenceDir = path.resolve(opts.evidenceDir);

  // Load element.html (required)
  const htmlPath = path.join(evidenceDir, 'element.html');
  if (!fs.existsSync(htmlPath)) {
    die(`element.html not found in ${evidenceDir}`);
  }
  const html = fs.readFileSync(htmlPath, 'utf8');
  console.log(`Loaded: ${htmlPath} (${html.length} chars)`);

  // Load computed-styles.json (optional)
  let computedStyles = null;
  const stylesPath = path.join(evidenceDir, 'computed-styles.json');
  if (fs.existsSync(stylesPath)) {
    try {
      computedStyles = JSON.parse(fs.readFileSync(stylesPath, 'utf8'));
      console.log(`Loaded: ${stylesPath}`);
    } catch (err) {
      console.warn(`Warning: Could not parse ${stylesPath}: ${err.message}`);
    }
  } else {
    console.log(`No computed-styles.json found — analyzing HTML only.`);
  }

  // Run analysis
  console.log('\nAnalyzing design language...\n');
  const result = analyze(html, computedStyles);

  // Write output
  const outputPath = path.resolve(opts.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(`Design language written to: ${outputPath}`);

  // Print summary
  console.log('\n--- Personality ---');
  console.log(`  Weight:     ${result.personality.weight}`);
  console.log(`  Density:    ${result.personality.density}`);
  console.log(`  Speed:      ${result.personality.speed}`);
  console.log(`  Confidence: ${result.personality.confidence}`);
  console.log(`\n  ${result.personality.summary}`);

  console.log('\n--- Token Summary ---');
  console.log(`  Colors:       ${result.tokens.colors.palette.length} unique`);
  console.log(`  Font sizes:   ${result.tokens.typography.sizes.length} (${result.tokens.typography.sizes.map(s => s + 'px').join(', ') || 'none detected'})`);
  console.log(`  Font weights: ${Object.keys(result.tokens.typography.weights).join(', ') || 'none detected'}`);
  console.log(`  Font families: ${result.tokens.typography.families.join(', ') || 'none detected'}`);
  console.log(`  Spacing base: ${result.tokens.spacing.base_unit}`);
  console.log(`  Shadows:      ${result.tokens.shadows.levels.length} unique`);
  console.log(`  Radii:        ${result.tokens.radii.scale.length} unique`);
  console.log(`  Transitions:  ${result.tokens.transitions.durations.length} durations, ${result.tokens.transitions.easings.length} easings`);

  console.log('\n--- Structure ---');
  console.log(`  Classes:          ${result.source.class_count}`);
  console.log(`  BEM naming:       ${result.structure.class_patterns.uses_bem ? 'yes' : 'no'}`);
  console.log(`  Utility classes:  ${result.structure.class_patterns.uses_utility ? 'yes' : 'no'}`);
  console.log(`  Components (BEM): ${result.structure.class_patterns.component_count}`);
  if (result.structure.class_patterns.top_prefixes.length > 0) {
    console.log(`  Top prefixes:     ${result.structure.class_patterns.top_prefixes.map(p => p.prefix + ' (' + p.count + ')').join(', ')}`);
  }
  if (Object.keys(result.structure.heading_hierarchy).length > 0) {
    console.log(`  Headings:         ${Object.entries(result.structure.heading_hierarchy).map(([k, v]) => k + ': ' + v).join(', ')}`);
  }
  if (Object.keys(result.structure.repeated_patterns).length > 0) {
    console.log(`  Repeated:         ${Object.entries(result.structure.repeated_patterns).map(([k, v]) => k + ': ' + v).join(', ')}`);
  }

  console.log('\n--- Sources ---');
  console.log(`  Inline styles:    ${result.source.inline_styles_count}`);
  console.log(`  Embedded CSS:     ${result.source.embedded_style_declarations}`);
  console.log(`  Computed nodes:   ${result.source.computed_nodes}`);
  console.log(`  Custom props:     ${result.source.custom_properties.length}`);
}

main();
