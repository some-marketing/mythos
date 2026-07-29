#!/usr/bin/env node
'use strict';

// tools/image-optimize/cli.cjs
//
// Mythos image-optimization standard — CLI entry point (slice S0).
//
// Subcommands:
//   check           Per-surface encoder-availability check (plan ADJ#2). Prints
//                   which adapters are available on THIS machine. Exits 0 if at
//                   least one usable WebP encoder exists, non-zero otherwise.
//   optimize        Minimal real WebP encode path (S0): produce a WebP per source
//                   via the first available adapter, idempotent by source sha256.
//   optimize-tiered Format/sizing POLICY engine (S1): tiered max-width caps
//                   (hero/content/thumb), never-upscale, WebP-primary lossy,
//                   mechanical alpha detection, strip metadata, tiered byte
//                   hard-fail caps (allowlistable), optional --also-avif.
//
// Usage:
//   node tools/image-optimize/cli.cjs check [--json]
//   node tools/image-optimize/cli.cjs optimize --src <dir|file> [--out <dir>]
//                                               [--manifest <path>] [--quality N]
//                                               [--config <path>] [--json]
//   node tools/image-optimize/cli.cjs optimize-tiered --src <dir|file>
//                                               [--tier hero|content|thumb]
//                                               [--out <dir>] [--manifest <path>]
//                                               [--quality N] [--also-avif]
//                                               [--allowlist <path>]
//                                               [--config <path>] [--json]
//
// Exit codes:
//   0  success
//   1  usage / runtime error
//   2  POLICY CAP FAIL — a derivative busts its tier byte cap and is not
//      allowlisted (S1 policy gate; distinct from S0's fail-closed code 3)
//   3  FAIL CLOSED — no usable encoder available
//
// S0 + S1. No deploy gate / framework wiring here (those are S2/S4).

const fs = require('fs');
const path = require('path');

const { detectCapabilities, ALL_ADAPTERS } = require('./lib/adapters.cjs');
const { optimize, resolveEncoderOrder, loadConfig } = require('./lib/engine.cjs');
const { optimizePolicy } = require('./lib/policy.cjs');

const DEFAULT_CONFIG = path.join(__dirname, 'config.json');
const DEFAULT_MANIFEST = path.join(__dirname, 'derivative-manifest.json');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function cmdCheck(args) {
  const config = loadConfig(args.config || DEFAULT_CONFIG);
  const order = resolveEncoderOrder({ config });
  const caps = detectCapabilities(ALL_ADAPTERS);
  const byId = new Map(caps.map((c) => [c.id, c]));

  // A surface is usable if at least one WebP-capable adapter in preference
  // order is available.
  const usable = order
    .map((id) => byId.get(id))
    .filter((c) => c && c.available && c.supports_webp);
  const ok = usable.length > 0;

  if (args.json) {
    process.stdout.write(
      JSON.stringify(
        {
          ok,
          encoder_order: order,
          selected: ok ? usable[0].id : null,
          adapters: caps,
        },
        null,
        2
      ) + '\n'
    );
  } else {
    process.stdout.write('image-optimize — encoder availability (this surface)\n');
    process.stdout.write(`  preference order: ${order.join(' > ')}\n`);
    for (const c of caps) {
      const mark = c.available ? 'AVAILABLE' : 'absent   ';
      const webp = c.supports_webp ? '' : ' (no-webp)';
      const ver = c.version ? ` ${c.version}` : '';
      process.stdout.write(`  [${mark}] ${c.id}${webp}${ver}\n`);
    }
    process.stdout.write(
      ok
        ? `  => OK: selected encoder "${usable[0].id}" (at least one usable WebP encoder present)\n`
        : '  => FAIL CLOSED: no usable WebP encoder present. Install cwebp / sharp / imagemagick.\n'
    );
  }
  return ok ? 0 : 3;
}

async function cmdOptimize(args) {
  if (!args.src) {
    process.stderr.write('image-optimize optimize: --src <dir|file> is required\n');
    return 1;
  }
  const srcPath = path.resolve(String(args.src));
  if (!fs.existsSync(srcPath)) {
    process.stderr.write(`image-optimize optimize: src not found: ${srcPath}\n`);
    return 1;
  }
  const outDir = path.resolve(String(args.out || path.join(path.dirname(srcPath), 'optimized')));
  const manifestPath = path.resolve(String(args.manifest || DEFAULT_MANIFEST));
  const quality = args.quality ? Number(args.quality) : undefined;
  const config = loadConfig(args.config || DEFAULT_CONFIG);

  let result;
  try {
    result = await optimize({
      srcPath,
      outDir,
      manifestPath,
      quality,
      config,
      now: () => new Date().toISOString(),
    });
  } catch (err) {
    if (err && err.code === 'NO_ENCODER') {
      process.stderr.write(err.message + '\n');
      return 3;
    }
    process.stderr.write(`image-optimize optimize: ${err.message}\n`);
    return 1;
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(
      `image-optimize: encoder=${result.encoder} (${result.encoder_version}) ` +
        `total=${result.total} encoded=${result.encoded} skipped=${result.skipped}\n`
    );
    for (const it of result.items) {
      if (it.action === 'encode') {
        process.stdout.write(`  encoded ${it.source} -> ${it.derivative} (${it.bytes} bytes)\n`);
      } else {
        process.stdout.write(`  skipped ${it.source} (derivative current)\n`);
      }
    }
    process.stdout.write(`  manifest: ${manifestPath}\n`);
  }
  return 0;
}

