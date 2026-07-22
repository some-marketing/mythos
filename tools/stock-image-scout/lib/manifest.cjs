'use strict';

/**
 * manifest.cjs — Load and validate an approved-image download manifest.
 *
 * The manifest is the ONLY authorization surface for the downloader: an image
 * id may be downloaded if and only if it appears in a validated manifest with
 * approved === true. This module contains no network/filesystem-download code,
 * only manifest parsing + validation.
 */

const fs = require('fs');
const path = require('path');

const REQUIRED_TOP_LEVEL_FIELDS = ['client', 'project', 'images'];
const REQUIRED_IMAGE_FIELDS = ['id', 'title', 'page_url', 'filename_slug', 'approved'];

function loadManifest(manifestPath) {
  const resolved = path.resolve(manifestPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Manifest not found: ${resolved}`);
  }
  const raw = fs.readFileSync(resolved, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Manifest is not valid JSON (${resolved}): ${err.message}`);
  }
  return validateManifest(parsed, resolved);
}

function validateManifest(manifest, sourcePath = '<in-memory>') {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error(`Manifest must be a JSON object (${sourcePath})`);
  }

  for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
    if (!(field in manifest)) {
      throw new Error(`Manifest missing required field "${field}" (${sourcePath})`);
    }
  }

  if (!Array.isArray(manifest.images) || manifest.images.length === 0) {
    throw new Error(`Manifest "images" must be a non-empty array (${sourcePath})`);
  }

  const seenIds = new Set();
  const approvedImages = [];

  manifest.images.forEach((image, idx) => {
    for (const field of REQUIRED_IMAGE_FIELDS) {
      if (!(field in image)) {
        throw new Error(`Manifest image[${idx}] missing required field "${field}" (${sourcePath})`);
      }
    }
    if (typeof image.id !== 'string' || !/^\d+$/.test(image.id)) {
      throw new Error(`Manifest image[${idx}] id must be a numeric string, got: ${JSON.stringify(image.id)}`);
    }
    if (seenIds.has(image.id)) {
      throw new Error(`Manifest contains duplicate image id "${image.id}"`);
    }
    seenIds.add(image.id);

    if (image.approved !== true) {
      // Not authorized for download; excluded from approvedImages but not an error —
      // a manifest may carry candidate/unapproved rows for review purposes.
      return;
    }
    approvedImages.push(image);
  });

  return {
    client: manifest.client,
    project: manifest.project,
    source_sheet: manifest.source_sheet || null,
    provider: manifest.provider || 'depositphotos',
    all_images: manifest.images,
    approved_images: approvedImages,
    source_path: sourcePath
  };
}

function targetFilename(image, extension = 'jpg') {
  const ext = (extension || 'jpg').replace(/^\./, '');
  return `${image.filename_slug}-${image.id}.${ext}`;
}

module.exports = {
  loadManifest,
  validateManifest,
  targetFilename,
  REQUIRED_TOP_LEVEL_FIELDS,
  REQUIRED_IMAGE_FIELDS
};
