#!/usr/bin/env node
import fs from "fs";
import path from "path";

function die(msg){
  console.error(msg);
  process.exit(1);
}

function mkdirp(p){ fs.mkdirSync(p, {recursive:true}); }

function readJson(p){
  try{ return JSON.parse(fs.readFileSync(p, "utf-8")); }catch{ return null; }
}

function safeCopyFile(src, dest){
  try{
    if(!src || !dest) return false;
    if(!fs.existsSync(src)) return false;
    mkdirp(path.dirname(dest));
    fs.copyFileSync(src, dest);
    return true;
  }catch{
    return false;
  }
}

function parseArgs(argv){
  const out = {};
  for(let i=2;i<argv.length;i++){
    const k = argv[i];
    if(k === "-h" || k === "--help"){ out.help = true; continue; }
    if(!k.startsWith("--")) continue;
    const eq = k.indexOf("=");
    if(eq !== -1){
      const key = k.slice(2, eq);
      const val = k.slice(eq + 1);
      out[key] = val === "" ? true : val;
      continue;
    }
    const key = k.slice(2);
    const val = (argv[i+1] && !argv[i+1].startsWith("--")) ? argv[++i] : true;
    out[key] = val;
  }
  return out;
}

function tsCompactZ(d=new Date()){
  const iso = d.toISOString(); // 2026-01-26T17:02:00.000Z
  return iso.replace(/\.\d{3}Z$/, "Z").replace(/:/g, "");
}

function stableStringify(v){
  // Small, stable representation for diffing (not intended for pretty output).
  if(v == null) return "";
  if(typeof v === "string") return v;
  if(typeof v === "number" || typeof v === "boolean") return String(v);
  try{
    return JSON.stringify(v);
  }catch{
    return String(v);
  }
}

function flattenJson(value, prefix="", out=new Map()){
  const key = String(prefix || "").trim();
  if(value == null){
    if(key) out.set(key, null);
    return out;
  }
  const t = typeof value;
  if(t !== "object"){
    if(key) out.set(key, value);
    return out;
  }
  if(Array.isArray(value)){
    if(key) out.set(key, value);
    return out;
  }
  const entries = Object.entries(value);
  if(!entries.length){
    if(key) out.set(key, value);
    return out;
  }
  for(const [k, v] of entries){
    const next = key ? `${key}.${k}` : k;
    flattenJson(v, next, out);
  }
  return out;
}

function diffPayloads(expected, actual){
  const exp = flattenJson(expected);
  const act = flattenJson(actual);
  const missing = [];
  const extra = [];
  const mismatched = [];

  for(const [k, v] of exp.entries()){
    if(!act.has(k)){
      missing.push({path:k, expected: stableStringify(v)});
      continue;
    }
    const a = act.get(k);
    const eS = stableStringify(v);
    const aS = stableStringify(a);
    if(eS !== aS){
      mismatched.push({path:k, expected: eS, actual: aS});
    }
  }
  for(const [k, v] of act.entries()){
    if(!exp.has(k)){
      extra.push({path:k, actual: stableStringify(v)});
    }
  }

  const sortByPath = (a,b)=>String(a.path).localeCompare(String(b.path));
  missing.sort(sortByPath);
  extra.sort(sortByPath);
  mismatched.sort(sortByPath);

  return {
    counts: {
      expected_paths: exp.size,
      actual_paths: act.size,
      missing: missing.length,
      extra: extra.length,
      mismatched: mismatched.length
    },
    missing,
    extra,
    mismatched
  };
}

function collapseWs(s){
  return String(s || "").replace(/\s+/g, " ").trim();
}

