#!/usr/bin/env node
/**
 * walkthrough-ingest — turn a screen recording into a numbered procedure + Playwright skeleton.
 *
 * Usage:
 *   node tools/walkthrough-ingest/ingest.js <video-path-or-glob> [--out <dir>] [--slug <name>] [--fps <n>]
 *   node tools/walkthrough-ingest/ingest.js latest                     # most recent .mov in ~/Documents/Screenshots
 *
 * Pipeline:
 *   1. Resolve video path (literal, glob, or `latest`).
 *   2. ffmpeg → extract frames at <fps> per second (default 1).
 *   3. Hand the video to `gemini -p` for native video analysis.
 *   4. Write artifacts to <out> (default _dev/reports/analysis/walkthrough__<slug>__<date>.{md,json}).
 *
 * REVIEW_ONLY — no execution of the produced procedure.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help')) {
  console.log(`Usage: node ${path.relative(process.cwd(), __filename)} <video-path|"latest"> [--out DIR] [--slug NAME] [--fps N]`);
  process.exit(args.includes('--help') ? 0 : 1);
}

function getFlag(name, fallback) {
  const idx = args.indexOf(name);
  if (idx === -1) return fallback;
  return args[idx + 1];
}
const videoArg = args[0];
const outDir = path.resolve(getFlag('--out', '_dev/reports/analysis'));
const fps = Number(getFlag('--fps', '1'));
const slugOverride = getFlag('--slug', null);

function resolveLatest() {
  const dir = path.join(os.homedir(), 'Documents', 'Screenshots');
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    throw new Error(`Cannot list ${dir}: ${err.message}`);
  }
  const movs = entries.filter((n) => n.match(/\.(mov|mp4|m4v)$/i)).map((n) => path.join(dir, n));
  if (movs.length === 0) throw new Error(`No .mov/.mp4 in ${dir}`);
  movs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return movs[0];
}

let videoPath;
if (videoArg === 'latest') {
  videoPath = resolveLatest();
} else if (videoArg.includes('*') || videoArg.includes('?')) {
  const matches = execSync(`ls -1t ${videoArg} 2>/dev/null | head -1`, { encoding: 'utf8' }).trim();
  if (!matches) throw new Error(`No matches for glob: ${videoArg}`);
  videoPath = matches;
} else {
  videoPath = path.resolve(videoArg);
}

console.log(`[walkthrough-ingest] video: ${videoPath}`);

// macOS Documents folder is TCC-protected; copy through find→cp to /tmp first if direct read fails.
function ensureReadable(src) {
  try {
    fs.accessSync(src, fs.constants.R_OK);
    return src;
  } catch (_) {
    const dst = path.join('/tmp', `walkthrough-${Date.now()}-${path.basename(src).replace(/\s+/g, '_')}`);
    const dir = path.dirname(src);
    const base = path.basename(src);
    const r = spawnSync('find', [dir, '-name', base, '-exec', 'cp', '{}', dst, ';'], { stdio: 'inherit' });
    if (r.status !== 0 || !fs.existsSync(dst)) throw new Error(`Could not stage video to /tmp: ${src}`);
    console.log(`[walkthrough-ingest] staged via find→cp: ${dst}`);
    return dst;
  }
}

const stagedVideo = ensureReadable(videoPath);
const baseName = path.basename(stagedVideo, path.extname(stagedVideo));
const date = new Date().toISOString().slice(0, 10);
const slug = (slugOverride || baseName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// 1) Probe duration.
const probe = spawnSync('ffprobe', [
  '-v', 'error',
  '-show_entries', 'format=duration:stream=width,height',
  '-of', 'default=noprint_wrappers=1', stagedVideo,
], { encoding: 'utf8' });
const probeOut = probe.stdout || '';
const duration = Number((probeOut.match(/duration=([\d.]+)/) || [])[1] || 0);
const width = Number((probeOut.match(/width=(\d+)/) || [])[1] || 0);
const height = Number((probeOut.match(/height=(\d+)/) || [])[1] || 0);
console.log(`[walkthrough-ingest] duration=${duration}s, size=${width}x${height}`);

// 2) Extract frames for inspection / fallback.
const framesDir = path.join('/tmp', `walkthrough-frames-${slug}`);
fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });
spawnSync('ffmpeg', [
  '-y', '-i', stagedVideo,
  '-vf', `fps=${fps},scale=720:-1`,
  '-q:v', '3',
  path.join(framesDir, 'f_%03d.jpg'),
], { stdio: 'inherit' });
const frameCount = fs.readdirSync(framesDir).length;
console.log(`[walkthrough-ingest] frames: ${frameCount} in ${framesDir}`);

// 3) Dispatch video to Gemini.
const prompt = `Analyze this screen recording: @${stagedVideo}

This is a recording of a manual workflow that an operator wants to automate.

Produce, in this exact order:

## 1. What's happening
One paragraph: the app, the goal, the surface (web, native).

## 2. Numbered procedure
Step-by-step actions in order — URL changes, clicks, dropdowns, typed values, scrolls. Cite approximate timestamps. Be terse.

## 3. Inputs and outputs
- Any forms / records / IDs selected (visible in dropdowns, lists, filenames).
- Final artifact file (name, format, size if visible).

## 4. Playwright automation skeleton
Numbered. For each step: target URL, selector strategy (CSS, role, or text), action. Include download-handler if a file is produced.

Be terse. No prose paragraphs beyond section 1. Output as markdown only — no preamble.`;

const mdOut = path.join(outDir, `walkthrough__${slug}__${date}.md`);
const jsonOut = path.join(outDir, `walkthrough__${slug}__${date}.json`);
fs.mkdirSync(outDir, { recursive: true });

console.log(`[walkthrough-ingest] dispatching to gemini (${duration}s video, this may take 30-90s)...`);
const gem = spawnSync('gemini', ['-p', prompt, '--yolo'], {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});
const stdout = gem.stdout || '';
const stderr = gem.stderr || '';

if (gem.status !== 0 || !stdout.trim()) {
  console.error('[walkthrough-ingest] gemini failed.');
  console.error(stderr.slice(0, 2000));
  process.exit(2);
}

// Strip noise (workspace warnings, leading "Strategic Recalibration").
const cleaned = stdout
  .replace(/Error executing tool [^\n]+\n/g, '')
  .replace(/YOLO mode is enabled\.[^\n]*\n/g, '')
  .replace(/Ripgrep is not available[^\n]*\n/g, '')
  .replace(/^---[\s\S]*?\*\*Strategic Recalibration:\*\*[^\n]*\n/m, '')
  .trim();

const header = `# Walkthrough Ingest — ${slug}

**Source video:** ${videoPath}
**Duration:** ${duration}s
**Resolution:** ${width}x${height}
**Frames extracted:** ${frameCount} → ${framesDir}
**Generated:** ${new Date().toISOString()}

---

`;
fs.writeFileSync(mdOut, header + cleaned + '\n');

const summary = {
  schema: 'WalkthroughIngest/1.0',
  generated_at: new Date().toISOString(),
  source_video: videoPath,
  staged_video: stagedVideo,
  frames_dir: framesDir,
  frame_count: frameCount,
  duration_seconds: duration,
  resolution: { width, height },
  slug,
  artifact_md: mdOut,
  gemini_output: cleaned,
};
fs.writeFileSync(jsonOut, JSON.stringify(summary, null, 2));

console.log(`[walkthrough-ingest] wrote: ${mdOut}`);
console.log(`[walkthrough-ingest] wrote: ${jsonOut}`);
