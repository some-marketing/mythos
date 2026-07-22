#!/usr/bin/env node
'use strict';

/**
 * generate-dlv-import.js — Generate a GTM container import JSON with DLV variable definitions.
 *
 * Reads DLV variable definitions from:
 *   1. The CLIENTA GTM Tagging Plan spreadsheet (GTM Workspace sheet, DLV — New rows)
 *   2. OR a dataLayer evidence payload JSON file
 *
 * Outputs a valid GTM container import JSON that can be imported via:
 *   GTM → Admin → Import Container → Merge → Choose workspace
 *
 * Usage:
 *   node tools/ad-platforms/gtm/generate-dlv-import.js --from-plan <xlsx-path> [--output <path>]
 *   node tools/ad-platforms/gtm/generate-dlv-import.js --from-evidence <json-path> [--output <path>]
 *   node tools/ad-platforms/gtm/generate-dlv-import.js --from-plan <xlsx> --dry-run
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// GTM container import format
// ---------------------------------------------------------------------------

/**
 * Build a single GTM Data Layer Variable object in container import format.
 *
 * @param {string} displayName — The GTM variable display name (e.g., "dlv - make")
 * @param {string} dataLayerKey — The dataLayer field name (e.g., "make")
 * @param {number} idx — Unique index for accountId/containerId placeholders
 * @returns {object} GTM variable definition
 */
function buildDlvVariable(displayName, dataLayerKey, idx, containerMeta) {
  return {
    accountId: containerMeta.accountId || '0',
    containerId: containerMeta.containerId || '0',
    variableId: String(1000 + idx),
    name: displayName,
    type: 'v',  // "v" = Data Layer Variable in GTM
    parameter: [
      {
        type: 'INTEGER',
        key: 'dataLayerVersion',
        value: '2'
      },
      {
        type: 'BOOLEAN',
        key: 'setDefaultValue',
        value: 'false'
      },
      {
        type: 'TEMPLATE',
        key: 'name',
        value: dataLayerKey
      }
    ],
    fingerprint: String(Date.now()),
    formatValue: {}
  };
}

/**
 * Wrap an array of GTM variable objects into a valid container import JSON.
 */
function buildContainerImport(variables) {
  return {
    exportFormatVersion: 2,
    exportTime: new Date().toISOString(),
    containerVersion: {
      tag: [],
      trigger: [],
      variable: variables,
      folder: [],
      builtInVariable: [],
      customTemplate: []
    }
  };
}

// ---------------------------------------------------------------------------
// Source: Tagging plan spreadsheet
// ---------------------------------------------------------------------------

