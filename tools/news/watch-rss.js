#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--watch') args.watch = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--config') args.config = argv[++i];
    else if (arg === '--interval-seconds') args.intervalSeconds = Number(argv[++i]);
    else args._.push(arg);
  }
  return args;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, filePath);
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(new URL(url), {
      headers: {
        'User-Agent': 'Mythos news-watch/1.0 (+local operator monitor)',
        'Accept': 'application/atom+xml, application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        fetchText(new URL(res.headers.location, url).toString()).then(resolve, reject);
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    });
    req.setTimeout(15000, () => req.destroy(new Error(`timeout fetching ${url}`)));
    req.on('error', reject);
  });
}

function decodeXml(text) {
  return String(text || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function firstTag(block, tagNames) {
  for (const tag of tagNames) {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const m = block.match(re);
    if (m) return decodeXml(m[1]).trim();
  }
  return '';
}

function attrTag(block, tagName, attrName) {
  const re = new RegExp(`<${tagName}\\b([^>]*)>`, 'i');
  const m = block.match(re);
  if (!m) return '';
  const attr = new RegExp(`${attrName}=["']([^"']+)["']`, 'i').exec(m[1]);
  return attr ? decodeXml(attr[1]).trim() : '';
}

function parseFeed(feedId, xml) {
  const items = [];
  const itemRe = /<item\b[\s\S]*?<\/item>/gi;
  const entryRe = /<entry\b[\s\S]*?<\/entry>/gi;
  const blocks = xml.match(itemRe) || xml.match(entryRe) || [];
  for (const block of blocks) {
    let link = firstTag(block, ['link']);
    if (!link || link.includes('<')) link = attrTag(block, 'link', 'href');
    const title = firstTag(block, ['title']);
    const summary = firstTag(block, ['description', 'summary', 'content']);
    const published = firstTag(block, ['pubDate', 'published', 'updated']);
    const id = firstTag(block, ['guid', 'id']) || link || `${feedId}:${title}`;
    if (!title && !link) continue;
    items.push({ feed_id: feedId, id, title, link, summary, published });
  }
  return items;
}

function normalize(s) {
  return String(s || '').toLowerCase();
}

function itemText(item) {
  return normalize(`${item.title}\n${item.summary}\n${item.link}`);
}

function isRecentEnough(item, config) {
  if (!config.max_item_age_days) return true;
  if (!item.published) return true;
  const t = Date.parse(item.published);
  if (!Number.isFinite(t)) return true;
  const ageMs = Date.now() - t;
  return ageMs <= Number(config.max_item_age_days) * 24 * 60 * 60 * 1000;
}

function matchesConfig(item, config) {
  const text = itemText(item);
  const required = config.required_terms || [];
  const hasRequired = required.length === 0 || required.some((term) => text.includes(normalize(term)));
  const hasTrigger = (config.trigger_terms || []).some((term) => text.includes(normalize(term)));
  const hasRepoLike = !config.signal_requires_repo_like ||
    (config.repo_like_terms || []).some((term) => text.includes(normalize(term)));
  const hasNegative = (config.negative_terms || []).some((term) => text.includes(normalize(term)));
  return isRecentEnough(item, config) && hasRequired && hasTrigger && hasRepoLike && !hasNegative;
}

function safeStamp() {
  return new Date().toISOString().replace(/[:.]/g, '');
}

function writeReport(config, matches, errors) {
  const reportDir = path.resolve(PROJECT_ROOT, config.report_dir || '_dev/reports/news-watch');
  ensureDir(reportDir);
  const stamp = safeStamp();
  const base = path.join(reportDir, `${config.id}__${stamp}`);
  const jsonPath = `${base}.json`;
  const mdPath = `${base}.md`;
  const payload = {
    schema: 'NewsWatchRun/1.0',
    timestamp: new Date().toISOString(),
    watch_id: config.id,
    matches,
    errors
  };
  writeJsonAtomic(jsonPath, payload);
  const lines = [
    `# News Watch: ${config.id}`,
    '',
    `- Timestamp: ${payload.timestamp}`,
    `- Matches: ${matches.length}`,
    `- Errors: ${errors.length}`,
    ''
  ];
  for (const match of matches) {
    lines.push(`## ${match.title || '(untitled)'}`);
    lines.push(`- Feed: ${match.feed_id}`);
    lines.push(`- Published: ${match.published || 'unknown'}`);
    lines.push(`- Link: ${match.link || 'unknown'}`);
    lines.push('');
  }
  if (errors.length) {
    lines.push('## Errors', '');
    for (const err of errors) lines.push(`- ${err.feed_id}: ${err.error}`);
    lines.push('');
  }
  fs.writeFileSync(mdPath, lines.join('\n'));
  return { jsonPath, mdPath };
}

function writeSignal(config, matches, reportPaths) {
  if (!matches.length) return null;
  const signalDir = path.join(PROJECT_ROOT, '_dev', 'reports', 'signals');
  ensureDir(signalDir);
  const safeScope = String(config.signal_scope || config.id).replace(/[^a-zA-Z0-9_.-]+/g, '-');
  const signalPath = path.join(signalDir, `news-watch__${safeScope.replace(/\//g, '-')}__${safeStamp()}.signal.json`);
  const signal = {
    schema: 'HandoffSignal/1.0',
    signal_type: 'coordination-request',
    lifecycle_state: 'live',
    timestamp: new Date().toISOString(),
    source: 'news-watch',
    scope: config.signal_scope || config.id,
    recommended_next_actor: config.signal_actor || 'codex',
    recommended_next_command: config.signal_command || '/review-source-material',
    topic: config.id,
    description: `RSS/Atom watch found ${matches.length} possible Cursor harness/source leak item(s). Review before acting.`,
    artifacts: [
      path.relative(PROJECT_ROOT, reportPaths.mdPath),
      path.relative(PROJECT_ROOT, reportPaths.jsonPath)
    ],
    decision_context_artifacts: [],
    blocked_by: [],
    next_step_detail: matches.map((m) => `${m.title} ${m.link}`.trim())
  };
  writeJsonAtomic(signalPath, signal);
  return signalPath;
}

async function runOnce(configPath, opts = {}) {
  const config = readJson(configPath, null);
  if (!config || config.schema !== 'NewsWatch/1.0') {
    throw new Error(`Invalid NewsWatch config: ${configPath}`);
  }
  const statePath = path.resolve(PROJECT_ROOT, config.state_path || `_dev/state/news-watch/${config.id}.seen.json`);
  const state = readJson(statePath, { schema: 'NewsWatchState/1.0', seen: {} });
  state.seen = state.seen || {};

  const errors = [];
  const matches = [];
  for (const feed of config.feeds || []) {
    try {
      const xml = await fetchText(feed.url);
      const items = parseFeed(feed.id, xml);
      for (const item of items) {
        const key = `${feed.id}:${item.id}`;
        if (state.seen[key]) continue;
        if (matchesConfig(item, config)) {
          state.seen[key] = {
            first_seen_at: new Date().toISOString(),
            title: item.title,
            link: item.link
          };
          matches.push(item);
        }
      }
    } catch (err) {
      errors.push({ feed_id: feed.id, error: err.message });
    }
  }
  state.updated_at = new Date().toISOString();
  writeJsonAtomic(statePath, state);
  const reportPaths = writeReport(config, matches, errors);
  const signalPath = writeSignal(config, matches, reportPaths);
  const result = {
    ok: errors.length === 0,
    watch_id: config.id,
    matches: matches.length,
    errors: errors.length,
    report: path.relative(PROJECT_ROOT, reportPaths.mdPath),
    signal: signalPath ? path.relative(PROJECT_ROOT, signalPath) : null
  };
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`news-watch ${config.id}: ${matches.length} match(es), ${errors.length} error(s)`);
    console.log(`report: ${result.report}`);
    if (result.signal) console.log(`signal: ${result.signal}`);
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv);
  const configPath = path.resolve(PROJECT_ROOT, args.config || '_dev/config/news-watch/cursor-harness-leak.json');
  const intervalSeconds = Number.isFinite(args.intervalSeconds) && args.intervalSeconds > 0
    ? args.intervalSeconds
    : 900;
  do {
    await runOnce(configPath, { json: args.json && !args.watch });
    if (!args.watch) break;
    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
  } while (true);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = { parseFeed, matchesConfig, runOnce };
