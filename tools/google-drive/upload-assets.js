#!/usr/bin/env node
'use strict';
// Upload a batch of local assets into a Drive folder (creating the folder if
// it doesn't already exist), and optionally move an existing Drive file
// (e.g. a doc) into that same folder afterwards.
//
// Driven entirely by a JSON manifest so this script carries no client- or
// project-specific values -- point it at a different manifest for a
// different batch.
//
// Usage:
//   node upload-assets.js <manifest.json>
//
// Manifest shape:
//   {
//     "parentId": "<drive folder id the new subfolder is created under>",
//     "folderName": "<name of the subfolder to ensure/create>",
//     "files": [
//       { "path": "relative/or/absolute/path/to/local-file.jpg", "name": "uploaded-name.jpg", "mimeType": "image/jpeg" }
//     ],
//     "moveIntoFolder": [
//       { "fileId": "<existing drive file id, e.g. a doc>", "removeFromParentId": "<parentId>" }
//     ]
//   }
//
// Relative "path" values in files[] resolve against the manifest file's own
// directory. Auth: see SETUP.md (run authorize.js once).

const fs = require('fs');
const path = require('path');
const { resolveCreds } = require('./config');
const { getAccessToken, ensureFolder, uploadFile, updateFile } = require('./client');

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error('Usage: node upload-assets.js <manifest.json>');
  process.exit(1);
}

const manifestDir = path.dirname(path.resolve(manifestPath));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const { parentId, folderName, files = [], moveIntoFolder = [] } = manifest;

if (!parentId || !folderName) {
  console.error('Manifest must declare "parentId" and "folderName".');
  process.exit(1);
}

(async () => {
  console.log('Resolving credentials...');
  const accessToken = await getAccessToken(resolveCreds());

  console.log(`Ensuring folder "${folderName}" exists under parent (${parentId})...`);
  const folder = await ensureFolder({ accessToken, name: folderName, parentId });
  console.log(`Folder ID: ${folder.id}`);

  console.log(`\n--- Uploading ${files.length} file(s) ---`);
  for (const file of files) {
    const filePath = path.isAbsolute(file.path) ? file.path : path.resolve(manifestDir, file.path);
    if (!fs.existsSync(filePath)) {
      console.warn(`WARNING: local file not found, skipping: ${file.path}`);
      continue;
    }
    const stat = fs.statSync(filePath);
    const name = file.name || path.basename(filePath);
    console.log(`Uploading: ${name} (${Math.round(stat.size / 1024)} KB)...`);
    const r = await uploadFile({
      accessToken,
      filePath,
      name,
      parentId: folder.id,
      mimeType: file.mimeType || 'application/octet-stream'
    });
    console.log(`Uploaded -> ID: ${r.id}`);
  }

  if (moveIntoFolder.length) {
    console.log(`\n--- Moving ${moveIntoFolder.length} existing file(s) into the folder ---`);
    for (const move of moveIntoFolder) {
      try {
        console.log(`Moving ${move.fileId} into folder (${folder.id})...`);
        await updateFile({
          accessToken,
          fileId: move.fileId,
          addParents: folder.id,
          removeParents: move.removeFromParentId || parentId
        });
        console.log('Moved successfully.');
      } catch (e) {
        console.error(`Failed to move ${move.fileId}: ${e.message}. It may already be in the target folder.`);
      }
    }
  }

  console.log('\n================================================================');
  console.log('Done.');
  console.log(`Folder Link: https://drive.google.com/drive/folders/${folder.id}`);
  console.log('================================================================\n');

})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
