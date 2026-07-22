#!/usr/bin/env node
'use strict';
// Rename a Google Drive file/folder by id.
//
// Usage:
//   node rename-folder.js <folderOrFileId> "<New Name>"

const { resolveCreds } = require('./config');
const { getAccessToken, updateFile } = require('./client');

const FOLDER_ID = process.argv[2];
const NEW_NAME = process.argv[3];

if (!FOLDER_ID || !NEW_NAME) {
  console.error('Usage: node rename-folder.js <folderOrFileId> "<New Name>"');
  process.exit(1);
}

(async () => {
  console.log('Resolving credentials...');
  const accessToken = await getAccessToken(resolveCreds());

  console.log(`Renaming ${FOLDER_ID} to "${NEW_NAME}"...`);
  const res = await updateFile({
    accessToken,
    fileId: FOLDER_ID,
    name: NEW_NAME
  });

  console.log('\n================================================================');
  console.log('Renamed successfully.');
  console.log(`New Name: ${res.name}`);
  console.log(`ID:       ${res.id}`);
  console.log(`Link:     https://drive.google.com/drive/folders/${res.id}`);
  console.log('================================================================\n');

})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
