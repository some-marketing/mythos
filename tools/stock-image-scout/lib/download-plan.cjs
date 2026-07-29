'use strict';

/**
 * download-plan.cjs — Pure planning/idempotency/receipt logic for the
 * Depositphotos licensed-download tool. No network, no Playwright, no fs
 * writes beyond what callers explicitly ask for via buildReceipt's caller.
 * Fully unit-testable offline.
 */

const fs = require('fs');
const path = require('path');
const { targetFilename } = require('./manifest.cjs');

/**
 * Build a download plan from approved manifest images against a destination
 * directory's current contents. Applies an optional --limit cap.
 *
 * Returns an array of plan entries: { id, title, page_url, filename, status }
 * status is one of: 'pending' (would download) | 'skip_existing' (already present)
 * | 'skip_limit' (excluded by --limit cap).
 */
function buildDownloadPlan(approvedImages, destDir, options = {}) {
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : Infinity;

  let existingFiles = new Set();
  if (fs.existsSync(destDir)) {
    existingFiles = new Set(fs.readdirSync(destDir));
  }

  const plan = [];
  let pendingCount = 0;

  for (const image of approvedImages) {
    const filename = targetFilename(image);
    const alreadyPresent = existingFiles.has(filename);

    let status;
    if (alreadyPresent) {
      status = 'skip_existing';
    } else if (pendingCount >= limit) {
      status = 'skip_limit';
    } else {
      status = 'pending';
      pendingCount += 1;
    }

    plan.push({
      id: image.id,
      title: image.title,
      page_url: image.page_url,
      filename_slug: image.filename_slug,
      filename,
      status
    });
  }

  return plan;
}

/**
 * Build a receipt entry for a single completed download. Kept pure/testable
 * by accepting `nowIso` rather than calling Date.now() internally.
 */
function buildReceiptEntry({ id, title, page_url, filename, fileSizeBytes, nowIso }) {
  return {
    id,
    title,
    page_url,
    filename,
    file_size_bytes: fileSizeBytes,
    downloaded_at: nowIso,
    license: 'All-In-One subscription download (credit-consuming)'
  };
}

/**
 * Build the full receipt document to write to <dest>/download-receipt.json.
 * Merges with any pre-existing receipt entries so re-runs accumulate history
 * rather than clobbering prior evidence.
 */
function buildReceiptDocument({ client, project, manifestSourcePath, entries, existingReceipt, nowIso }) {
  const priorEntries = (existingReceipt && Array.isArray(existingReceipt.entries)) ? existingReceipt.entries : [];
  const priorIds = new Set(priorEntries.map(e => e.id));
  const mergedEntries = priorEntries.concat(entries.filter(e => !priorIds.has(e.id)));

  return {
    client,
    project,
    manifest_source: manifestSourcePath,
    last_run_at: nowIso,
    entries: mergedEntries
  };
}

function loadExistingReceipt(destDir) {
  const receiptPath = path.join(destDir, 'download-receipt.json');
  if (!fs.existsSync(receiptPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  } catch (err) {
    return null;
  }
}

function receiptPathFor(destDir) {
  return path.join(destDir, 'download-receipt.json');
}

module.exports = {
  buildDownloadPlan,
  buildReceiptEntry,
  buildReceiptDocument,
  loadExistingReceipt,
  receiptPathFor
};