function normalizePhone(s){
  const digits = String(s || "").replace(/[^0-9]/g, "");
  // Normalize to last 10 if it looks like +1XXXXXXXXXX.
  if(digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

function normalizeBool(s){
  const v = String(s || "").trim().toLowerCase();
  if(["yes","y","true","1"].includes(v)) return "yes";
  if(["no","n","false","0"].includes(v)) return "no";
  return v;
}

function normalizeNumberish(s){
  const v = String(s || "").trim();
  if(!v) return "";
  const cleaned = v.replace(/[$,\s]/g, "");
  return cleaned;
}

function normalizeDateLoose(s){
  const v = String(s || "").trim();
  if(!v) return "";
  // Common CRM export format: "15, 6, 1990"
  // WPForms export format: "15/6/1990"
  const nums = v.match(/\d+/g);
  if(!nums || nums.length < 3) return v.toLowerCase();
  const a = parseInt(nums[0], 10);
  const b = parseInt(nums[1], 10);
  const c = parseInt(nums[2], 10);
  if(!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return v.toLowerCase();
  let day = a, month = b, year = c;
  // If first number can't be a day, assume month/day/year.
  if(a <= 12 && b > 12){
    month = a; day = b; year = c;
  }
  // If year is first in some formats (rare), handle.
  if(a > 1900 && c <= 31){
    year = a; month = b; day = c;
  }
  const yyyy = String(year).padStart(4, "0");
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeValue(fieldLabel, raw){
  const label = String(fieldLabel || "").toLowerCase();
  const v = collapseWs(raw);
  if(!v) return "";
  if(label.includes("what type of vehicle") || label.includes("looking for")){
    // WPForms label values can be like "I want a Car" while CRM stores "car".
    const lowered = v.toLowerCase();
    const stripped = lowered.replace(/^i want a\s+/, "").trim();
    return stripped;
  }
  if(label.includes("other income sources")){
    // CRM often stores option values like "SecondJob" while WPForms exports "Second Job".
    return v.toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  if(label.includes("phone") || label.includes("telephone")) return normalizePhone(v);
  if(label.includes("date of birth") || label.includes("dob") || label.includes("birthdate")) return normalizeDateLoose(v);
  if(label.includes("gross pay") || label.includes("amount") || label.includes("payment") || label.includes("score") || label.includes("value")) return normalizeNumberish(v);
  return normalizeBool(v);
}

// RFC4180-ish CSV parser: handles quoted fields, escaped quotes, and newlines inside quotes.
function parseCsv(text){
  const s = String(text || "");
  // Strip BOM if present
  const input = s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for(let i=0;i<input.length;i++){
    const c = input[i];
    if(inQuotes){
      if(c === "\""){
        const next = input[i+1];
        if(next === "\""){
          field += "\"";
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if(c === "\""){
      inQuotes = true;
      continue;
    }
    if(c === ","){
      row.push(field);
      field = "";
      continue;
    }
    if(c === "\n"){
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if(c === "\r"){
      const next = input[i+1];
      if(next === "\n"){
        // handled on next iteration
        continue;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += c;
  }

  if(field.length || row.length){
    row.push(field);
    rows.push(row);
  }
  return rows.filter(r => r.some(v => String(v || "").trim() !== ""));
}

function normHeader(s){
  return String(s || "").trim().toLowerCase();
}

function indexHeader(headerRow){
  const idx = {};
  for(let i=0;i<headerRow.length;i++){
    const k = normHeader(headerRow[i]);
    if(!k) continue;
    if(idx[k] == null) idx[k] = i;
  }
  return idx;
}

function lower(s){ return String(s || "").trim().toLowerCase(); }

function findRowsByEmail(rows, emailIdx, email){
  const target = lower(email);
  const hits = [];
  for(const r of rows){
    const v = r[emailIdx] ?? "";
    if(lower(v) === target) hits.push(r);
  }
  return hits;
}

function pickRowNewestByDate(rows, dateIdx){
  if(!rows.length) return null;
  if(dateIdx == null) return rows[0];
  let best = rows[0];
  let bestT = Date.parse(rows[0][dateIdx] || "") || 0;
  for(const r of rows.slice(1)){
    const t = Date.parse(r[dateIdx] || "") || 0;
    if(t >= bestT){
      best = r;
      bestT = t;
    }
  }
  return best;
}

function readText(p){
  return fs.readFileSync(p, "utf-8");
}

function parseJsonFromText(text){
  const s = String(text || "").trim();
  if(!s) return null;
  // Try fenced code blocks first (```json ...``` or ``` ...```).
  const fencedJson = s.match(/```json\s*([\s\S]*?)```/i) || s.match(/```\s*([\s\S]*?)```/);
  if(fencedJson && fencedJson[1]){
    const body = fencedJson[1].trim();
    try{ return JSON.parse(body); }catch{}
  }
  // Try whole-text JSON next.
  try{ return JSON.parse(s); }catch{}
  // Last resort: attempt to extract the first {...} block.
  const firstObj = s.match(/\{[\s\S]*\}/);
  if(firstObj && firstObj[0]){
    try{ return JSON.parse(firstObj[0]); }catch{}
  }
  return null;
}

function loadJsonFlexible(p){
  if(!p || !fs.existsSync(p)) return null;
  const raw = readText(p);
  return parseJsonFromText(raw);
}

function readCsvFile(p){
  const rows = parseCsv(readText(p));
  if(rows.length < 2) return null;
  return {
    header: rows[0],
    rows: rows.slice(1),
    idx: indexHeader(rows[0])
  };
}

function resolveCrmHeader(crmIdx, mapping){
  const raw = String(mapping || "").trim();
  if(!raw) return null;
  const candidates = [];
  candidates.push(raw);
  candidates.push(`crd99_${raw}`);
  if(raw.startsWith("clienta_")) candidates.push(`crd99_${raw}`);
  // Some contracts use core field names without crd99_ prefix.
  if(raw === "emailaddress1") candidates.push("crd99_emailaddress1");
  if(raw === "telephone1") candidates.push("crd99_telephone1");
  if(raw === "firstname") candidates.push("crd99_firstname");
  if(raw === "lastname") candidates.push("crd99_lastname");
  if(raw === "middlename") candidates.push("crd99_middlename");
  if(raw === "createdon") candidates.push("createdon");

  for(const c of candidates){
    const k = normHeader(c);
    if(crmIdx[k] != null) return c;
  }
  return null;
}

function stripParen(s){
  return String(s || "").replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
}

function resolveWpHeader(wpHeader, wpIdx, formField){
  const raw = String(formField || "").trim();
  if(!raw) return null;

  // Contract "Address" should map to the WPForms line1 subfield, not the address group label.
  if(normHeader(raw) === "address"){
    const candidates = ["address: address line 1", "address: address line1", "address: address1", "address: street"];
    for(const c of candidates){
      const k = normHeader(c);
      if(wpIdx[k] != null) return wpHeader[wpIdx[k]];
    }
  }

  const aliases = {
    "name (first)": "name: first",
    "name (last)": "name: last",
    "name (middle)": "name: middle",
    "co-signer?": "cosigner?",
    "gross pay amount": "gross pay amount (for selected pay frequency)",
    "employment duration": "employment duration",
    "how long have you been working there?": "employment duration",
    "previous employer": "previous employer"
  };
  const norm = normHeader(raw);
  if(aliases[norm]){
    const aliasNorm = normHeader(aliases[norm]);
    if(wpIdx[aliasNorm] != null) return wpHeader[wpIdx[aliasNorm]];
  }

  if(wpIdx[norm] != null) return wpHeader[wpIdx[norm]];

  const stripped = normHeader(stripParen(raw));
  if(stripped && wpIdx[stripped] != null) return wpHeader[wpIdx[stripped]];

  // Fuzzy contains match: pick the shortest header that contains the field label or vice versa.
  let best = null;
  let bestLen = Infinity;
  for(const h of wpHeader){
    const hn = normHeader(h);
    if(!hn) continue;
    if(hn.includes(norm) || norm.includes(hn) || hn.includes(stripped) || stripped.includes(hn)){
      const score = hn.length;
      if(score < bestLen){
        best = h;
        bestLen = score;
      }
    }
  }
  return best;
}

function deriveWpOtherIncomeSources(wpHeader, row){
  const prefixes = [
    "other income sources:",
    "other income sources"
  ];
  const hits = [];
  for(let i=0;i<wpHeader.length;i++){
    const h = String(wpHeader[i] || "");
    const hn = normHeader(h);
    if(!prefixes.some(p => hn.startsWith(p))) continue;
    const val = collapseWs(row[i] ?? "");
    if(!val) continue;
    hits.push(val);
  }
  // If the column contains the option label itself (e.g. "Second Job"), just return unique values.
  return Array.from(new Set(hits.map(v => collapseWs(v)))).filter(Boolean).join(", ");
}

function unquoteExpected(v){
  const s = String(v ?? "").trim();
  if(!s) return "";
  if((s.startsWith("\"") && s.endsWith("\"")) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  if(s.startsWith("`") && s.endsWith("`")) return s.slice(1, -1);
  return s;
}

// Parse EXPECTED_OUTCOMES.md tables containing "Field Key | Label | Type | Expected Value"
function parseExpectedOutcomesMd(mdText){
  const text = String(mdText || "");
  const lines = text.split("\n");
  const out = [];
  let inTable = false;
  let cols = null;

  for(const line of lines){
    const l = line.trimEnd();
    if(!l.trim()){
      inTable = false;
      cols = null;
      continue;
    }
    if(!l.trimStart().startsWith("|")) continue;

    const parts = l.split("|").slice(1, -1).map(s => s.trim());
    if(parts.length < 4) continue;

    const headerNorm = parts.map(p => normHeader(p));
    const isHeader = headerNorm.includes("field key") && headerNorm.includes("expected value");
    if(isHeader){
      inTable = true;
      cols = {
        key: headerNorm.indexOf("field key"),
        label: headerNorm.indexOf("label"),
        type: headerNorm.indexOf("type"),
        expected: headerNorm.indexOf("expected value")
      };
      continue;
    }
    if(!inTable || !cols) continue;

    // separator row like |---|---|
    if(parts.every(p => /^-+$/.test(p))) continue;

    const key = unquoteExpected(parts[cols.key] ?? "");
    const label = parts[cols.label] ?? "";
    const type = parts[cols.type] ?? "";
    const expected = parts[cols.expected] ?? "";
    if(!key || !label) continue;

    out.push({
      key: String(key).trim(),
      label: String(label).trim(),
      type: String(type).trim(),
      expected_raw: String(expected).trim(),
      expected: unquoteExpected(expected)
    });
  }

  // Stable order: first appearance wins for duplicates.
  const seen = new Set();
  return out.filter(r => {
    const k = normHeader(r.key);
    if(seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function expectedValueForEnv(exp, meta){
  const fromDoc = unquoteExpected(exp.expected_raw ?? exp.expected ?? "");
  if(fromDoc && !/[{][A-Z_]+[}]/.test(fromDoc)) return fromDoc;
  const v = meta?.test_identity?.[exp.key];
  if(v == null) return fromDoc || "";
  // If expected_outcomes uses placeholders (rare), allow resolving via meta.
  const env = String(meta?.environment || "").trim();
  const iterMatch = String(meta?.runset_id || "").match(/run_(\d+)/);
  const iter = iterMatch ? String(parseInt(iterMatch[1], 10)) : "";
  return String(fromDoc || v)
    .replaceAll("{ENV}", env)
    .replaceAll("{RUN_ITERATION}", iter);
}

function findFieldInLocatorMap(locatorMap, key){
  const k = String(key || "").trim();
  if(!k) return null;
  for(const p of (locatorMap?.pages || [])){
    for(const f of (p.fields || [])){
      if(String(f.key || "").trim() === k) return f;
    }
  }
  return null;
}

function summarizeExpectedOutcomes({testcaseId, runsetId, wpformsPath, crmPath, outFiles, expectedResults}){
  const lines = [];
  lines.push(`# Expected Outcomes Compare — ${testcaseId} / ${runsetId}`);
  lines.push("");
  lines.push(`- generated_at_utc: ${tsCompactZ()}`);
  lines.push(`- wpforms_export: \`${wpformsPath}\``);
  lines.push(`- crm_export: \`${crmPath}\``);
  lines.push(`- compare_json: \`${outFiles.json}\``);
  lines.push("");
  lines.push("| env | email | expected_fields | failures | schema_missing |");
  lines.push("|---|---|---:|---:|---:|");
  for(const r of expectedResults){
    lines.push(`| ${r.env} | \`${r.email}\` | ${r.counts.expected_fields} | ${r.counts.failures} | ${r.counts.schema_missing} |`);
  }
  lines.push("");
  for(const r of expectedResults){
    if(!r.failures.length) continue;
    lines.push(`## ${r.env} failures`);
    for(const f of r.failures.slice(0, 50)){
      const where = [f.automation_status ? `automation=${f.automation_status}` : null, f.wpforms_status ? `wpforms=${f.wpforms_status}` : null, f.crm_status ? `crm=${f.crm_status}` : null]
        .filter(Boolean)
        .join(", ");
      lines.push(`- ${f.key} (${f.label}): expected="${f.expected_norm}" (${where})`);
    }
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

function summarizeContractCompare({testcaseId, runsetId, wpformsPath, crmPath, outFiles, envResults}){
  const lines = [];
  lines.push(`# Backend Contract Compare — ${testcaseId} / ${runsetId}`);
  lines.push("");
  lines.push(`- generated_at_utc: ${tsCompactZ()}`);
  lines.push(`- wpforms_export: \`${wpformsPath}\``);
  lines.push(`- crm_export: \`${crmPath}\``);
  lines.push(`- compare_json: \`${outFiles.json}\``);
  lines.push("");
  lines.push("| env | email | fields.matched | fields.mismatched | fields.skipped | system.matched | system.mismatched | system.skipped |");
  lines.push("|---|---|---:|---:|---:|---:|---:|---:|");
  for(const r of envResults){
    lines.push(`| ${r.env} | \`${r.email}\` | ${r.fields.matched} | ${r.fields.mismatched} | ${r.fields.skipped} | ${r.system.matched} | ${r.system.mismatched} | ${r.system.skipped} |`);
  }
  lines.push("");
  for(const r of envResults){
    if(!r.mismatches.length && !r.systemMismatches.length) continue;
    lines.push(`## ${r.env} mismatches`);
    for(const m of r.mismatches.slice(0, 20)){
      lines.push(`- field: ${m.form_field} → crm: ${m.crm_field} (wp="${m.wp_norm}" crm="${m.crm_norm}")`);
    }
    for(const m of r.systemMismatches.slice(0, 20)){
      lines.push(`- system: ${m.system_field} → crm: ${m.crm_field} (expected="${m.expected_norm}" crm="${m.crm_norm}")`);
    }
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

function listEnvDirs(runsetDir){
  return fs.readdirSync(runsetDir, {withFileTypes:true})
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(n => n !== "derived" && n !== "exports");
}

function summarizeMatch({testcaseId, runsetId, wpformsPath, crmPath, envMatches}){
  const lines = [];
  lines.push(`# Backend Export Match — ${testcaseId} / ${runsetId}`);
  lines.push("");
  lines.push(`- generated_at_utc: ${tsCompactZ()}`);
  lines.push(`- wpforms_export: \`${wpformsPath}\``);
  lines.push(`- crm_export: \`${crmPath}\``);
  lines.push("");
  lines.push("| env | email | token | wpforms_row | crm_row |");
  lines.push("|---|---|---|---:|---:|");
  for(const m of envMatches){
    lines.push(`| ${m.env} | \`${m.email}\` | \`${m.token}\` | ${m.wpforms.match_count} | ${m.crm.match_count} |`);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("- `wpforms_row` and `crm_row` are counts of rows whose email matches exactly (case-insensitive).");
  lines.push("- If counts are >1, the newest WPForms row is picked using `date_submitted` when present; CRM rows are not time-sorted.");
  return lines.join("\n") + "\n";
}

const args = parseArgs(process.argv);
if(args.help){
  console.log(`
Compare WPForms + CRM exports against the expected emails/tokens for a runset.

Usage:
  node runner/tools/compare-backend-exports.js \\
    --testcase <TESTCASE_ID> \\
    --runset_id <RUNSET_ID> \\
    --wpforms_export <path/to/wpforms.csv> \\
    --crm_export <path/to/crm.csv> \\
    [--expected_payload_json <path/to/expected_payload.json>] \\
    [--actual_payload_json <path/to/actual_payload.json>] \\
    [--sent_payload_json <path/to/sent_payload.json|sent_payload.md>] \\
    [--sent_payload_dir <dir_with_payload_files>]

Notes:
  - If you omit --sent_payload_json/--sent_payload_dir and a folder exists at:
      playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/exports/sent_payload/
    this tool will auto-load all *.json/*.md payload files from that folder.
  - Recommended filenames for per-env payloads (stored in the folder above):
      sent_payload__A.json, sent_payload__B.json, sent_payload__C.json
`.trim());
  process.exit(0);
}

const testcaseId = args.testcase || args.testcase_id || args["testcase-id"];
const runsetId = args.runset_id || args["runset-id"];
const wpformsPath = args.wpforms_export || args["wpforms-export"];
const crmPath = args.crm_export || args["crm-export"];
if(!testcaseId) die("--testcase required");
if(!runsetId) die("--runset_id required");
if(!wpformsPath) die("--wpforms_export required");
if(!crmPath) die("--crm_export required");
if(!fs.existsSync(wpformsPath)) die(`Missing wpforms_export: ${wpformsPath}`);
if(!fs.existsSync(crmPath)) die(`Missing crm_export: ${crmPath}`);

const runsetDir = path.join("testcases", String(testcaseId), "runs", String(runsetId));
if(!fs.existsSync(runsetDir)) die(`Missing runset folder: ${runsetDir}`);

const fieldsContractPath = args.fields_contract || args["fields-contract"] || path.join("testcases", String(testcaseId), "fields_mapped_to_crm.csv");
const systemContractPath = args.system_contract || args["system-contract"] || path.join("testcases", String(testcaseId), "system_fields_mapped_to_crm.csv");
const hasFieldsContract = !!(fieldsContractPath && fs.existsSync(fieldsContractPath));
const hasSystemContract = !!(systemContractPath && fs.existsSync(systemContractPath));

const expectedOutcomesPath = args.expected_outcomes || args["expected-outcomes"] || path.join("testcases", String(testcaseId), "EXPECTED_OUTCOMES.md");
const hasExpectedOutcomes = !!(expectedOutcomesPath && fs.existsSync(expectedOutcomesPath));
const locatorMapPath = args.locator_map || args["locator-map"] || path.join("testcases", String(testcaseId), "locator_map.json");
const hasLocatorMap = !!(locatorMapPath && fs.existsSync(locatorMapPath));

const expectedPayloadPath =
  args.expected_payload_json ||
  args["expected-payload-json"] ||
  path.join("testcases", String(testcaseId), "expected_payload.json");
const actualPayloadPath =
  args.actual_payload_json ||
  args["actual-payload-json"] ||
  path.join("testcases", String(testcaseId), "actual_payload.json");
const hasExpectedPayload = !!(expectedPayloadPath && fs.existsSync(expectedPayloadPath));
const hasActualPayload = !!(actualPayloadPath && fs.existsSync(actualPayloadPath));

let sentPayloadPath = args.sent_payload_json || args["sent-payload-json"] || null;
let sentPayloadDir = args.sent_payload_dir || args["sent-payload-dir"] || null;
if(!sentPayloadPath && !sentPayloadDir){
  const autoDir = path.join(runsetDir, "exports", "sent_payload");
  if(fs.existsSync(autoDir)) sentPayloadDir = autoDir;
}

const envDirs = listEnvDirs(runsetDir);
if(!envDirs.length) die(`No env run folders found under: ${runsetDir}`);

const wp = readCsvFile(wpformsPath);
const crm = readCsvFile(crmPath);
if(!wp) die("WPForms export parse produced <2 rows (header + data).");
if(!crm) die("CRM export parse produced <2 rows (header + data).");

const wpEmailIdx = wp.idx["email"];
const crmEmailIdx = crm.idx["crd99_emailaddress1"];
if(wpEmailIdx == null) die("WPForms export: could not find header column 'Email'.");
if(crmEmailIdx == null) die("CRM export: could not find header column 'crd99_emailaddress1'.");

const wpDateIdx = wp.idx["date_submitted"] ?? null;

const envMatches = [];
const envContractResults = [];

let fieldsContract = null;
let systemContract = null;
if(hasFieldsContract){
  const c = readCsvFile(fieldsContractPath);
  if(c) fieldsContract = c;
}
if(hasSystemContract){
  const c = readCsvFile(systemContractPath);
  if(c) systemContract = c;
}

const locatorMap = hasLocatorMap ? readJson(locatorMapPath) : null;
const expectedOutcomes = hasExpectedOutcomes ? parseExpectedOutcomesMd(readText(expectedOutcomesPath)) : [];

// Index field contract by normalized form label to CRM mapping target
const fieldsContractByFormLabel = new Map();
if(fieldsContract){
  const fcIdx = fieldsContract.idx;
  const colForm = fcIdx[normHeader("Form Field")];
  const colCrm = fcIdx[normHeader("Dynamics CRM Mapping")];
  for(const r of fieldsContract.rows){
    const formField = colForm != null ? r[colForm] : null;
    const crmMap = colCrm != null ? r[colCrm] : null;
    if(!formField || !crmMap) continue;
    const k = normHeader(formField);
    if(!k) continue;
    if(!fieldsContractByFormLabel.has(k)) fieldsContractByFormLabel.set(k, String(crmMap));
  }
}

for(const dir of envDirs){
  const metaPath = path.join(runsetDir, dir, "run.meta.json");
  const meta = readJson(metaPath);
  if(!meta) continue;
  const env = String(meta.environment || "").trim() || dir.split("-")[0] || dir;
  const email = meta.test_identity?.email || "";
  const token = meta.runner?.token || meta.token || "";

  const wpHits = findRowsByEmail(wp.rows, wpEmailIdx, email);
  const wpPicked = pickRowNewestByDate(wpHits, wpDateIdx);
  const crmHits = findRowsByEmail(crm.rows, crmEmailIdx, email);

  envMatches.push({
    env,
    dir,
    email,
    token,
    wpforms: {match_count: wpHits.length, picked: wpPicked ? true : false},
    crm: {match_count: crmHits.length}
  });

  // Value-level contract checks (if contracts exist and we have a WPForms + CRM row to compare).
  if(wpPicked && crmHits.length){
    const crmPicked = crmHits[0];
    const mismatches = [];
    const systemMismatches = [];

    let fieldsMatched = 0, fieldsMismatched = 0, fieldsSkipped = 0;
    if(fieldsContract){
      const fcHeader = fieldsContract.header;
      const fcIdx = fieldsContract.idx;
      const colForm = fcIdx[normHeader("Form Field")];
      const colCrm = fcIdx[normHeader("Dynamics CRM Mapping")];
      for(const r of fieldsContract.rows){
        const formField = colForm != null ? r[colForm] : null;
        const crmMap = colCrm != null ? r[colCrm] : null;
        const crmHeaderName = resolveCrmHeader(crm.idx, crmMap);
        if(!crmHeaderName){ fieldsSkipped++; continue; }

        const ffNorm = normHeader(formField);
        let wpHeaderName = null;
        let wpRaw = "";
        if(ffNorm === "other income sources"){
          // WPForms exports this as multiple option-specific columns.
          wpHeaderName = "(derived: other income sources)";
          wpRaw = deriveWpOtherIncomeSources(wp.header, wpPicked);
        } else {
          wpHeaderName = resolveWpHeader(wp.header, wp.idx, formField);
          if(wpHeaderName){
            const idx = wp.idx[normHeader(wpHeaderName)];
            wpRaw = idx != null ? (wpPicked[idx] ?? "") : "";
          } else {
            fieldsSkipped++;
            continue;
          }
        }

        const crmIdxCol = crm.idx[normHeader(crmHeaderName)];
        if(crmIdxCol == null){ fieldsSkipped++; continue; }
        const crmRaw = crmPicked[crmIdxCol] ?? "";

        const wpNorm = normalizeValue(String(formField || wpHeaderName || ""), wpRaw);
        const crmNorm = normalizeValue(String(formField || crmHeaderName || ""), crmRaw);

        if(!wpNorm && !crmNorm){
          fieldsSkipped++;
          continue;
        }

        // Address: allow CRM to contain WP line1 (some CRMs concatenate).
        const isAddress = normHeader(formField).startsWith("address");
        const ok = isAddress ? (lower(crmNorm).includes(lower(wpNorm)) || lower(wpNorm).includes(lower(crmNorm))) : (wpNorm === crmNorm);
        if(ok){
          fieldsMatched++;
        } else {
          fieldsMismatched++;
          mismatches.push({
            form_field: String(formField || ""),
            wp_field: String(wpHeaderName || ""),
            crm_field: String(crmHeaderName || ""),
            wp_norm: wpNorm,
            crm_norm: crmNorm
          });
        }
      }
    }

    let systemMatched = 0, systemMismatched = 0, systemSkipped = 0;
    if(systemContract){
      const scIdx = systemContract.idx;
      const colSys = scIdx[normHeader("System Field")];
      const colCrm = scIdx[normHeader("Dynamics CRM Mapping")];
      for(const r of systemContract.rows){
        const sysField = colSys != null ? r[colSys] : null;
        const crmMap = colCrm != null ? r[colCrm] : null;
        const crmHeaderName = resolveCrmHeader(crm.idx, crmMap);
        if(!crmHeaderName){ systemSkipped++; continue; }

        const crmIdxCol = crm.idx[normHeader(crmHeaderName)];
        if(crmIdxCol == null){ systemSkipped++; continue; }
        const crmRaw = crmPicked[crmIdxCol] ?? "";

        const sysNorm = normHeader(sysField);
        let expectedRaw = "";
        if(["utm source","utm medium","utm campaign","utm content","gclid","fbclid","msclkid","first touch","last touch"].includes(sysNorm)){
          expectedRaw = token;
        } else if(["referrer url","landing page"].includes(sysNorm)){
          // Not deterministic across envs; only verify domain presence if present.
          const v = collapseWs(crmRaw);
          if(!v){ systemSkipped++; continue; }
          const ok = Boolean(meta.site) && v.includes(String(meta.site));
          if(ok) systemMatched++;
          else {
            systemMismatched++;
            systemMismatches.push({
              system_field: String(sysField || ""),
              crm_field: String(crmHeaderName || ""),
              expected_norm: "(contains site domain)",
              crm_norm: collapseWs(crmRaw)
            });
          }
          continue;
        } else {
          systemSkipped++;
          continue;
        }

        const expectedNorm = normalizeValue(String(sysField || ""), expectedRaw);
        const crmNorm = normalizeValue(String(sysField || ""), crmRaw);
        if(!crmNorm){
          // Deterministic system fields should not be empty if they're part of the contract.
          systemMismatched++;
          systemMismatches.push({
            system_field: String(sysField || ""),
            crm_field: String(crmHeaderName || ""),
            expected_norm: expectedNorm,
            crm_norm: ""
          });
          continue;
        }
        if(expectedNorm === crmNorm){
          systemMatched++;
        } else {
          systemMismatched++;
          systemMismatches.push({
            system_field: String(sysField || ""),
            crm_field: String(crmHeaderName || ""),
            expected_norm: expectedNorm,
            crm_norm: crmNorm
          });
        }
      }
    }

    envContractResults.push({
      env,
      dir,
      email,
      token,
      fields: {matched: fieldsMatched, mismatched: fieldsMismatched, skipped: fieldsSkipped},
      system: {matched: systemMatched, mismatched: systemMismatched, skipped: systemSkipped},
      mismatches,
      systemMismatches
    });
  }
}

const outDir = path.join(runsetDir, "exports", "compare");
mkdirp(outDir);

const stamp = tsCompactZ();
const outMd = path.join(outDir, `compare__${runsetId}__backend-export-match__${stamp}.md`);
const outJson = path.join(outDir, `compare__${runsetId}__backend-export-match__${stamp}.json`);
fs.writeFileSync(outMd, summarizeMatch({testcaseId, runsetId, wpformsPath, crmPath, envMatches}), "utf-8");
fs.writeFileSync(outJson, JSON.stringify({
  testcase_id: String(testcaseId),
  runset_id: String(runsetId),
  generated_at_utc: stamp,
  inputs: {wpforms_export: wpformsPath, crm_export: crmPath},
  matches: envMatches
}, null, 2), "utf-8");

console.log(`Wrote ${outMd}`);
console.log(`Wrote ${outJson}`);

// Payload expectations (expected vs actual) — optional but useful for reporting/handoff.
if(hasExpectedPayload && hasActualPayload){
  const expectedPayload = loadJsonFlexible(expectedPayloadPath);
  const actualPayload = loadJsonFlexible(actualPayloadPath);
  if(expectedPayload && actualPayload){
    const diff = diffPayloads(expectedPayload, actualPayload);

    const copiedExpected = safeCopyFile(
      expectedPayloadPath,
      path.join(outDir, `payload__expected__${runsetId}__${stamp}.json`)
    );
    const copiedActual = safeCopyFile(
      actualPayloadPath,
      path.join(outDir, `payload__actual__${runsetId}__${stamp}.json`)
    );

    const outPayloadJson = path.join(outDir, `compare__${runsetId}__payload-diff__${stamp}.json`);
    fs.writeFileSync(outPayloadJson, JSON.stringify({
      testcase_id: String(testcaseId),
      runset_id: String(runsetId),
      generated_at_utc: stamp,
      inputs: {
        expected_payload_json: expectedPayloadPath,
        actual_payload_json: actualPayloadPath
      },
      outputs: {
        copied_expected_payload_json: copiedExpected ? path.join(outDir, `payload__expected__${runsetId}__${stamp}.json`) : null,
        copied_actual_payload_json: copiedActual ? path.join(outDir, `payload__actual__${runsetId}__${stamp}.json`) : null
      },
      diff
    }, null, 2), "utf-8");

    const LIMIT = 60;
    const lines = [];
    lines.push(`# Payload Diff — ${runsetId}`);
    lines.push("");
    lines.push(`- testcase_id: ${String(testcaseId)}`);
    lines.push(`- generated_at_utc: ${stamp}`);
    lines.push("");
    lines.push("## Counts");
    lines.push(`- expected_paths: ${diff.counts.expected_paths}`);
    lines.push(`- actual_paths: ${diff.counts.actual_paths}`);
    lines.push(`- missing_paths: ${diff.counts.missing}`);
    lines.push(`- extra_paths: ${diff.counts.extra}`);
    lines.push(`- mismatched_paths: ${diff.counts.mismatched}`);
    lines.push("");
    lines.push("## Inputs");
    lines.push(`- expected_payload_json: ${expectedPayloadPath}`);
    lines.push(`- actual_payload_json: ${actualPayloadPath}`);
    lines.push("");
    if(copiedExpected || copiedActual){
      lines.push("## Copied into runset (for handoff)");
      if(copiedExpected) lines.push(`- payload__expected__${runsetId}__${stamp}.json`);
      if(copiedActual) lines.push(`- payload__actual__${runsetId}__${stamp}.json`);
      lines.push("");
    }

    function section(title, arr, fmt){
      lines.push(`## ${title}`);
      if(!arr.length){
        lines.push("- none");
        lines.push("");
        return;
      }
      const slice = arr.slice(0, LIMIT);
      for(const item of slice){
        lines.push(`- ${fmt(item)}`);
      }
      if(arr.length > LIMIT) lines.push(`- …and ${arr.length - LIMIT} more`);
      lines.push("");
    }

    section("Missing Paths (in expected, not in actual)", diff.missing, (i)=>`${i.path} (expected=${i.expected})`);
    section("Extra Paths (in actual, not in expected)", diff.extra, (i)=>`${i.path} (actual=${i.actual})`);
    section("Mismatched Paths", diff.mismatched, (i)=>`${i.path} (expected=${i.expected} actual=${i.actual})`);

    const outPayloadMd = path.join(outDir, `compare__${runsetId}__payload-diff__${stamp}.md`);
    fs.writeFileSync(outPayloadMd, lines.join("\n") + "\n", "utf-8");

    console.log(`Wrote ${outPayloadMd}`);
    console.log(`Wrote ${outPayloadJson}`);
  }
}

// Sent payload (per-run) compare — optional.
// Supports:
// - --sent_payload_json <file.json|file.md> (single object OR array of objects)
// - --sent_payload_dir <dir> (loads all *.json + *.md files; each can be object or array)
function loadSentPayloadObjects(){
  const objs = [];
  function addMany(v, source){
    if(v == null) return;
    if(Array.isArray(v)){
      for(const item of v){
        if(item && typeof item === "object" && !Array.isArray(item)) objs.push({obj:item, source});
      }
      return;
    }
    if(v && typeof v === "object" && !Array.isArray(v)){
      objs.push({obj:v, source});
    }
  }

  if(sentPayloadPath){
    const v = loadJsonFlexible(sentPayloadPath);
    addMany(v, sentPayloadPath);
  }
  if(sentPayloadDir && fs.existsSync(sentPayloadDir)){
    const entries = fs.readdirSync(sentPayloadDir, {withFileTypes:true})
      .filter(d=>d.isFile())
      .map(d=>d.name)
      .filter(n => n.toLowerCase().endsWith(".json") || n.toLowerCase().endsWith(".md"))
      .sort();
    for(const name of entries){
      const p = path.join(sentPayloadDir, name);
      const v = loadJsonFlexible(p);
      addMany(v, p);
    }
  }
  return objs;
}

function payloadEmail(payload){
  const e =
    payload?.crd99_emailaddress1 ??
    payload?.email ??
    payload?.Email ??
    payload?.emailaddress1 ??
    null;
  return lower(String(e || ""));
}

function resolvePayloadValue(payload, crmHeaderName){
  if(!payload || !crmHeaderName) return {ok:false, value:"", key_tried:null};
  const key = String(crmHeaderName);
  if(Object.prototype.hasOwnProperty.call(payload, key)) return {ok:true, value: payload[key], key_tried:key};
  // Try normalized key forms.
  const kLower = normHeader(key);
  for(const pk of Object.keys(payload)){
    if(normHeader(pk) === kLower) return {ok:true, value: payload[pk], key_tried: pk};
  }
  // Some mappings omit crd99_ prefix.
  if(!kLower.startsWith("crd99_")){
    const pref = `crd99_${key}`;
    if(Object.prototype.hasOwnProperty.call(payload, pref)) return {ok:true, value: payload[pref], key_tried: pref};
    const prefLower = normHeader(pref);
    for(const pk of Object.keys(payload)){
      if(normHeader(pk) === prefLower) return {ok:true, value: payload[pk], key_tried: pk};
    }
  }
  return {ok:false, value:"", key_tried:key};
}

const sentPayloadObjs = loadSentPayloadObjects();
if(sentPayloadObjs.length){
  const payloadByEmail = new Map();
  for(const {obj, source} of sentPayloadObjs){
    const e = payloadEmail(obj);
    if(!e) continue;
    // If multiple, keep the last one (prefer later files if a dir is provided).
    payloadByEmail.set(e, {payload: obj, source});
  }

  // Copy the sent payload inputs into runset exports/compare so handoff bundles include them.
  const sentCopyDir = path.join(outDir, "sent_payload_inputs");
  mkdirp(sentCopyDir);
  if(sentPayloadPath){
    safeCopyFile(sentPayloadPath, path.join(sentCopyDir, path.basename(sentPayloadPath)));
  }
  if(sentPayloadDir && fs.existsSync(sentPayloadDir)){
    const entries = fs.readdirSync(sentPayloadDir, {withFileTypes:true})
      .filter(d=>d.isFile())
      .map(d=>d.name)
      .filter(n => n.toLowerCase().endsWith(".json") || n.toLowerCase().endsWith(".md"));
    for(const name of entries){
      safeCopyFile(path.join(sentPayloadDir, name), path.join(sentCopyDir, name));
    }
  }

  const sentResults = [];

  for(const dir of envDirs){
    const metaPath = path.join(runsetDir, dir, "run.meta.json");
    const meta = readJson(metaPath);
    if(!meta) continue;
    const env = String(meta.environment || "").trim() || dir.split("-")[0] || dir;
    const email = lower(meta.test_identity?.email || "");
    const token = meta.runner?.token || meta.token || "";

    const crmHits = findRowsByEmail(crm.rows, crmEmailIdx, email);
    const crmPicked = crmHits.length ? crmHits[0] : null;

    const sentRec = payloadByEmail.get(email) || null;
    const payload = sentRec?.payload || null;
    const payloadSource = sentRec?.source || null;

    const payloadVsCrm = {
      counts: {payload_fields: 0, matched: 0, mismatched: 0, missing_in_crm_export: 0},
      mismatches: [],
      missing_in_crm_export: []
    };

    if(payload && crmPicked){
      const keys = Object.keys(payload);
      payloadVsCrm.counts.payload_fields = keys.length;
      for(const k of keys){
        const crmHeader = (() => {
          const kk = normHeader(k);
          // Find exact header (case-insensitive) in CRM export.
          for(const hdr of Object.keys(crm.idx)){
            if(normHeader(hdr) === kk) return hdr;
          }
          return null;
        })();

        if(!crmHeader){
          payloadVsCrm.counts.missing_in_crm_export++;
          payloadVsCrm.missing_in_crm_export.push({payload_key: k});
          continue;
        }

        const idx = crm.idx[normHeader(crmHeader)];
        const crmRaw = idx != null ? (crmPicked[idx] ?? "") : "";
        const payloadRaw = payload[k];
        const crmNorm = normalizeValue(k, crmRaw);
        const payloadNorm = normalizeValue(k, payloadRaw);
        if(crmNorm === payloadNorm){
          payloadVsCrm.counts.matched++;
        } else {
          payloadVsCrm.counts.mismatched++;
          payloadVsCrm.mismatches.push({
            key: k,
            crm_field: crmHeader,
            payload_norm: payloadNorm,
            crm_norm: crmNorm
          });
        }
      }
    }

    const expectedVsSent = {
      counts: {asserted_fields: 0, matched: 0, mismatched: 0, missing_in_payload: 0, missing_mapping: 0},
      mismatches: [],
      missing_in_payload: [],
      missing_mapping: []
    };

    if(payload && expectedOutcomes.length){
      for(const exp of expectedOutcomes){
        const expected = expectedValueForEnv(exp, meta);
        const expectedNorm = normalizeValue(exp.label || exp.key, expected);
        const contractMap = fieldsContractByFormLabel.get(normHeader(exp.label));
        if(!contractMap){
          expectedVsSent.counts.missing_mapping++;
          expectedVsSent.missing_mapping.push({key: exp.key, label: exp.label});
          continue;
        }
        const crmHeaderName = resolveCrmHeader(crm.idx, contractMap);
        if(!crmHeaderName){
          expectedVsSent.counts.missing_mapping++;
          expectedVsSent.missing_mapping.push({key: exp.key, label: exp.label, crm_map: contractMap});
          continue;
        }
        expectedVsSent.counts.asserted_fields++;

        const {ok, value} = resolvePayloadValue(payload, crmHeaderName);
        if(!ok){
          expectedVsSent.counts.missing_in_payload++;
          expectedVsSent.missing_in_payload.push({key: exp.key, label: exp.label, crm_field: crmHeaderName});
          continue;
        }
        const payloadNorm = normalizeValue(exp.label || exp.key, value);
        if(payloadNorm === expectedNorm){
          expectedVsSent.counts.matched++;
        } else {
          expectedVsSent.counts.mismatched++;
          expectedVsSent.mismatches.push({
            key: exp.key,
            label: exp.label,
            crm_field: crmHeaderName,
            expected_norm: expectedNorm,
            payload_norm: payloadNorm
          });
        }
      }
    }

    sentResults.push({
      env,
      dir,
      email,
      token,
      payload_found: !!payload,
      payload_source: payloadSource,
      crm_row_found: !!crmPicked,
      compares: {expected_vs_sent: expectedVsSent, sent_vs_crm: payloadVsCrm}
    });
  }

  const stamp2 = stamp;
  const outSentJson = path.join(outDir, `compare__${runsetId}__sent-payload__${stamp2}.json`);
  fs.writeFileSync(outSentJson, JSON.stringify({
    testcase_id: String(testcaseId),
    runset_id: String(runsetId),
    generated_at_utc: stamp2,
    inputs: {
      sent_payload_json: sentPayloadPath,
      sent_payload_dir: sentPayloadDir
    },
    env_results: sentResults
  }, null, 2), "utf-8");

  const lines = [];
  lines.push(`# Sent Payload Compare — ${runsetId}`);
  lines.push("");
  lines.push(`- testcase_id: ${String(testcaseId)}`);
  lines.push(`- generated_at_utc: ${stamp2}`);
  if(sentPayloadPath) lines.push(`- sent_payload_json: ${sentPayloadPath}`);
  if(sentPayloadDir) lines.push(`- sent_payload_dir: ${sentPayloadDir}`);
  lines.push("");
  lines.push("## Env results");
  for(const r of sentResults){
    lines.push(`### ${r.dir}`);
    lines.push(`- email: ${r.email}`);
    lines.push(`- token: ${r.token}`);
    lines.push(`- payload_found: ${r.payload_found ? "true" : "false"}`);
    if(r.payload_source) lines.push(`- payload_source: ${r.payload_source}`);
    lines.push(`- crm_row_found: ${r.crm_row_found ? "true" : "false"}`);
    const evs = r.compares.expected_vs_sent.counts;
    const svc = r.compares.sent_vs_crm.counts;
    lines.push(`- expected_vs_sent: asserted=${evs.asserted_fields} match=${evs.matched} mismatch=${evs.mismatched} missing_in_payload=${evs.missing_in_payload} missing_mapping=${evs.missing_mapping}`);
    lines.push(`- sent_vs_crm: payload_fields=${svc.payload_fields} match=${svc.matched} mismatch=${svc.mismatched} missing_in_crm_export=${svc.missing_in_crm_export}`);
    lines.push("");
  }

  const outSentMd = path.join(outDir, `compare__${runsetId}__sent-payload__${stamp2}.md`);
  fs.writeFileSync(outSentMd, lines.join("\n") + "\n", "utf-8");

  console.log(`Wrote ${outSentMd}`);
  console.log(`Wrote ${outSentJson}`);
}

if(envContractResults.length){
  const outContractJson = path.join(outDir, `compare__${runsetId}__mapping-contract__${stamp}.json`);
  fs.writeFileSync(outContractJson, JSON.stringify({
    testcase_id: String(testcaseId),
    runset_id: String(runsetId),
    generated_at_utc: stamp,
    inputs: {
      wpforms_export: wpformsPath,
      crm_export: crmPath,
      fields_contract: hasFieldsContract ? fieldsContractPath : null,
      system_contract: hasSystemContract ? systemContractPath : null
    },
    env_results: envContractResults
  }, null, 2), "utf-8");

  const outContractMd = path.join(outDir, `compare__${runsetId}__mapping-contract__${stamp}.md`);
  fs.writeFileSync(outContractMd, summarizeContractCompare({
    testcaseId,
    runsetId,
    wpformsPath,
    crmPath,
    outFiles: {json: outContractJson},
    envResults: envContractResults
  }), "utf-8");

  console.log(`Wrote ${outContractMd}`);
  console.log(`Wrote ${outContractJson}`);
}

// Expected-outcomes compare (identity/automation/WPForms/CRM) if we have EXPECTED_OUTCOMES.md and a locator_map.
if(expectedOutcomes.length){
  const expectedResults = [];
  for(const dir of envDirs){
    const metaPath = path.join(runsetDir, dir, "run.meta.json");
    const meta = readJson(metaPath);
    if(!meta) continue;
    const env = String(meta.environment || "").trim() || dir.split("-")[0] || dir;
    const email = meta.test_identity?.email || "";
    const token = meta.runner?.token || meta.token || "";

    const wpHits = findRowsByEmail(wp.rows, wpEmailIdx, email);
    const wpPicked = pickRowNewestByDate(wpHits, wpDateIdx);
    const crmHits = findRowsByEmail(crm.rows, crmEmailIdx, email);
    const crmPicked = crmHits.length ? crmHits[0] : null;

    const submitPath = path.join(runsetDir, dir, "evidence", "submit.result.json");
    const submit = fs.existsSync(submitPath) ? readJson(submitPath) : null;
    const checks = Array.isArray(submit?.checks) ? submit.checks : [];
    const checksByField = new Map();
    for(const c of checks){
      const k = String(c?.field || "").trim();
      if(!k) continue;
      if(!checksByField.has(k)) checksByField.set(k, c);
    }

    const failures = [];
    let schemaMissing = 0;
    for(const exp of expectedOutcomes){
      const expected = expectedValueForEnv(exp, meta);
      const expectedNorm = normalizeValue(exp.label || exp.key, expected);

      // Automation check (did we attempt/fill the expected key)
      const check = checksByField.get(exp.key) || null;
      const kind = check?.kind ? String(check.kind) : "";
      const automationStatus = check ? (kind.startsWith("skipped") ? "skipped" : (check.ok === false ? "error" : "ok")) : "missing_check";

      // WPForms value
      let wpHeaderName = null;
      let wpRaw = "";
      if(wpPicked){
        if(normHeader(exp.label) === "other income sources"){
          wpHeaderName = "(derived: other income sources)";
          wpRaw = deriveWpOtherIncomeSources(wp.header, wpPicked);
        } else {
          const labelForLookup = exp.label || findFieldInLocatorMap(locatorMap, exp.key)?.label_text || exp.key;
          wpHeaderName = resolveWpHeader(wp.header, wp.idx, labelForLookup);
          if(wpHeaderName){
            const idx = wp.idx[normHeader(wpHeaderName)];
            wpRaw = idx != null ? (wpPicked[idx] ?? "") : "";
          }
        }
      }

      let wpformsStatus = "no_row";
      let wpNorm = "";
      if(wpPicked){
        if(!wpHeaderName){
          wpformsStatus = "missing_header";
          schemaMissing++;
        } else {
          wpNorm = normalizeValue(exp.label || exp.key, wpRaw);
          wpformsStatus = wpNorm === expectedNorm ? "match" : "mismatch";
        }
      }

      // CRM value (use fields contract mapping by label if possible; otherwise schema_missing)
      let crmHeaderName = null;
      let crmRaw = "";
      let crmNorm = "";
      let crmStatus = "no_row";
      const hasCrmMapping = fieldsContractByFormLabel.has(normHeader(exp.label));
      if(crmPicked){
        const contractMap = fieldsContractByFormLabel.get(normHeader(exp.label));
        if(contractMap){
          crmHeaderName = resolveCrmHeader(crm.idx, contractMap);
        }
        if(crmHeaderName){
          const idx = crm.idx[normHeader(crmHeaderName)];
          crmRaw = idx != null ? (crmPicked[idx] ?? "") : "";
          crmNorm = normalizeValue(exp.label || exp.key, crmRaw);
          crmStatus = crmNorm === expectedNorm ? "match" : "mismatch";
        } else {
          crmStatus = "missing_mapping";
        }
      }

      // Default semantics (until EXPECTED_OUTCOMES adds explicit per-field CRM requirements):
      // - Expected outcomes ALWAYS assert form behavior (automation + WPForms export values).
      // - CRM checks are ONLY asserted when a mapping exists in fields_mapped_to_crm.csv for the label.
      const shouldFail =
        (automationStatus !== "ok") ||
        (wpformsStatus === "mismatch") ||
        (wpformsStatus === "missing_header") ||
        (hasCrmMapping && crmStatus === "mismatch");

      if(shouldFail){
        failures.push({
          key: exp.key,
          label: exp.label,
          expected_norm: expectedNorm,
          automation_status: automationStatus,
          submit_kind: kind || null,
          wpforms_status: wpformsStatus,
          wpforms_field: wpHeaderName,
          wpforms_norm: wpNorm,
          crm_status: crmStatus,
          crm_field: crmHeaderName,
          crm_norm: crmNorm,
          asserted_crm: hasCrmMapping ? true : false,
          token
        });
      }
    }

    expectedResults.push({
      env,
      dir,
      email,
      token,
      counts: {
        expected_fields: expectedOutcomes.length,
        failures: failures.length,
        schema_missing: schemaMissing
      },
      failures
    });
  }

  const outExpectedJson = path.join(outDir, `compare__${runsetId}__expected-outcomes__${stamp}.json`);
  fs.writeFileSync(outExpectedJson, JSON.stringify({
    testcase_id: String(testcaseId),
    runset_id: String(runsetId),
    generated_at_utc: stamp,
    inputs: {
      wpforms_export: wpformsPath,
      crm_export: crmPath,
      expected_outcomes: hasExpectedOutcomes ? expectedOutcomesPath : null,
      locator_map: hasLocatorMap ? locatorMapPath : null,
      fields_contract: hasFieldsContract ? fieldsContractPath : null
    },
    expected_fields: expectedOutcomes,
    env_results: expectedResults
  }, null, 2), "utf-8");

  const outExpectedMd = path.join(outDir, `compare__${runsetId}__expected-outcomes__${stamp}.md`);
  fs.writeFileSync(outExpectedMd, summarizeExpectedOutcomes({
    testcaseId,
    runsetId,
    wpformsPath,
    crmPath,
    outFiles: {json: outExpectedJson},
    expectedResults
  }), "utf-8");

  console.log(`Wrote ${outExpectedMd}`);
  console.log(`Wrote ${outExpectedJson}`);
}
