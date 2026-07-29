#!/usr/bin/env node
'use strict';
// Build a folder structure under a Drive parent and upload files matching a
// plan into it. Dry-run by default; pass --apply to mutate.
//
//   node organize-deliverables.js <plan.json>            # plan only
//   node organize-deliverables.js <plan.json> --apply    # execute
//
// Auth: SETUP.md (run authorize.js once first).
// Idempotent: existing same-named folders are reused; already-uploaded files are skipped.
//
// Plan shape:
//   {
//     "parentId": "<drive folder id everything nests under>",
//     "folders": [
//       {
//         "name": "<subfolder to create/reuse>",
//         "sourceDir": "<local dir the files below are read from, relative to this plan file or absolute>",
//         "files": ["file-one.pdf", "file-two.pdf"],
//         "mimeType": "application/pdf",
//         "children": [
//           {
//             "name": "<nested subfolder>",
//             "sourceDir": "<local dir for this nested set>",
//             "files": ["side-question-a.pdf"],
//             "mimeType": "application/pdf"
//           }
//         ]
//       }
//     ],
//     "renames": [
//       { "parentId": "<folder id, or omit to use plan.parentId>", "from": "Old Name", "to": "New Name" }
//     ]
//   }

const fs = require('fs');
const path = require('path');
const { resolveCreds } = require('./config');
const { getAccessToken, ensureFolder, findChild, updateFile, uploadFile } = require('./client');

const planPath = process.argv[2];
const APPLY = process.argv.includes('--apply');

if (!planPath) {
  console.error('Usage: node organize-deliverables.js <plan.json> [--apply]');
  process.exit(1);
}

const planDir = path.dirname(path.resolve(planPath));
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const { parentId, folders = [], renames = [] } = plan;

if (!parentId) {
  console.error('Plan must declare "parentId".');
  process.exit(1);
}

const log = (...a) => console.log((APPLY ? '' : '[dry-run] ') + a.join(' '));
const isReal = (id) => !!id && !String(id).startsWith('<new:');

function resolveSourceDir(sourceDir) {
  return path.isAbsolute(sourceDir) ? sourceDir : path.resolve(planDir, sourceDir);
}

async function uploadInto({ accessToken, folderId, dir, file, mimeType }) {
  const filePath = path.join(dir, file);
  if (!fs.existsSync(filePath)) { log('MISSING local file, skip:', filePath); return; }
  const kb = Math.round(fs.statSync(filePath).size / 1024);
  // In dry-run the parent folder may not exist yet (placeholder id) -- don't query the API for it.
  const existing = isReal(folderId) ? await findChild({ accessToken, parentId: folderId, name: file }) : null;
  if (existing) { log(`skip (already in Drive): ${file}`); return; }
  if (!APPLY) { log(`would upload: ${file} (${kb} KB)`); return; }
  const r = await uploadFile({ accessToken, filePath, name: file, parentId: folderId, mimeType: mimeType || 'application/octet-stream' });
  log(`uploaded: ${file} (${kb} KB) -> ${r.id}`);
}

async function ensure({ accessToken, name, parentId: pid }) {
  if (!APPLY) {
    // Only probe the API when the parent actually exists; a not-yet-created parent
    // (dry-run placeholder) can't be queried.
    const existing = isReal(pid)
      ? await findChild({ accessToken, parentId: pid, name, mimeType: 'application/vnd.google-apps.folder' })
      : null;
    log(existing ? `folder exists: ${name} (${existing.id})` : `would create folder: ${name}`);
    return existing || { id: `<new:${name}>` };
  }
  const f = await ensureFolder({ accessToken, name, parentId: pid });
  log(`${f._existed ? 'folder exists' : 'created folder'}: ${name} (${f.id})`);
  return f;
}

async function renameIfPresent({ accessToken, parentId: pid, fromName, toName }) {
  const found = await findChild({ accessToken, parentId: pid, name: fromName, mimeType: 'application/vnd.google-apps.folder' });
  if (!found) { log(`(rename) not found, skip: "${fromName}"`); return; }
  if (!APPLY) { log(`would rename: "${fromName}" -> "${toName}" (${found.id})`); return; }
  await updateFile({ accessToken, fileId: found.id, name: toName });
  log(`renamed: "${fromName}" -> "${toName}" (${found.id})`);
}

async function processFolder({ accessToken, node, parentId: pid }) {
  const folder = await ensure({ accessToken, name: node.name, parentId: pid });
  const dir = node.sourceDir ? resolveSourceDir(node.sourceDir) : planDir;
  for (const file of node.files || []) {
    await uploadInto({ accessToken, folderId: folder.id, dir, file, mimeType: node.mimeType });
  }
  for (const child of node.children || []) {
    await processFolder({ accessToken, node: child, parentId: folder.id });
  }
  return folder;
}

(async () => {
  const accessToken = await getAccessToken(resolveCreds());

  for (const folderNode of folders) {
    await processFolder({ accessToken, node: folderNode, parentId });
  }

  for (const r of renames) {
    await renameIfPresent({ accessToken, parentId: r.parentId || parentId, fromName: r.from, toName: r.to });
  }

  console.log(APPLY ? '\nDone.' : '\nDry-run complete. Re-run with --apply to execute.');
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