async function cmdOptimizeTiered(args) {
  if (!args.src) {
    process.stderr.write('image-optimize optimize-tiered: --src <dir|file> is required\n');
    return 1;
  }
  const srcPath = path.resolve(String(args.src));
  if (!fs.existsSync(srcPath)) {
    process.stderr.write(`image-optimize optimize-tiered: src not found: ${srcPath}\n`);
    return 1;
  }
  const outDir = path.resolve(String(args.out || path.join(path.dirname(srcPath), 'optimized')));
  const manifestPath = path.resolve(String(args.manifest || DEFAULT_MANIFEST));
  const quality = args.quality ? Number(args.quality) : undefined;
  const config = loadConfig(args.config || DEFAULT_CONFIG);
  const tier = args.tier ? String(args.tier) : undefined;
  const alsoAvif = !!args['also-avif'];
  const allowlistPath = args.allowlist ? path.resolve(String(args.allowlist)) : undefined;

  let result;
  try {
    result = await optimizePolicy({
      srcPath,
      outDir,
      manifestPath,
      tier,
      quality,
      alsoAvif,
      allowlistPath,
      config,
      now: () => new Date().toISOString(),
      log: (m) => { if (!args.json) process.stdout.write(m + '\n'); },
    });
  } catch (err) {
    if (err && (err.code === 'NO_RESIZE_ENCODER' || err.code === 'NO_ENCODER')) {
      process.stderr.write(err.message + '\n');
      return 3;
    }
    process.stderr.write(`image-optimize optimize-tiered: ${err.message}\n`);
    return 1;
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(
      `image-optimize (S1 policy): quality=${result.quality} also_avif=${result.also_avif} ` +
        `total=${result.total} encoded=${result.encoded} allowlisted=${result.allowlisted} failed=${result.failed}\n`
    );
    for (const it of result.items) {
      const avif = it.avif ? ` +avif` : '';
      const png = it.png_fallback ? ` +png` : '';
      const flag = it.status === 'fail' ? ' [CAP-FAIL]' : it.status === 'allowlisted' ? ' [ALLOWLISTED]' : '';
      process.stdout.write(
        `  ${it.status === 'fail' ? 'FAIL ' : 'ok   '}${it.source} ` +
          `[${it.tier}] ${it.source_dims} -> ${it.out_dims} ${it.bytes}B/${it.cap_bytes}B` +
          `${it.has_alpha ? ' alpha' : ''}${avif}${png}${flag}\n`
      );
    }
    process.stdout.write(`  manifest: ${manifestPath}\n`);
    if (!result.ok) {
      process.stdout.write(`  => POLICY CAP FAIL: ${result.failed} derivative(s) over cap without allowlist\n`);
    }
  }
  // Exit 2 on a policy cap fail (distinct from S0 fail-closed 3).
  return result.ok ? 0 : 2;
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));

  // Allow `--check-encoders` as an alias for the check subcommand.
  if (cmd === 'check' || cmd === '--check-encoders' || args['check-encoders']) {
    return cmdCheck(args);
  }
  if (cmd === 'optimize') {
    return cmdOptimize(args);
  }
  if (cmd === 'optimize-tiered') {
    return cmdOptimizeTiered(args);
  }

  process.stderr.write(
    'image-optimize (S0+S1)\n' +
      'Usage:\n' +
      '  node tools/image-optimize/cli.cjs check [--json]\n' +
      '  node tools/image-optimize/cli.cjs optimize --src <dir|file> [--out <dir>] [--manifest <path>] [--quality N] [--json]\n' +
      '  node tools/image-optimize/cli.cjs optimize-tiered --src <dir|file> [--tier hero|content|thumb] [--out <dir>]\n' +
      '                                                    [--manifest <path>] [--quality N] [--also-avif] [--allowlist <path>] [--json]\n'
  );
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`image-optimize: fatal: ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
