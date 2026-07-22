#!/usr/bin/env node
import fs from "fs";
import path from "path";

function die(message) {
  console.error(message);
  process.exit(1);
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function validateSuccessSelector(p, locatorMap) {
  const css = locatorMap?.submit?.success?.css;
  if (typeof css !== "string") return;

  const usesWpformsConfirmation =
    css.includes(".wpforms-confirmation-container") || css.includes("wpforms-confirmation");
  if (!usesWpformsConfirmation) return;

  const hasLeadFormsVariant = css.includes(".wpforms-confirmation-container-full");
  if (!hasLeadFormsVariant) {
    die(
      [
        `Invalid WPForms success selector (missing Lead Forms variant) in ${p}`,
        `- submit.success.css: ${css}`,
        `- expected to include: .wpforms-confirmation-container-full`,
      ].join("\n")
    );
  }
}

const roots = ["runner/locator_maps", "testcases"];
const files = [];

for (const root of roots) {
  if (!fs.existsSync(root)) continue;

  if (root === "runner/locator_maps") {
    for (const name of fs.readdirSync(root)) {
      if (!name.endsWith(".json")) continue;
      files.push(path.join(root, name));
    }
    continue;
  }

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const p = path.join(root, entry.name, "locator_map.json");
    if (fs.existsSync(p)) files.push(p);
  }
}

for (const p of files) {
  try {
    const locatorMap = readJson(p);
    validateSuccessSelector(p, locatorMap);
  } catch (e) {
    die(`Failed to parse ${p}: ${e}`);
  }
}

console.log("OK");

