#!/usr/bin/env node
'use strict';

/**
 * generate-trigger-import.js — Generate a GTM container import JSON with Custom Event trigger definitions.
 *
 * Reads event names from:
 *   1. A comma-separated --events flag
 *   2. OR a spec file (one event per line, or JSON array) via --from-spec
 *
 * Outputs a valid GTM container import JSON that can be imported via:
 *   GTM → Admin → Import Container → Merge → Choose workspace
 *
 * Usage:
 *   node tools/ad-platforms/gtm/generate-trigger-import.js --events "view_vehicle,save_vehicle" --from-container <export.json> [--output <path>]
 *   node tools/ad-platforms/gtm/generate-trigger-import.js --from-spec <spec-path> --from-container <export.json> [--output <path>]
 *   node tools/ad-platforms/gtm/generate-trigger-import.js --events "view_vehicle" --from-container <export.json> --dry-run
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// GTM container import format
// ---------------------------------------------------------------------------

/**
 * Build a single GTM Custom Event Trigger object in container import format.
 *
 * @param {string} eventName — The custom event name (e.g., "view_vehicle")
 * @param {number} idx — Unique index for triggerId generation
 * @param {object} containerMeta — Container metadata (accountId, containerId)
 * @returns {object} GTM trigger definition
 */
function buildCustomEventTrigger(eventName, idx, containerMeta) {
  return {
    accountId: containerMeta.accountId || '0',
    containerId: containerMeta.containerId || '0',
    triggerId: String(2000 + idx),
    name: `CE - ${eventName}`,
    type: 'customEvent',
    customEventFilter: [
      {
        type: 'equals',
        parameter: [
          { type: 'TEMPLATE', key: 'arg0', value: '{{_event}}' },
          { type: 'TEMPLATE', key: 'arg1', value: eventName }
        ]
      }
    ],
    fingerprint: String(Date.now())
  };
}

/**
 * Wrap an array of GTM trigger objects into a valid container import JSON.
 */
function buildContainerImport(triggers) {
  return {
    exportFormatVersion: 2,
    exportTime: new Date().toISOString(),
    containerVersion: {
      tag: [],
      trigger: triggers,
      variable: [],
      folder: [],
      builtInVariable: [],
      customTemplate: []
    }
  };
}

// ---------------------------------------------------------------------------
// Source: --events flag (comma-separated)
// ---------------------------------------------------------------------------

function readFromEvents(eventsString) {
  return eventsString
    .split(',')
    .map(e => e.trim())
    .filter(e => e.length > 0);
}

// ---------------------------------------------------------------------------
// Source: --from-spec file (one per line or JSON array)
// ---------------------------------------------------------------------------

