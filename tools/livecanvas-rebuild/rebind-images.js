#!/usr/bin/env node
/**
 * rebind-images.js — resolve [liveCanvas-image-id: NNN] placeholders in
 * staged WP page content to actual attachment URLs and rewrite post_content.
 *
 * Usage:
 *   node tools/livecanvas-rebuild/rebind-images.js --client YOUR_SITE \
 *        --project current-site-analysis --env-script /path/to/your-env.sh \
 *        [--dry-run|--apply] [--post-id N]
 *
 * Requires --env-script <path>: a bash script that, when sourced, exports
 * SITE_ROOT (the wp-cli --path target) and anything else your wp-cli
 * invocation needs (DB creds, WP_CLI_CONFIG_PATH, etc). --client/--project
 * are free-form labels used only for console output and the report filename
 * — they don't resolve to any repo convention.
 */
'use strict';

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const args = { dryRun: true, apply: false, postId: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--client') args.client = argv[++i];
    else if (a === '--project') args.project = argv[++i];
    else if (a === '--dry-run') { args.dryRun = true; args.apply = false; }
    else if (a === '--apply') { args.dryRun = false; args.apply = true; }
    else if (a === '--post-id') args.postId = argv[++i];
    else if (a === '--env-script') args.envScript = argv[++i];
    else if (a === '--report-dir') args.reportDir = argv[++i];
    else if (a === '-h' || a === '--help') { args.help = true; }
    else throw new Error(`unknown arg: ${a}`);
  }
  return args;
}

function usage() {
  console.log(`Usage: rebind-images.js --client <label> --project <slug> --env-script <path> [--dry-run|--apply] [--post-id N]

  --client <label>    free-form label for console output / report filename
  --project <slug>    free-form label for console output / report filename
  --env-script <path> REQUIRED: bash script exporting SITE_ROOT (wp-cli --path target)
  --report-dir <path> where to write the run report (default: <env-script-dir>/outputs)
  --dry-run           (default) report changes without writing
  --apply             write resolved URLs to wp_posts.post_content via wp-cli
  --post-id N         restrict to a single page id
`);
}

