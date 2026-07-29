#!/usr/bin/env node
'use strict';
//
// Parses a cached Notion "toggle-heading" document (a color-coded toggle
// list, e.g. a swipe-file of static ad frameworks) into a structured JSON
// registry an AI brief generator can consult.
//
// This is a generic pattern for one specific Notion authoring convention:
// a top-level "# <Section Title>" heading, containing "## [Name](url)"
// entries (one per framework/item), each with color-coded "### <label>
// {color=\"..._bg\"}" toggle subsections underneath. Point it at any Notion
// doc that follows this shape by adjusting DOC_SLUG / SECTION_HEADING /
// SECTION_BG_TO_KEY below, or pass --slug / --section on the command line.
//
// Input (gitignored runtime cache):
//   _dev/cache/notion/<slug>.raw.md
//
// Output (gitignored runtime cache):
//   _dev/cache/notion/<slug>.json
//
// Refresh flow:
//   1. Ask your AI session to call the Notion MCP fetch tool on your doc's URL
//      and save the result to _dev/cache/notion/<slug>.raw.md
//   2. Run this script: node tools/notion/parse-ad-frameworks.js [--slug <slug>]
//
// Why a parser script (not a fetcher): the Notion MCP tool runs inside an
// authenticated AI session, not as a standalone Node binary. Keeping the
// parser pure means it has no credentials, no network, and is fully testable.

const fs = require('fs');
const path = require('path');

const DEFAULT_SLUG = 'ad-frameworks-doc';
const DEFAULT_SECTION_HEADING = /^# Proven Static Frameworks/;

const SECTION_BG_TO_KEY = {
  gray_bg: 'what_it_is',
  green_bg: 'why_it_works',
  blue_bg: 'when_to_use',
  orange_bg: 'tips_for_execution',
  purple_bg: 'variations',
  pink_bg: 'examples_link'
};

function parseFrameworks(md, sectionHeading = DEFAULT_SECTION_HEADING) {
  const lines = md.split('\n');
  const startIdx = lines.findIndex((l) => sectionHeading.test(l));
  if (startIdx < 0) {
    throw new Error(`Could not find a heading matching ${sectionHeading} in cached markdown`);
  }
  const endIdx = lines.findIndex((l, i) => i > startIdx && /^# /.test(l));
  const section = lines.slice(startIdx + 1, endIdx === -1 ? undefined : endIdx);

  const frameworks = [];
  let current = null;
  let currentSubsection = null;
  let buffer = [];

  function flushBuffer() {
    if (current && currentSubsection && buffer.length) {
      const text = buffer.join('\n').trim();
      if (currentSubsection === 'when_to_use' || currentSubsection === 'tips_for_execution' || currentSubsection === 'variations') {
        // bullet lists — split into items
        current[currentSubsection] = text
          .split('\n')
          .map((l) => l.replace(/^\s*[-*]\s*/, '').trim())
          .filter(Boolean);
      } else {
        current[currentSubsection] = text;
      }
    }
    buffer = [];
  }

  for (const rawLine of section) {
    const line = rawLine;

    // Framework heading: ## <emoji> [Name](swipe-link) {toggle="true"}
    const fwMatch = line.match(/^\s*##\s+(\S+\s)?\[([^\]]+)\]\(([^)]+)\)/);
    if (fwMatch) {
      flushBuffer();
      if (current) frameworks.push(current);
      current = {
        id: slugify(fwMatch[2]),
        emoji: (fwMatch[1] || '').trim() || null,
        name: fwMatch[2].trim(),
        swipe_file_url: fwMatch[3].trim(),
        what_it_is: null,
        why_it_works: null,
        when_to_use: [],
        tips_for_execution: [],
        variations: [],
        examples_link: null
      };
      currentSubsection = null;
      continue;
    }

    // Subsection heading: ### <name> {toggle="true" color="<bg>_bg"}
    const subMatch = line.match(/^\s*###\s+([^{]+?)\s*\{[^}]*color="([^"]+)"/);
    if (subMatch && current) {
      flushBuffer();
      const bg = subMatch[2].trim();
      currentSubsection = SECTION_BG_TO_KEY[bg] || slugify(subMatch[1]);
      continue;
    }

    // Body content under the current subsection
    if (current && currentSubsection) {
      buffer.push(line);
    }
  }

  flushBuffer();
  if (current) frameworks.push(current);

  return frameworks;
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseArgs(argv) {
  const args = { slug: DEFAULT_SLUG, section: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--slug') args.slug = argv[++i];
    else if (argv[i] === '--section') args.section = argv[++i];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const cacheDir = path.join(process.cwd(), '_dev', 'cache', 'notion');
  const rawPath = path.join(cacheDir, `${args.slug}.raw.md`);
  const outPath = path.join(cacheDir, `${args.slug}.json`);
  const metaPath = path.join(cacheDir, `${args.slug}.fetch-meta.json`);
  const sectionHeading = args.section ? new RegExp(`^# ${args.section}`) : DEFAULT_SECTION_HEADING;

  if (!fs.existsSync(rawPath)) {
    console.error(`Cache miss: ${rawPath}`);
    console.error('To populate: ask your AI session to fetch your Notion doc via its Notion MCP tool and save the .text result to that path.');
    process.exit(1);
  }
  const md = fs.readFileSync(rawPath, 'utf8');
  const frameworks = parseFrameworks(md, sectionHeading);

  let fetchedAt = null;
  let sourceUrl = null;
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      fetchedAt = meta.fetched_at || null;
      sourceUrl = meta.source_url || null;
    } catch (_) {}
  }

  const out = {
    schema: 'notion-ad-frameworks/1.0',
    source_url: sourceUrl,
    parsed_at: new Date().toISOString(),
    fetched_at: fetchedAt,
    framework_count: frameworks.length,
    frameworks
  };

  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`Parsed ${frameworks.length} frameworks -> ${outPath}`);
  for (const fw of frameworks) {
    console.log(`  ${fw.emoji || ' '} ${fw.name}  (${fw.when_to_use.length} use-cases, ${fw.variations.length} variations)`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseFrameworks, slugify };
