'use strict';

// tools/image-optimize/lib/adapters.cjs
//
// Vendor-agnostic encoder-adapter layer for the Mythos image-optimization
// standard (slice S0 — foundation only).
//
// Each adapter is a plain object:
//   {
//     id:            stable string id used in config + manifest
//     binary:        external command name, or null for a node-module adapter
//     is_available:  () => boolean   (mechanical detection: command -v / require.resolve)
//     version:       () => string    ("unknown" if not resolvable)
//     encode_webp:   ({ inputPath, outputPath, quality }) => { width, height }
//   }
//
// S0 keeps the encode surface minimal-but-real: every usable adapter exposes a
// single encode_webp() that produces an actual (smaller) WebP from a PNG. Full
// sizing tiers / transparency policy / AVIF / pngquant routing are S1 and are
// deliberately NOT implemented here. Adapters whose binary/module is absent
// (pngquant, imagemagick on this machine) report is_available()===false and
// never throw at detection time.
//
// No vendor is hard-coded into the engine: the engine consumes this registry by
// id, ordered by the operator-configured preference (config.json / env).

const { execFileSync } = require('child_process');
const fs = require('fs');

// Mechanical binary detection via `command -v` in a shell. Returns the resolved
// path string, or null. Never throws.
function whichBinary(name) {
  try {
    const out = execFileSync('/bin/sh', ['-c', `command -v ${name}`], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    return out || null;
  } catch {
    return null;
  }
}

// Mechanical node-module detection via require.resolve. Returns true/false.
function moduleResolvable(name) {
  try {
    require.resolve(name);
    return true;
  } catch {
    return false;
  }
}

function safeVersion(fn) {
  try {
    return fn() || 'unknown';
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// cwebp adapter (external binary, purpose-built WebP encoder)
// ---------------------------------------------------------------------------
const cwebpAdapter = {
  id: 'cwebp',
  binary: 'cwebp',
  is_available() {
    return whichBinary('cwebp') !== null;
  },
  version() {
    return safeVersion(() =>
      execFileSync('cwebp', ['-version'], { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim()
        .split('\n')[0]
    );
  },
  encode_webp({ inputPath, outputPath, quality }) {
    // -q quality, -mt multithread, -quiet. cwebp prints dims to stderr; we read
    // them back from the produced file via the sharp metadata helper if present,
    // else fall back to cwebp's own webpinfo-free path by re-decoding header.
    execFileSync(
      'cwebp',
      ['-q', String(quality), '-mt', '-quiet', inputPath, '-o', outputPath],
      { stdio: ['ignore', 'ignore', 'ignore'] }
    );
    return readWebpDimensions(outputPath);
  },
};

// ---------------------------------------------------------------------------
// sharp adapter (node module, no external binary)
// ---------------------------------------------------------------------------
const sharpAdapter = {
  id: 'sharp',
  binary: null,
  is_available() {
    return moduleResolvable('sharp');
  },
  version() {
    return safeVersion(() => require('sharp/package.json').version);
  },
  encode_webp({ inputPath, outputPath, quality }) {
    const sharp = require('sharp');
    // sharp is async. encode_webp may return a promise; the engine awaits every
    // adapter's return value, so sync (cwebp) and async (sharp) adapters share
    // one engine path. Returns { width, height } once written.
    return sharp(inputPath)
      .webp({ quality })
      .toFile(outputPath)
      .then((info) => ({ width: info.width, height: info.height }));
  },
};

// ---------------------------------------------------------------------------
// avifenc adapter (external binary; AVIF output — NOT exercised by S0's WebP
// encode path, present so capability detection reports it; never sole asset per
// the standard, enforced in a later slice).
// ---------------------------------------------------------------------------
const avifencAdapter = {
  id: 'avifenc',
  binary: 'avifenc',
  is_available() {
    return whichBinary('avifenc') !== null;
  },
  version() {
    return safeVersion(() =>
      execFileSync('avifenc', ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim()
        .split('\n')[0]
    );
  },
  // S0: avifenc produces AVIF, not WebP. The minimal WebP encode path does not
  // route here. Declared unsupported-for-webp so the engine skips it when
  // producing the S0 WebP derivative even though it is "available".
  supports_webp: false,
  encode_webp() {
    throw new Error('avifenc does not produce WebP (S1 will route AVIF derivatives)');
  },
};

// ---------------------------------------------------------------------------
// pngquant adapter (external binary; absent on this machine -> unavailable)
// ---------------------------------------------------------------------------
const pngquantAdapter = {
  id: 'pngquant',
  binary: 'pngquant',
  is_available() {
    return whichBinary('pngquant') !== null;
  },
  version() {
    return safeVersion(() =>
      execFileSync('pngquant', ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim()
        .split('\n')[0]
    );
  },
  // pngquant quantizes PNGs; it does not emit WebP. Out of S0's WebP path.
  supports_webp: false,
  encode_webp() {
    throw new Error('pngquant produces quantized PNG, not WebP (S1 transparency fallback)');
  },
};

// ---------------------------------------------------------------------------
// imagemagick adapter (external binary `magick`/`convert`; absent here)
// ---------------------------------------------------------------------------
const imagemagickAdapter = {
  id: 'imagemagick',
  binary: 'magick',
  is_available() {
    return whichBinary('magick') !== null || whichBinary('convert') !== null;
  },
  version() {
    return safeVersion(() => {
      const bin = whichBinary('magick') ? 'magick' : 'convert';
      return execFileSync(bin, ['-version'], { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim()
        .split('\n')[0];
    });
  },
  encode_webp({ inputPath, outputPath, quality }) {
    const bin = whichBinary('magick') ? 'magick' : 'convert';
    const args =
      bin === 'magick'
        ? [inputPath, '-quality', String(quality), outputPath]
        : [inputPath, '-quality', String(quality), outputPath];
    execFileSync(bin, args, { stdio: ['ignore', 'ignore', 'ignore'] });
    return readWebpDimensions(outputPath);
  },
};

// Read WebP dimensions from the produced file. Uses a minimal synchronous
// header parse so the cwebp / imagemagick adapters stay fully synchronous and
// do not hard-depend on sharp (sharp's metadata API is async).
function readWebpDimensions(filePath) {
  return parseWebpHeaderDimensions(filePath);
}

// Minimal synchronous WebP dimension parser. Supports lossy (VP8 ), lossless
// (VP8L) and extended (VP8X) chunks — enough for S0 derivatives.
function parseWebpHeaderDimensions(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    return { width: 0, height: 0 };
  }
  const fourcc = buf.toString('ascii', 12, 16);
  if (fourcc === 'VP8 ') {
    // Lossy: dims at offset 26 (14-bit each).
    const width = buf.readUInt16LE(26) & 0x3fff;
    const height = buf.readUInt16LE(28) & 0x3fff;
    return { width, height };
  }
  if (fourcc === 'VP8L') {
    // Lossless: 14-bit width/height packed after the 0x2f signature byte at 21.
    const b0 = buf[21];
    const b1 = buf[22];
    const b2 = buf[23];
    const b3 = buf[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height };
  }
  if (fourcc === 'VP8X') {
    // Extended: 24-bit (value-1) width/height at offset 24 and 27.
    const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { width, height };
  }
  return { width: 0, height: 0 };
}

// Registry, keyed by id. Order here is only the *declaration* order; the
// effective preference comes from config/env in the engine.
const ALL_ADAPTERS = [
  cwebpAdapter,
  sharpAdapter,
  avifencAdapter,
  pngquantAdapter,
  imagemagickAdapter,
];

function adapterById(id) {
  return ALL_ADAPTERS.find((a) => a.id === id) || null;
}

// Capability snapshot for a set of adapters (defaults to all). Pure read.
function detectCapabilities(adapters = ALL_ADAPTERS) {
  return adapters.map((a) => ({
    id: a.id,
    binary: a.binary,
    available: !!a.is_available(),
    version: a.is_available() ? a.version() : null,
    supports_webp: a.supports_webp !== false,
  }));
}

module.exports = {
  ALL_ADAPTERS,
  adapterById,
  detectCapabilities,
  whichBinary,
  moduleResolvable,
  parseWebpHeaderDimensions,
  // exported individually for targeted tests
  cwebpAdapter,
  sharpAdapter,
  avifencAdapter,
  pngquantAdapter,
  imagemagickAdapter,
};