// Run a bash command after sourcing the env wrapper. Returns stdout (trimmed).
function bash(envScript, command, opts = {}) {
  const wrapped = `set -euo pipefail; source "${envScript}" >/dev/null 2>&1; ${command}`;
  const res = spawnSync('bash', ['-c', wrapped], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
  if (res.status !== 0) {
    const err = new Error(`bash failed (exit ${res.status}): ${command}\nstderr: ${res.stderr}`);
    err.stdout = res.stdout;
    err.stderr = res.stderr;
    throw err;
  }
  // wp-cli emits PHP "Deprecated:" warnings to stdout on this site; strip them.
  return (res.stdout || '')
    .split('\n')
    .filter((l) => !l.startsWith('Deprecated:'))
    .join('\n')
    .trim();
}

const PLACEHOLDER_RE = /\[liveCanvas-image-id:\s*(\d+)\s*\]/g;
const GALLERY_PLACEHOLDER_RE = /\[liveCanvas-image-id:\s*gallery-(\d+)-item-(\d+)\s*\]/g;

function findPagesWithPlaceholders(envScript, postId) {
  const where = postId
    ? `ID=${Number(postId)}`
    : `post_type="page" AND post_status IN ("publish","draft","private") AND post_content LIKE "%[liveCanvas-image-id:%"`;
  const sql = `SELECT ID, post_title FROM wp_posts WHERE ${where}`;
  const out = bash(envScript, `wp --path="$SITE_ROOT" db query '${sql}' --skip-column-names`);
  if (!out) return [];
  return out.split('\n').map((line) => {
    const idx = line.indexOf('\t');
    return { id: Number(line.slice(0, idx)), title: line.slice(idx + 1) };
  });
}

function getPostContent(envScript, id) {
  // Use wp post get to safely retrieve raw content (no SQL escaping concerns).
  return bash(envScript, `wp --path="$SITE_ROOT" post get ${id} --field=post_content`);
}

function resolveAttachmentUrls(envScript, ids) {
  if (!ids.length) return new Map();
  const idList = ids.join(',');
  // Use wp post list with attachment_url fields.
  const out = bash(
    envScript,
    `wp --path="$SITE_ROOT" post list --post_type=attachment --post__in=${idList} --fields=ID,guid --format=csv`
  );
  const map = new Map();
  const lines = out.split('\n').filter((l) => l && !l.startsWith('ID,'));
  for (const line of lines) {
    const [id, guid] = line.split(',', 2);
    map.set(Number(id), guid);
  }
  return map;
}

function rebindContent(content, urlMap, galleryUrlMap) {
  const unresolved = [];
  let replacements = 0;
  // Gallery composite refs first (more specific match) — keys: "gallery-{id}-item-{n}"
  let next = content.replace(GALLERY_PLACEHOLDER_RE, (_match, gidStr, itemStr) => {
    const key = `gallery-${gidStr}-item-${itemStr}`;
    const url = galleryUrlMap.get(key);
    if (!url) { unresolved.push(key); return _match; }
    replacements++;
    return url;
  });
  // Then numeric refs
  next = next.replace(PLACEHOLDER_RE, (_match, idStr) => {
    const id = Number(idStr);
    const url = urlMap.get(id);
    if (!url) { unresolved.push(id); return _match; }
    replacements++;
    return url;
  });
  return { next, replacements, unresolved };
}

// Resolve gallery composite refs by reading thegem_gallery postmeta.
// Returns Map<"gallery-{id}-item-{n}", url>.
function resolveGalleryUrls(envScript, refs) {
  const map = new Map();
  if (!refs.length) return map;
  // Group by gallery id; for each, fetch postmeta thegem_gallery_images CSV,
  // then resolve the requested 1-indexed item to its attachment URL.
  const byGallery = new Map();
  for (const r of refs) {
    if (!byGallery.has(r.galleryId)) byGallery.set(r.galleryId, new Set());
    byGallery.get(r.galleryId).add(r.itemIndex);
  }
  // First pass: collect attachment ids needed across all galleries.
  const wanted = []; // [{ key, attachmentId }]
  for (const [gid, items] of byGallery.entries()) {
    const csv = bash(
      envScript,
      `wp --path="$SITE_ROOT" db query "SELECT meta_value FROM wp_postmeta WHERE post_id=${gid} AND meta_key='thegem_gallery_images'" --skip-column-names`
    );
    if (!csv) continue;
    const ids = csv.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
    for (const item of items) {
      const idx = item - 1; // 1-indexed in the placeholder
      const aid = ids[idx];
      if (aid) wanted.push({ key: `gallery-${gid}-item-${item}`, attachmentId: aid });
    }
  }
  if (!wanted.length) return map;
  // Resolve attachment ids → guids in one wp call.
  const aIds = [...new Set(wanted.map((w) => w.attachmentId))];
  const out = bash(
    envScript,
    `wp --path="$SITE_ROOT" post list --post_type=attachment --post__in=${aIds.join(',')} --fields=ID,guid --format=csv`
  );
  const guidMap = new Map();
  for (const line of out.split('\n').filter((l) => l && !l.startsWith('ID,'))) {
    const [id, guid] = line.split(',', 2);
    guidMap.set(Number(id), guid);
  }
  for (const w of wanted) {
    const url = guidMap.get(w.attachmentId);
    if (url) map.set(w.key, url);
  }
  return map;
}

function applyContent(envScript, id, content) {
  // Pipe content via stdin to avoid arg-length / shell-escape issues.
  const tmp = path.join(require('os').tmpdir(), `lmf-rebind-${id}-${Date.now()}.html`);
  fs.writeFileSync(tmp, content);
  try {
    bash(
      envScript,
      `wp --path="$SITE_ROOT" post update ${id} --post_content="$(cat "${tmp}")"`
    );
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { usage(); return; }
  if (!args.client || !args.project) { usage(); process.exit(2); }
  if (!args.envScript) {
    console.error('--env-script <path> is required: point it at a bash script that exports SITE_ROOT (and anything else your wp-cli invocation needs) before wp-cli runs.');
    usage();
    process.exit(2);
  }

  const envScript = args.envScript;
  if (!fs.existsSync(envScript)) {
    console.error(`env script not found: ${envScript}`);
    process.exit(2);
  }

  const mode = args.apply ? 'APPLY' : 'DRY-RUN';
  console.log(`[rebind-images] mode=${mode} client=${args.client} project=${args.project}`);
  console.log(`[rebind-images] env=${envScript}`);

  const pages = findPagesWithPlaceholders(envScript, args.postId);
  console.log(`[rebind-images] pages with placeholders: ${pages.length}`);
  if (!pages.length) return;

  // First pass: collect every referenced id across all pages, both numeric and
  // gallery-composite shapes.
  const idSet = new Set();
  const galleryRefSet = new Map(); // key -> {galleryId, itemIndex}
  const pageContents = new Map();
  for (const p of pages) {
    const c = getPostContent(envScript, p.id);
    pageContents.set(p.id, c);
    let m;
    PLACEHOLDER_RE.lastIndex = 0;
    while ((m = PLACEHOLDER_RE.exec(c)) !== null) idSet.add(Number(m[1]));
    GALLERY_PLACEHOLDER_RE.lastIndex = 0;
    while ((m = GALLERY_PLACEHOLDER_RE.exec(c)) !== null) {
      const key = `gallery-${m[1]}-item-${m[2]}`;
      if (!galleryRefSet.has(key)) {
        galleryRefSet.set(key, { galleryId: Number(m[1]), itemIndex: Number(m[2]) });
      }
    }
  }
  const ids = [...idSet].sort((a, b) => a - b);
  const galleryRefs = [...galleryRefSet.values()];
  console.log(`[rebind-images] unique numeric ids referenced: ${ids.length}`);
  console.log(`[rebind-images] unique gallery composites referenced: ${galleryRefs.length}`);

  const urlMap = resolveAttachmentUrls(envScript, ids);
  const galleryUrlMap = resolveGalleryUrls(envScript, galleryRefs);
  const missing = ids.filter((id) => !urlMap.has(id));
  const missingGalleries = galleryRefs
    .map((r) => `gallery-${r.galleryId}-item-${r.itemIndex}`)
    .filter((k) => !galleryUrlMap.has(k));
  console.log(`[rebind-images] numeric resolved=${urlMap.size} unresolved=${missing.length}`);
  console.log(`[rebind-images] gallery resolved=${galleryUrlMap.size} unresolved=${missingGalleries.length}`);
  if (missing.length) console.log(`[rebind-images] missing numeric ids: ${missing.join(',')}`);
  if (missingGalleries.length) console.log(`[rebind-images] missing gallery refs: ${missingGalleries.join(',')}`);

  // Per-page summary + (optional) apply.
  const summary = [];
  for (const p of pages) {
    const before = pageContents.get(p.id);
    const { next, replacements, unresolved } = rebindContent(before, urlMap, galleryUrlMap);
    summary.push({ id: p.id, title: p.title, replacements, unresolved });
    console.log(
      `  - ${p.id}\t${p.title}\treplacements=${replacements}\tunresolved=${unresolved.length}`
    );
    if (args.apply && replacements > 0) {
      applyContent(envScript, p.id, next);
    }
  }

  // Write report alongside the env script by default, or wherever --report-dir points.
  const reportDir = args.reportDir || path.join(path.dirname(envScript), 'outputs');
  try { fs.mkdirSync(reportDir, { recursive: true }); } catch (_) {}
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(reportDir, `rebind-images__${mode.toLowerCase()}__${ts}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({
    mode, client: args.client, project: args.project,
    pageCount: pages.length,
    uniqueIds: ids.length,
    resolvedIds: urlMap.size,
    missingIds: missing,
    uniqueGalleryRefs: galleryRefs.length,
    resolvedGalleryRefs: galleryUrlMap.size,
    missingGalleryRefs: missingGalleries,
    pages: summary,
  }, null, 2));
  console.log(`[rebind-images] report: ${reportPath}`);

  if (!args.apply) {
    console.log('[rebind-images] DRY-RUN — no DB writes. Re-run with --apply to commit.');
  }
}

main();
