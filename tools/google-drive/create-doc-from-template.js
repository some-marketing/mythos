#!/usr/bin/env node
'use strict';
// Convert a local Markdown file to lightly-styled HTML and upload it as a
// native Google Doc into a target Drive folder.
//
// Usage:
//   node create-doc-from-template.js --input <path/to/file.md> --name "<Doc title>" --parent <driveFolderId>
//
// Auth: see SETUP.md (run authorize.js once).

const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');
const { resolveCreds } = require('./config');
const { getAccessToken } = require('./client');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : def;
}

const INPUT_PATH = arg('input');
const DOC_NAME = arg('name');
const PARENT_ID = arg('parent');

if (!INPUT_PATH || !DOC_NAME || !PARENT_ID) {
  console.error('Usage: node create-doc-from-template.js --input <file.md> --name "<Doc title>" --parent <driveFolderId>');
  process.exit(1);
}

function parseInline(text) {
  // Bold **text**
  text = text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
  // Italic *text*
  text = text.replace(/\*(.*?)\*/g, '<i>$1</i>');
  // Superscript footnote markers
  text = text.replace(/¹/g, '<sup>1</sup>');
  text = text.replace(/²/g, '<sup>2</sup>');
  text = text.replace(/³/g, '<sup>3</sup>');
  text = text.replace(/⁴/g, '<sup>4</sup>');
  return text;
}

function markdownToHtml(md) {
  const lines = md.split('\n');
  let html = '';
  let inList = false;
  let listType = null; // 'ul' or 'ol'
  let inBlockquote = false;

  for (let line of lines) {
    line = line.trim();

    // Handle blockquotes
    if (line.startsWith('>')) {
      if (!inBlockquote) {
        html += '<blockquote>';
        inBlockquote = true;
      }
      line = line.substring(1).trim();
    } else if (inBlockquote) {
      html += '</blockquote>';
      inBlockquote = false;
    }

    // Handle lists
    const isUnordered = line.startsWith('- ') || line.startsWith('* ');
    const isOrdered = /^\d+\.\s/.test(line);

    if (isUnordered || isOrdered) {
      const currentListType = isUnordered ? 'ul' : 'ol';
      if (!inList) {
        html += `<${currentListType}>`;
        inList = true;
        listType = currentListType;
      } else if (listType !== currentListType) {
        html += `</${listType}><${currentListType}>`;
        listType = currentListType;
      }
      const text = isUnordered ? line.substring(2) : line.replace(/^\d+\.\s/, '');
      html += `<li>${parseInline(text)}</li>`;
      continue;
    } else if (inList) {
      html += `</${listType}>`;
      inList = false;
      listType = null;
    }

    if (line === '') {
      html += '<br/>';
      continue;
    }

    // Headers
    if (line.startsWith('# ')) {
      html += `<h1>${parseInline(line.substring(2))}</h1>`;
    } else if (line.startsWith('## ')) {
      html += `<h2>${parseInline(line.substring(3))}</h2>`;
    } else if (line.startsWith('### ')) {
      html += `<h3>${parseInline(line.substring(4))}</h3>`;
    } else {
      html += `<p>${parseInline(line)}</p>`;
    }
  }

  if (inBlockquote) html += '</blockquote>';
  if (inList) html += `</${listType}>`;

  return `
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: Arial, sans-serif; line-height: 1.6; margin: 40px; }
  h1 { color: #111; border-bottom: 2px solid #008080; padding-bottom: 8px; margin-top: 30px; }
  h2 { color: #008080; margin-top: 30px; border-bottom: 1px solid #ddd; padding-bottom: 5px; }
  h3 { color: #444; margin-top: 20px; }
  blockquote { border-left: 4px solid #008080; padding-left: 15px; color: #555; font-style: italic; background-color: #f9f9f9; padding-top: 8px; padding-bottom: 8px; margin: 15px 0; }
  li { margin-bottom: 8px; }
  b { font-weight: bold; }
  i { font-style: italic; }
  p { margin-bottom: 15px; }
  table { border-collapse: collapse; width: 100%; margin: 20px 0; }
  th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
  th { background-color: #f2f2f2; font-weight: bold; }
</style>
</head>
<body>
${html}
</body>
</html>`;
}

async function uploadAsGoogleDoc({ accessToken, fileContent, name, parentId }) {
  const buf = Buffer.from(fileContent, 'utf8');
  const metadata = {
    name,
    mimeType: 'application/vnd.google-apps.document',
    parents: parentId ? [parentId] : undefined
  };
  const initBody = JSON.stringify(metadata);

  // Step 1: Initiate Resumable Upload Session
  const sessionUri = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'www.googleapis.com',
        path: '/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,parents,webViewLink',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': 'text/html',
          'X-Upload-Content-Length': buf.length,
          'Content-Length': Buffer.byteLength(initBody)
        }
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          if (res.statusCode === 200 && res.headers.location) {
            return resolve(res.headers.location);
          }
          reject(new Error(`Resumable init returned HTTP ${res.statusCode}: ${d}`));
        });
      }
    );
    req.on('error', reject);
    req.write(initBody);
    req.end();
  });

  // Step 2: Upload the HTML content
  return new Promise((resolve, reject) => {
    const u = new URL(sessionUri);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'PUT',
        headers: {
          'Content-Type': 'text/html',
          'Content-Length': buf.length
        }
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(d));
            } catch {
              resolve({});
            }
          } else {
            reject(new Error(`Resumable PUT returned HTTP ${res.statusCode}: ${d}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

(async () => {
  console.log('Resolving credentials...');
  const creds = resolveCreds();
  const accessToken = await getAccessToken(creds);

  const inputPath = path.resolve(INPUT_PATH);
  console.log(`Reading source file from ${inputPath}...`);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file does not exist at path: ${inputPath}`);
  }
  const mdContent = fs.readFileSync(inputPath, 'utf8');

  console.log('Converting Markdown to formatted HTML...');
  const htmlContent = markdownToHtml(mdContent);

  console.log(`Uploading and converting to Google Doc: "${DOC_NAME}"...`);
  const r = await uploadAsGoogleDoc({
    accessToken,
    fileContent: htmlContent,
    name: DOC_NAME,
    parentId: PARENT_ID
  });

  console.log('\n================================================================');
  console.log('Google Doc successfully created!');
  console.log('File Name:    ', r.name);
  console.log('File ID:      ', r.id);
  console.log('WebView Link: ', r.webViewLink);
  console.log('================================================================\n');
})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