function readFromSpec(specPath) {
  try {
    const raw = fs.readFileSync(specPath, 'utf8').trim();

    // Try JSON array first
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(e => String(e).trim()).filter(e => e.length > 0);
      }
    } catch (_) {
      // Not JSON — treat as line-separated
    }

    return raw
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'));
  } catch (e) {
    console.error(`Error reading spec file: ${e.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    events: null,
    fromSpec: null,
    fromContainer: null,
    output: null,
    dryRun: args.includes('--dry-run'),
    help: args.includes('--help') || args.includes('-h')
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--events' && args[i + 1]) opts.events = args[++i];
    if (args[i] === '--from-spec' && args[i + 1]) opts.fromSpec = args[++i];
    if (args[i] === '--from-container' && args[i + 1]) opts.fromContainer = args[++i];
    if (args[i] === '--output' && args[i + 1]) opts.output = args[++i];
  }

  return opts;
}

/**
 * Read container metadata (accountId, containerId) from an existing GTM export.
 * Also checks which trigger names already exist to avoid duplicates.
 */
function readContainerMeta(containerPath) {
  try {
    const data = JSON.parse(fs.readFileSync(containerPath, 'utf8'));
    const cv = data.containerVersion || {};
    const existingTriggerNames = new Set(
      (cv.trigger || []).map(t => t.name)
    );
    return {
      accountId: cv.accountId || '0',
      containerId: cv.containerId || '0',
      existingTriggerNames
    };
  } catch (e) {
    console.error(`Error reading container export: ${e.message}`);
    return { accountId: '0', containerId: '0', existingTriggerNames: new Set() };
  }
}

function main() {
  const opts = parseArgs();

  if (opts.help || (!opts.events && !opts.fromSpec)) {
    console.log(`Usage:
  node generate-trigger-import.js --events "event1,event2" --from-container <export.json> [--output <path>]
  node generate-trigger-import.js --from-spec <spec-file> --from-container <export.json> [--output <path>]

Options:
  --events         Comma-separated list of custom event names
  --from-spec      Read event names from a spec file (one per line or JSON array)
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
     - Assign sequential triggerIds
     - Skip triggers that already exist
  3. Import the modified file back into GTM using Merge mode

Example:
  node generate-trigger-import.js --events "view_vehicle,save_vehicle" --from-container GTM-export.json --output output.json`);
    process.exit(1);
  }

  if (!fs.existsSync(opts.fromContainer)) {
    console.error(`Container export not found: ${opts.fromContainer}`);
    process.exit(1);
  }

  // Read event names from source
  let eventNames;
  let sourceName;

  if (opts.events) {
    eventNames = readFromEvents(opts.events);
    sourceName = 'CLI --events';
  } else {
    if (!fs.existsSync(opts.fromSpec)) {
      console.error(`File not found: ${opts.fromSpec}`);
      process.exit(1);
    }
    eventNames = readFromSpec(opts.fromSpec);
    sourceName = path.basename(opts.fromSpec);
  }

  if (eventNames.length === 0) {
    console.error('No event names found in source.');
    process.exit(1);
  }

  // Read container metadata
  const containerMeta = readContainerMeta(opts.fromContainer);

  console.log(`Container: accountId=${containerMeta.accountId}, containerId=${containerMeta.containerId}`);
  console.log(`Existing triggers in container: ${containerMeta.existingTriggerNames.size}`);

  // Filter out triggers that already exist in the container
  const triggerDisplayNames = eventNames.map(e => ({ eventName: e, displayName: `CE - ${e}` }));
  const newTriggers = triggerDisplayNames.filter(t => {
    if (containerMeta.existingTriggerNames.has(t.displayName)) {
      console.log(`  SKIP (already exists): ${t.displayName}`);
      return false;
    }
    return true;
  });

  if (newTriggers.length < triggerDisplayNames.length) {
    console.log(`Filtered: ${triggerDisplayNames.length - newTriggers.length} already exist, ${newTriggers.length} new`);
  }

  if (newTriggers.length === 0) {
    console.log('\nAll triggers already exist in the container. Nothing to import.');
    process.exit(0);
  }

  // Build GTM trigger objects
  const gtmTriggers = newTriggers.map((t, i) => buildCustomEventTrigger(t.eventName, i, containerMeta));

  // Build container import
  const containerImport = buildContainerImport(gtmTriggers);

  // Output
  const json = JSON.stringify(containerImport, null, 2);

  console.log(`\nSource: ${sourceName}`);
  console.log(`Triggers to create: ${gtmTriggers.length}`);
  console.log('');
  console.log('Custom Event triggers to create:');
  for (const t of newTriggers) {
    console.log(`  ${t.displayName.padEnd(30)} → event: ${t.eventName}`);
  }

  if (opts.dryRun) {
    console.log('\n[dry-run] Would generate GTM import JSON with the above triggers.');
    console.log(`[dry-run] Container import format version: ${containerImport.exportFormatVersion}`);
    return;
  }

  const outputPath = opts.output || `gtm-trigger-import__${Date.now()}.json`;
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
