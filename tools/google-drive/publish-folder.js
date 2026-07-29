#!/usr/bin/env node
'use strict';
// Create (or reuse) a Drive folder, upload a set of local files into it, and
// share the folder (reader, no notification email by default) with an
// external collaborator. Writes a manifest of what was created, for a caller
// to consume afterwards (e.g. to write links back into a task tracker).
//
// This crosses an external-sharing trust boundary -- run it deliberately,
// not as a side effect of an unrelated task:
//   node publish-folder.js <manifest.json> [--dry-run]
//
// Manifest shape:
//   {
//     "folderName": "<name of the Drive folder to create/reuse>",
//     "parentId": "root",
//     "files": [
//       { "local": "relative/or/absolute/path.md", "name": "Uploaded Name.md", "mime": "text/markdown" }
//     ],
//     "shareWith": "collaborator@example.com",
//     "shareRole": "reader",
//     "outputManifestPath": "relative/or/absolute/path/to/write-result-manifest.json"
//   }
//
// Relative "local" paths and "outputManifestPath" resolve against the
// manifest file's own directory.

const fs = require('fs');
const path = require('path');
const { resolveCreds } = require('./config');
const { getAccessToken, ensureFolder, uploadFile, createPermission, listPermissions } = require('./client');

const manifestPath = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

if (!manifestPath) {
  console.error('Usage: node publish-folder.js <manifest.json> [--dry-run]');
  process.exit(1);
}

const manifestDir = path.dirname(path.resolve(manifestPath));
const input = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const {
  folderName,
  parentId = 'root',
  files = [],
  shareWith,
  shareRole = 'reader',
  outputManifestPath
} = input;

if (!folderName || !files.length) {
  console.error('Manifest must declare "folderName" and a non-empty "files" array.');
  process.exit(1);
}

function resolveLocal(p) {
  return path.isAbsolute(p) ? p : path.resolve(manifestDir, p);
}

(async () => {
  for (const f of files) {
    const p = resolveLocal(f.local);
    if (!fs.existsSync(p)) {
      console.error('MISSING local file:', f.local);
      process.exit(1);
    }
  }
  if (dryRun) {
    console.log('[dry-run] would create folder:', folderName);
    for (const f of files) console.log('[dry-run] would upload:', f.local, '->', f.name);
    if (shareWith) console.log(`[dry-run] would share folder with ${shareWith} (${shareRole}, no notification email)`);
    return;
  }

  const accessToken = await getAccessToken(resolveCreds());
  // parentId is required -- without it findChild queries "'undefined' in parents" (HTTP 404).
  const folder = await ensureFolder({ accessToken, name: folderName, parentId });
  console.log('folder:', folder.id);

  const outManifest = {
    createdAt: new Date().toISOString(),
    folder: { id: folder.id, name: folderName, link: 'https://drive.google.com/drive/folders/' + folder.id },
    sharedWith: shareWith || null,
    files: []
  };

  for (const f of files) {
    const up = await uploadFile({
      accessToken,
      filePath: resolveLocal(f.local),
      name: f.name,
      parentId: folder.id,
      mimeType: f.mime
    });
    const link = up.webViewLink || 'https://drive.google.com/file/d/' + up.id + '/view';
    console.log('uploaded:', f.name, '->', link);
    outManifest.files.push({ local: f.local, name: f.name, id: up.id, link, ...(f.tag ? { tag: f.tag } : {}) });
  }

  if (shareWith) {
    await createPermission({
      accessToken,
      fileId: folder.id,
      role: shareRole,
      type: 'user',
      emailAddress: shareWith,
      sendNotificationEmail: false
    });
    const perms = await listPermissions({ accessToken, fileId: folder.id });
    console.log('permissions:', JSON.stringify((perms.permissions || []).map((p) => p.emailAddress || p.type)));
  }

  if (outputManifestPath) {
    const outPath = resolveLocal(outputManifestPath);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(outManifest, null, 2));
    console.log('manifest:', outPath);
  }
  console.log('folder link:', outManifest.folder.link);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