function readFromPlan(xlsxPath) {
  let openpyxl;
  try {
    // We'll shell out to Python since openpyxl is available there
    const { execSync } = require('child_process');
    const script = `
import openpyxl, json, sys
wb = openpyxl.load_workbook(sys.argv[1])
ws = wb['GTM Workspace']
variables = []
for row in ws.iter_rows(min_row=2, values_only=True):
    cat = str(row[1] or '')
    name = str(row[2] or '')
    action = str(row[4] or '')
    details = str(row[5] or '')
    if 'DLV' in cat and 'New' in cat and action == 'CREATE' and name:
        dl_key = ''
        if 'Data Layer Variable Name:' in details:
            dl_key = details.split('Data Layer Variable Name:')[1].split('\\n')[0].strip()
        if dl_key:
            variables.append({'display_name': name, 'dl_key': dl_key})
print(json.dumps(variables))
`;
    const result = execSync(`python3 -c "${script.replace(/"/g, '\\"')}" "${xlsxPath}"`, {
      encoding: 'utf8',
      timeout: 10000
    });
    return JSON.parse(result);
  } catch (e) {
    console.error(`Error reading spreadsheet: ${e.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Source: Evidence payload JSON
// ---------------------------------------------------------------------------

function readFromEvidence(jsonPath) {
  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

    // Handle evidence format (has .observed.payload)
    const payload = data.observed?.payload || data.payload || data;

    const skipKeys = new Set(['event', 'gtm.uniqueEventId', '_NOTE']);
    const variables = [];

    for (const key of Object.keys(payload)) {
      if (skipKeys.has(key)) continue;
      variables.push({
        display_name: `dlv - ${key}`,
        dl_key: key
      });
    }

    return variables;
  } catch (e) {
    console.error(`Error reading evidence file: ${e.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    fromPlan: null,
    fromEvidence: null,
    fromContainer: null,
    output: null,
    dryRun: args.includes('--dry-run'),
    help: args.includes('--help') || args.includes('-h')
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from-plan' && args[i + 1]) opts.fromPlan = args[++i];
    if (args[i] === '--from-evidence' && args[i + 1]) opts.fromEvidence = args[++i];
    if (args[i] === '--from-container' && args[i + 1]) opts.fromContainer = args[++i];
    if (args[i] === '--output' && args[i + 1]) opts.output = args[++i];
  }

  return opts;
}

/**
 * Read container metadata (accountId, containerId) from an existing GTM export.
 * Also checks which DLV variable names already exist to avoid duplicates.
 */
function readContainerMeta(containerPath) {
  try {
    const data = JSON.parse(fs.readFileSync(containerPath, 'utf8'));
    const cv = data.containerVersion || {};
    const existingVarNames = new Set(
      (cv.variable || []).map(v => v.name)
    );
    return {
      accountId: cv.accountId || '0',
      containerId: cv.containerId || '0',
      existingVarNames
    };
  } catch (e) {
    console.error(`Error reading container export: ${e.message}`);
    return { accountId: '0', containerId: '0', existingVarNames: new Set() };
  }
}

function main() {
  const opts = parseArgs();

  if (opts.help || (!opts.fromPlan && !opts.fromEvidence)) {
    console.log(`Usage:
  node generate-dlv-import.js --from-plan <tagging-plan.xlsx> --from-container <export.json> [--output <path>]
  node generate-dlv-import.js --from-evidence <evidence.json> --from-container <export.json> [--output <path>]

Options:
  --from-plan      Read DLV definitions from GTM Tagging Plan spreadsheet (GTM Workspace sheet)
  --from-evidence  Read DLV definitions from a dataLayer evidence payload JSON
  --from-container Read accountId/containerId from an existing GTM container export (REQUIRED)
  --output         Output path for the GTM import JSON (default: auto-named file)
  --dry-run        Show what would be generated without writing
  --help           Show this help`);
    process.exit(0);
  }

  // Require --from-container (standalone imports don't work in GTM)
  if (!opts.fromContainer) {
    console.error(`ERROR: --from-container is required.

GTM rejects standalone import files. The working approach is:
  1. Export your current container from GTM (Admin → Export Container)
  2. Pass the export as --from-container so this tool can:
     - Use the real accountId and containerId
     - Assign sequential variableIds
     - Skip variables that already exist
  3. Import the modified file back into GTM using Merge mode

Example:
  node generate-dlv-import.js --from-plan tagging-plan.xlsx --from-container GTM-export.json --output output.json`);
    process.exit(1);
  }

  if (!fs.existsSync(opts.fromContainer)) {
    console.error(`Container export not found: ${opts.fromContainer}`);
    process.exit(1);
  }

  // Read variables from source
  let variables;
  let sourceName;

  if (opts.fromPlan) {
    if (!fs.existsSync(opts.fromPlan)) {
      console.error(`File not found: ${opts.fromPlan}`);
      process.exit(1);
    }
    variables = readFromPlan(opts.fromPlan);
    sourceName = path.basename(opts.fromPlan);
  } else {
    if (!fs.existsSync(opts.fromEvidence)) {
      console.error(`File not found: ${opts.fromEvidence}`);
      process.exit(1);
    }
    variables = readFromEvidence(opts.fromEvidence);
    sourceName = path.basename(opts.fromEvidence);
  }

  if (variables.length === 0) {
    console.error('No DLV variables found in source.');
    process.exit(1);
  }

  // Read container metadata if provided
  const containerMeta = opts.fromContainer
    ? readContainerMeta(opts.fromContainer)
    : { accountId: '0', containerId: '0', existingVarNames: new Set() };

  if (opts.fromContainer) {
    console.log(`Container: accountId=${containerMeta.accountId}, containerId=${containerMeta.containerId}`);
    console.log(`Existing variables in container: ${containerMeta.existingVarNames.size}`);
  }

  // Filter out variables that already exist in the container
  const newVariables = variables.filter(v => {
    if (containerMeta.existingVarNames.has(v.display_name)) {
      console.log(`  SKIP (already exists): ${v.display_name}`);
      return false;
    }
    return true;
  });

  if (newVariables.length < variables.length) {
    console.log(`Filtered: ${variables.length - newVariables.length} already exist, ${newVariables.length} new`);
  }

  if (newVariables.length === 0) {
    console.log('\nAll variables already exist in the container. Nothing to import.');
    process.exit(0);
  }

  // Build GTM variable objects
  const gtmVariables = newVariables.map((v, i) => buildDlvVariable(v.display_name, v.dl_key, i, containerMeta));

  // Build container import
  const containerImport = buildContainerImport(gtmVariables);

  // Output
  const json = JSON.stringify(containerImport, null, 2);

  console.log(`\nSource: ${sourceName}`);
  console.log(`Variables to create: ${gtmVariables.length}`);
  console.log('');
  console.log('DLV variables to create:');
  for (const v of newVariables) {
    console.log(`  ${v.display_name.padEnd(30)} → dataLayer.${v.dl_key}`);
  }

  if (opts.dryRun) {
    console.log('\n[dry-run] Would generate GTM import JSON with the above variables.');
    console.log(`[dry-run] Container import format version: ${containerImport.exportFormatVersion}`);
    return;
  }

  const outputPath = opts.output || `gtm-dlv-import__${Date.now()}.json`;
  fs.writeFileSync(outputPath, json + '\n', 'utf8');
  console.log(`\nWrote GTM import JSON to: ${outputPath}`);
  console.log('\nTo import:');
  console.log('  1. Open GTM → Admin → Import Container');
  console.log('  2. Choose the target workspace');
  console.log('  3. Select "Merge" (not Overwrite)');
  console.log('  4. Choose "Rename conflicting" for safety');
  console.log(`  5. Upload: ${outputPath}`);
}

main();
