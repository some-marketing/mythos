#!/usr/bin/env node
import fs from "fs";
import path from "path";
function die(m){ console.error(m); process.exit(1); }
function gatherJsonFiles() {
  const out = new Set();
  const add = (p) => out.add(path.normalize(p));

  const walkDir = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walkDir(p);
      else if (entry.isFile() && entry.name.endsWith(".json")) add(p);
    }
  };

  // Runner-local JSON (config/templates/etc.)
  walkDir("runner");

  // Testcases in the current project layout (preferred runtime location)
  walkDir("testcases");

  // If invoked from a repo root, allow scanning the canonical testcases location too
  walkDir(path.join("playwright_phased_runner", "testcases"));

  return Array.from(out).sort();
}

for (const p of gatherJsonFiles()) {
  try {
    JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch (e) {
    die(`Invalid JSON in ${p}: ${e}`);
  }
}
console.log("OK");
