#!/usr/bin/env node
'use strict';
// Replace the content of an existing Drive file in place (keeps id, name, link).
//
// Usage:
//   node replace-reel.js <fileId> <localFilePath> [mimeType]
//
// Example (defaults mimeType to video/mp4):
//   node replace-reel.js <driveFileId> ./new-cut.mp4

const fs = require('fs');
const path = require('path');
const { resolveCreds } = require('./config');
const { getAccessToken, updateFileMedia } = require('./client');

const FILE_ID = process.argv[2];
const NEW_PATH = process.argv[3] ? path.resolve(process.argv[3]) : undefined;
const MIME_TYPE = process.argv[4] || 'video/mp4';

if (!FILE_ID || !NEW_PATH) {
  console.error('Usage: node replace-reel.js <fileId> <localFilePath> [mimeType]');
  process.exit(1);
}

(async () => {
  console.log('Resolving credentials...');
  const accessToken = await getAccessToken(resolveCreds());

  console.log(`Checking local file at: ${NEW_PATH}...`);
  if (!fs.existsSync(NEW_PATH)) {
    throw new Error(`Local file does not exist at: ${NEW_PATH}`);
  }

  const stat = fs.statSync(NEW_PATH);
  console.log(`Replacing content of file ID ${FILE_ID}...`);
  console.log(`New file size: ${Math.round(stat.size / 1024 / 1024 * 10) / 10} MB`);

  const res = await updateFileMedia({
    accessToken,
    fileId: FILE_ID,
    filePath: NEW_PATH,
    mimeType: MIME_TYPE
  });

  console.log('\n================================================================');
  console.log('File content replaced successfully.');
  console.log(`File ID: ${res.id}`);
  console.log(`File Link: ${res.webViewLink || 'https://drive.google.com/open?id=' + res.id}`);
  console.log('================================================================\n');

})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
