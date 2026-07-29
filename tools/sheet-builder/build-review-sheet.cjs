#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { buildCsv } = require('./lib/csv.cjs');

const CANONICAL_COLUMNS = [
  'Rank',
  'Image Title',
  'Theme',
  'Why it fits',
  'Overlay copy-space',
  'Downloadable (under plan)',
  'Approved?',
  'Image Link'
];

function printHelp() {
  console.log(`
build-review-sheet — Generates a robust CSV for Google Sheets review passing verify-review-sheet.cjs.

Usage:
  node tools/sheet-builder/build-review-sheet.cjs --input <json-file> --output <csv-file>

The input JSON should be an array of objects mapped to the CANONICAL_COLUMNS.
URLs must be passed cleanly and will be embedded strictly into 'Image Link'.
`);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  let inputPath = null;
  let outputPath = null;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input') inputPath = argv[++i];
    if (argv[i] === '--output') outputPath = argv[++i];
  }

  if (!inputPath || !outputPath) {
    console.error('Error: --input and --output are required.');
    process.exit(1);
  }

  const inAbs = path.resolve(inputPath);
  const outAbs = path.resolve(outputPath);

  if (!fs.existsSync(inAbs)) {
    console.error(`Error: input file not found ${inAbs}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(inAbs, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error(`Error: input is not valid JSON. ${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(data)) {
    console.error('Error: input JSON must be an array of row objects.');
    process.exit(1);
  }

  // Ensure contiguous ranking if missing, and enforce mandatory fields (fail loud)
  const formattedData = data.map((row, idx) => {
    const title = row['Image Title'] || row.title;
    if (!title) {
      throw new Error(`[SCHEMA ERROR] Row #${idx + 1} is missing the mandatory 'Image Title' or 'title' field.`);
    }
    const link = row['Image Link'] || row.url;
    if (!link) {
      throw new Error(`[SCHEMA ERROR] Row #${idx + 1} is missing the mandatory 'Image Link' or 'url' field.`);
    }

    return {
      'Rank': row.Rank || (idx + 1).toString(),
      'Image Title': title,
      'Theme': row.Theme || row.theme || 'General',
      'Why it fits': row['Why it fits'] || row.reason || '',
      'Overlay copy-space': row['Overlay copy-space'] || row.overlay || 'Unknown',
      'Downloadable (under plan)': row['Downloadable (under plan)'] !== undefined ? row['Downloadable (under plan)'] : (row.downloadable_under_plan ? 'Yes' : 'Unknown'),
      'Approved?': '', // always blank for operator to fill
      'Image Link': link
    };
  });

  const csvContent = buildCsv(CANONICAL_COLUMNS, formattedData);
  
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, csvContent, 'utf8');

  console.log(`Successfully built review sheet with ${formattedData.length} rows at ${outputPath}`);
}

if (require.main === module) {
  main();
}
