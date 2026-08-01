#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'services.json'), 'utf8'));
const id = process.argv[2];
const service = catalog.services.find(row => row.id === id);
if (!service) {
  console.error(`Unknown portable launchd service: ${id || '<missing>'}`);
  process.exit(2);
}
const esc = value => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const label = `org.mythos.portable.${service.id}`;
const runner = path.join(ROOT, service.runner);
const state = path.join(ROOT, '_dev', 'state', 'launchd', service.id);
const interpreter = service.interpreter || 'node';
const trigger = service.watch_path
  ? `  <key>WatchPaths</key><array><string>${esc(path.join(ROOT, service.watch_path))}</string></array>`
  : `  <key>StartInterval</key><integer>${service.interval_seconds}</integer>`;
if (!fs.existsSync(runner)) {
  console.error(`Portable launchd runner does not exist: ${service.runner}`);
  process.exit(2);
}
if (!service.watch_path && (!Number.isInteger(service.interval_seconds) || service.interval_seconds < 1)) {
  console.error(`Portable launchd service lacks a valid trigger: ${service.id}`);
  process.exit(2);
}
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${esc(label)}</string>
  <key>ProgramArguments</key><array><string>/usr/bin/env</string><string>${esc(interpreter)}</string><string>${esc(runner)}</string></array>
  <key>WorkingDirectory</key><string>${esc(ROOT)}</string>
${trigger}
  <key>StandardOutPath</key><string>${esc(path.join(state, 'stdout.log'))}</string>
  <key>StandardErrorPath</key><string>${esc(path.join(state, 'stderr.log'))}</string>
</dict></plist>
`;
process.stdout.write(plist);
