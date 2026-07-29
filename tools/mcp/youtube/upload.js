#!/usr/bin/env node
'use strict';
//
// Upload a video to YouTube (default: unlisted). Returns the video id + URL as
// JSON so callers (e.g. the ads-approval-portal video bundle) can wire video_id.
//
// Usage (creds injected by run-with-op.sh):
//   tools/mcp/youtube/run-with-op.sh node tools/mcp/youtube/upload.js \
//     --file "clip.mp4" --title "Title" --description-file desc.txt
//   ... add --dry-run to validate args + metadata without creds or upload.
//
// Live mutation (publishes to the channel). Privacy defaults to unlisted.
//
const fs = require('fs');
const { loadYouTubeConfig, getEnv } = require('./config');
const { uploadVideo } = require('./client');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

(async () => {
  const filePath = arg('--file');
  const title = arg('--title');
  const descInline = arg('--description', '');
  const descFile = arg('--description-file');
  const privacy = arg('--privacy', 'unlisted');
  const dryRun = process.argv.includes('--dry-run');

  if (!filePath || !title) {
    console.error(
      'usage: --file <path> --title <t> [--description <d> | --description-file <path>]' +
        ' [--privacy unlisted|private|public] [--dry-run]'
    );
    process.exit(1);
  }
  if (!['unlisted', 'private', 'public'].includes(privacy)) {
    console.error(`--privacy must be unlisted|private|public (got: ${privacy})`);
    process.exit(1);
  }

  const description = descFile ? fs.readFileSync(descFile, 'utf8') : descInline;

  // In dry-run we don't need creds; construct a minimal config.
  let config;
  if (dryRun) {
    config = { dryRun: true };
  } else {
    config = loadYouTubeConfig();
  }

  try {
    const result = await uploadVideo(config, { filePath, title, description, privacyStatus: privacy });
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('[youtube-upload] ERROR:', e.message);
    process.exit(1);
  }
})();
