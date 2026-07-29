#!/usr/bin/env node
/**
 * verify-finding-repair-loop.cjs
 *
 * Bounded verification script for the finding-repair-loop skill. Checks that a
 * PlanRepair/1.0 manifest (the artifact this skill writes on every repair_loop
 * branch) has the required shape before it's trusted as evidence of a real
 * repair iteration. Does not touch plan text, state markers, or dispatch
 * anything — read-only check.
 *
 * Usage:
 *   node verify-finding-repair-loop.cjs <path-to-repair-manifest.json>
 *
 * Exit codes:
 *   0 — manifest is well-formed
 *   1 — manifest missing, unreadable, or malformed JSON
 *   2 — manifest is missing one or more required fields
 */

const fs = require("fs");
const path = require("path");

const REQUIRED_FIELDS = [
  "schema_version",
  "repair_id",
  "plan_id",
  "plan_paths",
  "timestamp",
  "review_reference",
  "scope_identity",
  "fields_touched_json",
  "fields_touched_md",
  "pre_repair_hashes",
  "post_repair_hashes",
  "reason",
  "author_actor",
  "produced_by_harness_id",
  "validator_status",
];

function fail(msg, code) {
  console.error(`FAIL: ${msg}`);
  process.exit(code);
}

function main() {
  const target = process.argv[2];
  if (!target) {
    fail("usage: node verify-finding-repair-loop.cjs <path-to-repair-manifest.json>", 1);
  }

  const resolved = path.resolve(target);
  let raw;
  try {
    raw = fs.readFileSync(resolved, "utf8");
  } catch (err) {
    fail(`cannot read ${resolved}: ${err.message}`, 1);
  }

  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    fail(`invalid JSON in ${resolved}: ${err.message}`, 1);
  }

  const missing = REQUIRED_FIELDS.filter((field) => !(field in manifest));
  if (missing.length > 0) {
    fail(`${resolved} is missing required field(s): ${missing.join(", ")}`, 2);
  }

  if (manifest.schema_version !== "PlanRepair/1.0") {
    fail(
      `${resolved} declares schema_version="${manifest.schema_version}", expected "PlanRepair/1.0"`,
      2
    );
  }

  if (!manifest.reason || !Array.isArray(manifest.reason.findings_resolved)) {
    fail(`${resolved} reason.findings_resolved must be an array`, 2);
  }

  // A prose-only repair (no fields actually touched) defeats the point of the
  // manifest — the skill's own rule is "never produce a prose-only repair".
  const touchedNothing =
    (manifest.fields_touched_json || []).length === 0 &&
    (manifest.fields_touched_md || []).length === 0;
  if (touchedNothing) {
    fail(
      `${resolved} touched no fields in JSON or MD — a repair manifest must reflect a real edit, not a prose-only pass`,
      2
    );
  }

  console.log(`OK: ${resolved} is a well-formed PlanRepair/1.0 manifest (repair_id=${manifest.repair_id})`);
  process.exit(0);
}

main();
