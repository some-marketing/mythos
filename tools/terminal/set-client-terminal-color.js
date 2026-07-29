#!/usr/bin/env node
'use strict';

/**
 * set-client-terminal-color.js — apply a client's configured terminal background colour.
 *
 * Reads clients/<CODE>/config/ui.json -> terminal_background and applies it to the
 * current terminal window. This is the durable mechanism behind the operator rule
 * "when I work on client X, strictly set the terminal to X's colour."
 *
 * Ecosystem-aware (per the plan-for-any-ecosystem kernel rule): the apply path is
 * selected from $TERM_PROGRAM. Apple_Terminal uses AppleScript (osascript); iTerm.app
 * uses an OSC 11 escape sequence. Other terminals warn rather than guess.
 *
 * Usage:
 *   node tools/terminal/set-client-terminal-color.js --client ACME [--print]
 *   node tools/terminal/set-client-terminal-color.js --client ACME --get   # read current bg (Apple_Terminal only)
 *
 * Config shape (clients/<CODE>/config/ui.json):
 *   {
 *     "terminal_background": {
 *       "hex": "#2E3440",
 *       "apple_terminal_rgb16": [11822, 13364, 16448]   // authoritative for Terminal.app
 *     }
 *   }
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function parseArgs(argv) {
  const a = { client: null, get: false, print: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--client') a.client = argv[++i];
    else if (argv[i] === '--get') a.get = true;
    else if (argv[i] === '--print') a.print = true;
  }
  return a;
}

function hexToRgb16(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r8 = (n >> 16) & 0xff, g8 = (n >> 8) & 0xff, b8 = n & 0xff;
  return [r8 * 257, g8 * 257, b8 * 257]; // 8-bit -> 16-bit
}

function loadColor(client) {
  const cfgPath = path.join(PROJECT_ROOT, 'clients', client, 'config', 'ui.json');
  if (!fs.existsSync(cfgPath)) {
    throw new Error(`No ui.json for client ${client} at ${cfgPath}`);
  }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const tb = cfg.terminal_background || {};
  let rgb16 = tb.apple_terminal_rgb16;
  if (!rgb16 && tb.hex) rgb16 = hexToRgb16(tb.hex);
  if (!rgb16) throw new Error(`ui.json for ${client} has no terminal_background.apple_terminal_rgb16 or .hex`);
  return { rgb16, hex: tb.hex || null, cfgPath };
}

function getAppleTerminalBg() {
  const out = execFileSync('osascript', ['-e', 'tell application "Terminal" to get background color of front window'], { encoding: 'utf8' });
  return out.trim();
}

function applyColor(rgb16) {
  const term = process.env.TERM_PROGRAM || '';
  const [r, g, b] = rgb16;
  if (term === 'Apple_Terminal') {
    execFileSync('osascript', ['-e', `tell application "Terminal" to set background color of front window to {${r}, ${g}, ${b}}`]);
    return `Apple_Terminal: set front window background to {${r}, ${g}, ${b}}`;
  }
  if (term === 'iTerm.app') {
    const to8 = (v) => Math.round(v / 257);
    const hex = '#' + [to8(r), to8(g), to8(b)].map((v) => v.toString(16).padStart(2, '0')).join('');
    process.stdout.write(`]11;${hex}`);
    return `iTerm.app: emitted OSC 11 set to ${hex}`;
  }
  return `WARNING: TERM_PROGRAM='${term}' not supported for auto-set. No change made. Colour for reference: rgb16 {${r}, ${g}, ${b}}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.client) {
    console.error('Usage: node tools/terminal/set-client-terminal-color.js --client <CODE> [--get] [--print]');
    process.exit(2);
  }
  if (args.get) {
    console.log(getAppleTerminalBg());
    return;
  }
  const { rgb16, hex } = loadColor(args.client);
  if (args.print) {
    console.log(JSON.stringify({ client: args.client, rgb16, hex }));
    return;
  }
  const result = applyColor(rgb16);
  console.log(`[${args.client}] ${result}`);
}

main();
