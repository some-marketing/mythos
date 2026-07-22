import fs from 'fs';
import path from 'path';

export function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

export function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

export function writeText(p, s) {
  mkdirp(path.dirname(p));
  fs.writeFileSync(p, s, 'utf-8');
}

export function writeJSON(p, o) {
  writeText(p, `${JSON.stringify(o, null, 2)}\n`);
}

