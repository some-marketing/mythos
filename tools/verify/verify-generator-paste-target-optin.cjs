#!/usr/bin/env node
/**
 * verify-generator-paste-target-optin.cjs — Forward-looking guard (F6).
 *
 * Scans every JS source file under tools/signals/ and tools/signals/lib/ for
 * fs.writeFileSync(<targetExpr>, ...) call sites. Classifies each target
 * expression against the include-glob shape signatures sourced AT RUNTIME
 * from tools/verify/lib/paste-target-prompt.cjs._internal.INCLUDE_GLOBS — no
 * hard-coded copy of the validator's include set.
 *
 * Policy (regex-based, NO AST dependency to avoid violating smallest-change):
 *   - For each target expression, attempt to resolve it to a literal/template
 *     string. If unresolvable, classify as 'unresolved' (treated as
 *     paste-target-shaped — fail-closed) UNLESS the file is on
 *     CHOKEPOINT_ALLOWLIST.
 *   - Variable resolution: look back up to 60 lines within the same file for
 *     the nearest `<name> = '...'` / `<name> = "..."` / `<name> = `...``
 *     assignment (or `const/let/var <name> = ...`).
 *   - A file passes iff EITHER (a) every paste-target-shaped target is
 *     accompanied by a require('.../paste-target-prompt.cjs') in the file,
 *     OR (b) the file path is on CHOKEPOINT_ALLOWLIST.
 *
 * Chokepoint-import assertion (R2 mitigation):
 *   - For each entry in CHOKEPOINT_ALLOWLIST, the script independently
 *     grep-asserts the validator import is still present in that file. If an
 *     allowlisted file has lost its validator import, emit
 *     `chokepoint_lost_validator_import` violation naming the file. The
 *     allowlist cannot silently mask validator-import removal.
 *
 * Env-var test hooks (used by F6 fixtures b and c only):
 *   MYTHOS_F6_EXTRA_SCAN_DIR  — comma-separated additional directories to scan
 *   MYTHOS_F6_EXTRA_ALLOWLIST — comma-separated additional CHOKEPOINT entries
 *
 * Usage: node tools/verify/verify-generator-paste-target-optin.cjs [project-root]
 * Exit code 0 = PASS, 1 = FAIL.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT_DEFAULT = path.resolve(__dirname, '../..');

const CHOKEPOINT_ALLOWLIST_BASE = [
  'tools/signals/lib/codex-bridge.js',
  'tools/signals/lib/dispatch-bridge.js'
];

const VALIDATOR_REQUIRE_RE =
  /require\([^)]*paste-target-prompt\.cjs[^)]*\)/;

// Strip line comments (`// ...`) and block comments (`/* ... */`) from a JS
// source while preserving string and template literal contents (so a `//` or
// `/*` inside a quoted string is NOT removed). Used so that a commented-out
// validator require does not satisfy the import detector.
function stripJsComments(source) {
  let out = '';
  const len = source.length;
  let i = 0;
  let inStr = null;
  let escape = false;
  while (i < len) {
    const c = source[i];
    const n = source[i + 1];
    if (escape) {
      out += c;
      escape = false;
      i += 1;
      continue;
    }
    if (inStr) {
      if (c === '\\') {
        out += c;
        escape = true;
        i += 1;
        continue;
      }
      if (c === inStr) inStr = null;
      out += c;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && n === '/') {
      // Line comment — skip until newline (preserve newline so line numbers
      // remain stable for any downstream regex line counters).
      i += 2;
      while (i < len && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && n === '*') {
      // Block comment — skip until closing `*/`. Preserve newlines inside.
      i += 2;
      while (i < len && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') out += '\n';
        i += 1;
      }
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function loadIncludeGlobs() {
  // Attempt module load; fall back to source parsing on failure.
  try {
    const mod = require('./lib/paste-target-prompt.cjs');
    if (
      mod &&
      mod._internal &&
      Array.isArray(mod._internal.INCLUDE_GLOBS)
    ) {
      return { globs: mod._internal.INCLUDE_GLOBS, source: 'module' };
    }
  } catch {
    /* fall through */
  }
  // Fallback: parse source for an INCLUDE_GLOBS = [...] literal.
  try {
    const src = fs.readFileSync(
      path.join(__dirname, 'lib', 'paste-target-prompt.cjs'),
      'utf8'
    );
    const m = src.match(/const\s+INCLUDE_GLOBS\s*=\s*\[([\s\S]*?)\]/);
    if (m) {
      const items = [];
      const re = /['"`]([^'"`]+)['"`]/g;
      let mm;
      while ((mm = re.exec(m[1])) !== null) items.push(mm[1]);
      if (items.length > 0) {
        return { globs: items, source: 'source-fallback' };
      }
    }
  } catch {
    /* fall through */
  }
  return { globs: [], source: 'unavailable' };
}

function globToRegex(glob) {
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i += 2;
        if (glob[i] === '/') {
          re += '/?';
          i += 1;
        }
      } else {
        re += '[^/]*';
        i += 1;
      }
    } else if (ch === '?') {
      re += '[^/]';
      i += 1;
    } else if ('.+^$(){}|[]\\'.includes(ch)) {
      re += '\\' + ch;
      i += 1;
    } else {
      re += ch;
      i += 1;
    }
  }
  return new RegExp('^' + re + '$');
}

function pathMatchesGlobs(relPath, regexes, globs) {
  const base = relPath.split('/').pop();
  for (let i = 0; i < regexes.length; i += 1) {
    if (regexes[i].test(relPath)) return true;
    if (!globs[i].includes('/') && regexes[i].test(base)) return true;
  }
  return false;
}

function listJsFilesIn(dir, repoRoot) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.js')) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(repoRoot, abs).split(path.sep).join('/');
      out.push({ abs, rel });
    }
  }
  return out;
}

// Find every fs.writeFileSync(<expr>, ...) call site. Capture the first
// argument expression up to the first top-level comma. Tracks paren and
// bracket depth so path.join(a, b) etc. doesn't truncate.
function findWriteFileSyncCalls(source) {
  const calls = [];
  const callOpenRe = /(?:fs\s*\.\s*)?writeFileSync\s*\(/g;
  let m;
  while ((m = callOpenRe.exec(source)) !== null) {
    const start = m.index + m[0].length;
    let depth = 1;
    let inStr = null;
    let escape = false;
    let firstArgEnd = -1;
    let firstArg = null;
    for (let i = start; i < source.length; i += 1) {
      const c = source[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (inStr) {
        if (c === '\\') {
          escape = true;
          continue;
        }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        inStr = c;
        continue;
      }
      if (c === '(' || c === '[' || c === '{') depth += 1;
      else if (c === ')' || c === ']' || c === '}') {
        depth -= 1;
        if (depth === 0) {
          if (firstArg === null) firstArg = source.slice(start, i).trim();
          firstArgEnd = i;
          break;
        }
      } else if (c === ',' && depth === 1) {
        if (firstArg === null) firstArg = source.slice(start, i).trim();
      }
    }
    if (firstArg !== null) {
      // Compute line number of the call.
      const pre = source.slice(0, m.index);
      const lineNo = pre.split('\n').length;
      calls.push({
        index: m.index,
        line: lineNo,
        firstArg,
        end: firstArgEnd
      });
    }
  }
  return calls;
}

// Extract every quoted string literal from an expression (paths in path.join,
// template-literal static segments, etc.). Used for shape inference when an
// expression is computed.
function extractLiteralSegments(expr) {
  const out = [];
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`([\s\S]*?)`/g;
  let m;
  while ((m = re.exec(expr)) !== null) {
    let lit = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3];
    if (typeof lit === 'string' && lit.length > 0) {
      // Normalize template-literal interpolations to a single-segment
      // wildcard so glob matching can treat them as "any chars".
      lit = lit.replace(/\$\{[^}]*\}/g, '*');
      out.push(lit);
    }
  }
  return out;
}

// Strip string literals from an expression so the remainder can be scanned
// for identifiers safely.
function stripStringLiterals(expr) {
  return expr
    .replace(/'(?:[^'\\]|\\.)*'/g, '""')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '""');
}

// Identifier and dotted-identifier shapes we'll try to recursively resolve
// from a computed expression. Returns names like CLOSED_DIR (skipping JS
// keywords/builtins).
const RESOLVE_SKIP = new Set([
  'path', 'fs', 'process', 'JSON', 'Date', 'Math', 'Object', 'Array',
  'String', 'Number', 'Boolean', 'Buffer', 'console', 'module', 'require',
  'exports', '__dirname', '__filename', 'true', 'false', 'null', 'undefined',
  'new', 'this', 'return', 'function', 'await', 'async', 'const', 'let', 'var',
  'if', 'else', 'for', 'while', 'try', 'catch', 'throw', 'typeof', 'instanceof',
  'join', 'resolve', 'dirname', 'basename', 'relative'
]);

function extractCandidateIdentifiers(expr) {
  const stripped = stripStringLiterals(expr);
  const out = new Set();
  const re = /\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g;
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const name = m[1];
    if (RESOLVE_SKIP.has(name)) continue;
    out.add(name);
  }
  return Array.from(out);
}

// Locate the enclosing function declaration for a given character offset.
// Returns { name, paramNames, paramIndex(name) } or null.
function findEnclosingFunction(source, offset) {
  // Naive scan: find the last `function NAME (...)` or
  // `(const|let|var) NAME = (async)? (...)` or method def whose body
  // contains `offset`.
  const fnRe =
    /(?:function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function\s*\(([^)]*)\))/g;
  let best = null;
  let m;
  while ((m = fnRe.exec(source)) !== null) {
    const start = m.index;
    if (start >= offset) break;
    // Find the matching body braces.
    let i = m.index + m[0].length;
    while (i < source.length && source[i] !== '{') i += 1;
    if (i >= source.length) continue;
    let depth = 1;
    let j = i + 1;
    let inStr = null;
    let escape = false;
    for (; j < source.length; j += 1) {
      const c = source[j];
      if (escape) { escape = false; continue; }
      if (inStr) {
        if (c === '\\') { escape = true; continue; }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
      if (c === '{') depth += 1;
      else if (c === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (offset > i && offset < j) {
      const name = m[1] || m[3] || m[5];
      const paramsRaw = m[2] || m[4] || m[6] || '';
      const params = paramsRaw
        .split(',')
        .map((p) => p.trim().replace(/=.*$/, '').trim())
        .filter(Boolean);
      best = { name, params, bodyStart: i + 1, bodyEnd: j };
    }
  }
  return best;
}

// Find call sites of a named function and return the expression text of the
// argument at the given index for each call.
function findCallArguments(funcName, argIndex, source) {
  const args = [];
  const re = new RegExp(`\\b${funcName}\\s*\\(`, 'g');
  let m;
  while ((m = re.exec(source)) !== null) {
    const start = m.index + m[0].length;
    let depth = 1;
    let inStr = null;
    let escape = false;
    let cur = start;
    let argStart = start;
    let curIdx = 0;
    let captured = null;
    for (let i = start; i < source.length; i += 1) {
      const c = source[i];
      if (escape) { escape = false; continue; }
      if (inStr) {
        if (c === '\\') { escape = true; continue; }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
      if (c === '(' || c === '[' || c === '{') depth += 1;
      else if (c === ')' || c === ']' || c === '}') {
        depth -= 1;
        if (depth === 0) {
          if (curIdx === argIndex) {
            captured = source.slice(argStart, i).trim();
          }
          break;
        }
      } else if (c === ',' && depth === 1) {
        if (curIdx === argIndex) {
          captured = source.slice(argStart, i).trim();
          break;
        }
        argStart = i + 1;
        curIdx += 1;
      }
      cur = i;
    }
    void cur;
    if (captured) args.push(captured);
  }
  return args;
}

// Locate an identifier's assignment in the source; supports multi-line RHS.
// Returns the RHS expression string (without trailing semicolon) or null.
function findAssignmentRhs(ident, source, beforeIdx) {
  // Match `(const|let|var) ident = ` and capture the RHS until balanced
  // depth returns to 0 and we hit ';' or end-of-statement.
  const re = new RegExp(
    `(?:^|[^A-Za-z0-9_$.])(?:const|let|var)\\s+${ident}\\s*=\\s*`,
    'g'
  );
  let m;
  let bestRhs = null;
  while ((m = re.exec(source)) !== null) {
    const start = m.index + m[0].length;
    if (typeof beforeIdx === 'number' && start >= beforeIdx) break;
    let depth = 0;
    let inStr = null;
    let escape = false;
    let end = -1;
    for (let i = start; i < source.length; i += 1) {
      const c = source[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (inStr) {
        if (c === '\\') {
          escape = true;
          continue;
        }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        inStr = c;
        continue;
      }
      if (c === '(' || c === '[' || c === '{') depth += 1;
      else if (c === ')' || c === ']' || c === '}') depth -= 1;
      else if ((c === ';' || c === '\n') && depth === 0) {
        end = i;
        break;
      }
    }
    if (end >= 0) {
      bestRhs = source.slice(start, end).trim().replace(/;$/, '');
    }
  }
  return bestRhs;
}

// Find a function definition in source by name (covers function declarations,
// function expressions, and arrow functions). Returns the body text or null.
function findFunctionBody(name, source) {
  const patterns = [
    new RegExp(`function\\s+${name}\\s*\\(`),
    new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?\\(`),
    new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?function`)
  ];
  for (const re of patterns) {
    const m = re.exec(source);
    if (m) {
      // Walk from end of match to find first '{', then matching '}'.
      let i = m.index + m[0].length;
      while (i < source.length && source[i] !== '{') i += 1;
      if (i >= source.length) continue;
      let depth = 1;
      let j = i + 1;
      let inStr = null;
      let escape = false;
      for (; j < source.length; j += 1) {
        const c = source[j];
        if (escape) { escape = false; continue; }
        if (inStr) {
          if (c === '\\') { escape = true; continue; }
          if (c === inStr) inStr = null;
          continue;
        }
        if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
        if (c === '{') depth += 1;
        else if (c === '}') {
          depth -= 1;
          if (depth === 0) return source.slice(i + 1, j);
        }
      }
    }
  }
  return null;
}

// Recursively gather literal segments from an expression by following
// identifier assignments up the file. Bounded depth.
function gatherSegmentsFromExpr(expr, source, callOffset, depth, seen) {
  const segs = [...extractLiteralSegments(expr)];
  if (depth >= 4) return segs;
  const idents = extractCandidateIdentifiers(expr);
  for (const ident of idents) {
    if (seen.has(ident)) continue;
    seen.add(ident);
    // (a) Try identifier-as-variable assignment.
    const rhs = findAssignmentRhs(ident, source, callOffset);
    if (rhs !== null) {
      const more = gatherSegmentsFromExpr(
        rhs,
        source,
        callOffset,
        depth + 1,
        seen
      );
      for (const s of more) segs.push(s);
      continue;
    }
    // (b) Try identifier-as-function (path-producing helpers).
    const body = findFunctionBody(ident, source);
    if (body !== null) {
      const more = gatherSegmentsFromExpr(
        body,
        source,
        source.length, // entire body in scope
        depth + 1,
        seen
      );
      for (const s of more) segs.push(s);
    }
  }
  return segs;
}

// Resolve a target expression to a literal string when possible.
// Returns { kind: 'literal'|'template'|'composed'|'unresolved', value?: string,
//           segments?: string[] }
// 'composed' means the expression is a call like path.join(A, 'literal.ext')
// — we surface its literal segments so shape inference can decide.
// Looks back up to 60 lines for variable assignments.
function resolveTargetExpression(expr, source, callOffset, depth) {
  const trimmed = expr.trim();
  const recurseDepth = depth || 0;
  // Direct literal
  const litMatch =
    trimmed.match(/^'((?:[^'\\]|\\.)*)'$/) ||
    trimmed.match(/^"((?:[^"\\]|\\.)*)"$/);
  if (litMatch) return { kind: 'literal', value: litMatch[1] };
  // Direct template literal with no interpolation
  const tplPlain = trimmed.match(/^`((?:[^`\\]|\\.)*)`$/);
  if (tplPlain && !tplPlain[1].includes('${')) {
    return { kind: 'template', value: tplPlain[1] };
  }
  // Template with interpolation — keep the literal-suffix segments to test
  // shape. Replace ${...} with a wildcard token.
  const tplInterp = trimmed.match(/^`([\s\S]*)`$/);
  if (tplInterp) {
    const value = tplInterp[1].replace(/\$\{[^}]*\}/g, '__INTERP__');
    return { kind: 'template', value };
  }
  // Variable name (or dotted) — try resolution.
  const idMatch = trimmed.match(/^[A-Za-z_$][A-Za-z0-9_$.]*$/);
  if (idMatch && recurseDepth < 3) {
    const head = trimmed.split('.')[0];
    // (1) PARAMETER-SHADOW CHECK FIRST. If `head` is a parameter of the
    // enclosing function, the safe outer assignment of the same name does
    // NOT bind here — resolve via call-site arguments instead. This must
    // run BEFORE the broad whole-file findAssignmentRhs lookup, otherwise a
    // future writer like:
    //   const filePath = '_dev/state/x.json';
    //   function write(filePath) { fs.writeFileSync(filePath, body); }
    //   write('_dev/prompts/foo.md');
    // would resolve to the safe outer var instead of the call-site arg.
    const enclosing = findEnclosingFunction(source, callOffset);
    if (enclosing && enclosing.params.includes(head)) {
      const argIndex = enclosing.params.indexOf(head);
      const callArgs = findCallArguments(enclosing.name, argIndex, source);
      const segs = [];
      for (const arg of callArgs) {
        const more = gatherSegmentsFromExpr(
          arg,
          source,
          source.length,
          0,
          new Set([head])
        );
        for (const s of more) segs.push(s);
      }
      if (segs.length > 0) {
        return { kind: 'composed', value: trimmed, segments: segs };
      }
      // Parameter shadows but no resolvable call-site segments — fall through
      // to unresolved (fail-closed). Do NOT consult outer assignments; that
      // would mis-bind to a different variable that happens to share the name.
      return { kind: 'unresolved', value: trimmed };
    }
    // (1b) fs.openSync resolution: if `head` is bound via `fd = fs.openSync(path, ...)`
    // (bare reassignment OR const/let/var declaration), resolve through to the
    // path expression so an fd-based writeFileSync is not flagged as unresolved.
    // This handles the atomic-writer pattern where writeFileSync(fd, data) writes
    // through a file descriptor rather than to a paste-target path.
    {
      const openSyncRe = new RegExp(
        `(?:^|[^A-Za-z0-9_$.])(?:(?:const|let|var)\\s+)?${head}\\s*=\\s*fs\\.openSync\\s*\\(([^,]+),`,
        'g'
      );
      let openMatch;
      let lastOpenTarget = null;
      while ((openMatch = openSyncRe.exec(source)) !== null) {
        if (openMatch.index < callOffset) lastOpenTarget = openMatch[1].trim();
      }
      if (lastOpenTarget !== null) {
        return resolveTargetExpression(
          lastOpenTarget,
          source,
          callOffset,
          recurseDepth + 1
        );
      }
    }
    // (2) Identifier-as-variable assignment. If the identifier is local to
    // an enclosing function body, scope the lookup to that body so we don't
    // pick up an unrelated outer assignment of the same name.
    const lookupSource = enclosing
      ? source.slice(enclosing.bodyStart, enclosing.bodyEnd)
      : source;
    const lookupOffset = enclosing
      ? Math.max(0, callOffset - enclosing.bodyStart)
      : callOffset;
    let rhs = findAssignmentRhs(head, lookupSource, lookupOffset);
    // If not found within the enclosing function body, fall back to the
    // whole-file lookup — a captured outer constant is a legitimate bind.
    if (rhs === null && enclosing) {
      rhs = findAssignmentRhs(head, source, callOffset);
    } else if (!enclosing) {
      // Already whole-file scoped; nothing more to do.
    }
    if (rhs !== null) {
      const rec = resolveTargetExpression(
        rhs,
        source,
        callOffset,
        recurseDepth + 1
      );
      if (rec.kind !== 'unresolved') return rec;
      const segs = gatherSegmentsFromExpr(
        rhs,
        source,
        callOffset,
        0,
        new Set([head])
      );
      if (segs.length > 0) {
        return { kind: 'composed', value: rhs, segments: segs };
      }
      return { kind: 'unresolved', value: rhs };
    }
    // (3) Maybe it's a function name returning a path — gather from body.
    const body = findFunctionBody(head, source);
    if (body !== null) {
      const segs = gatherSegmentsFromExpr(
        body,
        source,
        source.length,
        0,
        new Set([head])
      );
      if (segs.length > 0) {
        return { kind: 'composed', value: trimmed, segments: segs };
      }
    }
    return { kind: 'unresolved', value: trimmed };
  }
  // path.join(...) / other call expression — gather segments transitively.
  const segs = gatherSegmentsFromExpr(
    trimmed,
    source,
    callOffset,
    0,
    new Set()
  );
  if (segs.length > 0) {
    return { kind: 'composed', value: trimmed, segments: segs };
  }
  return { kind: 'unresolved', value: trimmed };
}

// Test whether a (possibly INTERP-substituted) string value looks like a
// paste-target path, by matching against include-glob regexes. We test the
// final concrete-suffix the value implies; for INTERP segments we treat
// __INTERP__ as a wildcard run.
function shapeIsPasteTarget(value, includeRegexes, includeGlobs) {
  // value may contain '*' wildcards (from template-literal interpolation
  // normalization). Substitute the value's '*' with a placeholder character
  // and check whether the resulting concrete path matches any include glob.
  // This direction is sound: if the value's literal anchors (the parts
  // between wildcards) line up with the glob's literal anchors, the file
  // path is paste-target shaped.
  const norm = value.replace(/^\.\//, '');
  const concrete = norm.replace(/\*/g, 'X');
  if (pathMatchesGlobs(concrete, includeRegexes, includeGlobs)) return true;
  // For non-/-bearing globs (e.g. `*handoff*.md`), also test basename.
  const concreteBase = concrete.split('/').pop();
  for (let i = 0; i < includeGlobs.length; i += 1) {
    if (!includeGlobs[i].includes('/') && includeRegexes[i].test(concreteBase)) {
      return true;
    }
  }
  return false;
}

function classifyFile(absPath, relPath, includeGlobs, includeRegexes) {
  const source = fs.readFileSync(absPath, 'utf8');
  const calls = findWriteFileSyncCalls(source);
  const targetClassifications = [];
  for (const call of calls) {
    const resolved = resolveTargetExpression(
      call.firstArg,
      source,
      call.index
    );
    let pasteTargetShape;
    if (resolved.kind === 'unresolved') {
      pasteTargetShape = 'unresolved';
    } else if (resolved.kind === 'composed') {
      // Test each literal segment against the include globs. If any segment
      // (or the joined whole) matches a paste-target shape, flag. Otherwise,
      // require evidence of a concrete file extension/path indicator before
      // calling it 'non-paste-target' (defensive — purely abstract composed
      // values fall through to unresolved).
      const segments = resolved.segments || [];
      let segMatch = false;
      for (const seg of segments) {
        if (
          shapeIsPasteTarget(seg, includeRegexes, includeGlobs)
        ) {
          segMatch = true;
          break;
        }
      }
      // Also try the joined-by-/ form (handles cases where dirname segments
      // and basename segments together compose a paste-target path).
      // Heuristic ordering: segments without an extension first (dirnames),
      // then segments that look like basenames (have .ext).
      if (!segMatch && segments.length >= 2) {
        const dirSegs = segments.filter(
          (s) => !/\.[a-zA-Z0-9]{1,8}$/.test(s)
        );
        const baseSegs = segments.filter(
          (s) => /\.[a-zA-Z0-9]{1,8}$/.test(s)
        );
        const orderings = [
          [...dirSegs, ...baseSegs].join('/'),
          segments.join('/')
        ];
        for (const joined of orderings) {
          if (shapeIsPasteTarget(joined, includeRegexes, includeGlobs)) {
            segMatch = true;
            break;
          }
        }
      }
      // Heuristic: if any segment has a file extension, contains a '/',
      // OR there are at least two literal path-component segments, treat
      // the segments as ground truth (non-paste-target if no shape match).
      const hasConcreteHint =
        segments.some(
          (s) => /\.[a-zA-Z0-9]{1,8}$/.test(s) || s.includes('/')
        ) || segments.length >= 2;
      if (segMatch) {
        pasteTargetShape = 'paste-target-shape';
      } else if (hasConcreteHint) {
        pasteTargetShape = 'non-paste-target';
      } else {
        pasteTargetShape = 'unresolved';
      }
    } else {
      pasteTargetShape = shapeIsPasteTarget(
        resolved.value || '',
        includeRegexes,
        includeGlobs
      )
        ? 'paste-target-shape'
        : 'non-paste-target';
    }
    targetClassifications.push({
      line: call.line,
      arg: call.firstArg,
      resolved,
      shape: pasteTargetShape
    });
  }
  const hasValidatorImport = VALIDATOR_REQUIRE_RE.test(
    stripJsComments(source)
  );
  const anyPasteTarget = targetClassifications.some(
    (c) => c.shape === 'paste-target-shape' || c.shape === 'unresolved'
  );
  let classification;
  if (calls.length === 0) classification = 'no-writes';
  else if (!anyPasteTarget) classification = 'not-applicable';
  else if (hasValidatorImport) classification = 'covered';
  else classification = 'needs-coverage';
  return {
    relPath,
    absPath,
    calls: targetClassifications,
    hasValidatorImport,
    classification
  };
}

function main() {
  const argv = process.argv[2];
  const projectRoot =
    argv && !argv.startsWith('--') ? path.resolve(argv) : REPO_ROOT_DEFAULT;

  const { globs: INCLUDE_GLOBS, source: globsSource } = loadIncludeGlobs();
  if (INCLUDE_GLOBS.length === 0) {
    process.stderr.write(
      'verify-generator-paste-target-optin: FATAL — could not source ' +
        'INCLUDE_GLOBS from paste-target-prompt.cjs (neither module export ' +
        'nor source fallback resolved).\n'
    );
    process.exit(1);
  }
  const INCLUDE_RES = INCLUDE_GLOBS.map(globToRegex);

  // Test-hook env vars are gated behind MYTHOS_F6_ENABLE_TEST_HOOKS=1 so that
  // ambient/leaked env values can't redirect the validator's scope in CI or
  // a contributor shell. When active, log a stderr breadcrumb and reject
  // extra scan dirs that resolve outside projectRoot.
  const hooksActive = process.env.MYTHOS_F6_ENABLE_TEST_HOOKS === '1';
  const rawExtraAllow = process.env.MYTHOS_F6_EXTRA_ALLOWLIST || '';
  const rawExtraDirs = process.env.MYTHOS_F6_EXTRA_SCAN_DIR || '';
  const extraAllow = hooksActive
    ? rawExtraAllow.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  const extraDirsRequested = hooksActive
    ? rawExtraDirs.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  if (hooksActive) {
    process.stderr.write(
      `[f6] test hooks active: SCAN_DIR=${JSON.stringify(extraDirsRequested)} ` +
        `ALLOWLIST=${JSON.stringify(extraAllow)}\n`
    );
  } else if (rawExtraAllow || rawExtraDirs) {
    process.stderr.write(
      `[f6] test-hook env vars present but MYTHOS_F6_ENABLE_TEST_HOOKS!=1; ` +
        `ignoring MYTHOS_F6_EXTRA_SCAN_DIR / MYTHOS_F6_EXTRA_ALLOWLIST.\n`
    );
  }

  const CHOKEPOINT_ALLOWLIST = [
    ...CHOKEPOINT_ALLOWLIST_BASE,
    ...extraAllow
  ];

  // Build scan dirs. Reject any extra dir that resolves outside projectRoot.
  const scanDirsRel = ['tools/signals', 'tools/signals/lib'];
  for (const d of extraDirsRequested) {
    const absD = path.resolve(projectRoot, d);
    const rootWithSep = projectRoot.endsWith(path.sep)
      ? projectRoot
      : projectRoot + path.sep;
    if (absD !== projectRoot && !absD.startsWith(rootWithSep)) {
      process.stderr.write(
        `[f6] FATAL — MYTHOS_F6_EXTRA_SCAN_DIR entry '${d}' resolves to ` +
          `'${absD}' which is outside projectRoot '${projectRoot}'; refusing.\n`
      );
      process.exit(1);
    }
    scanDirsRel.push(d);
  }

  const filesByRel = new Map();
  for (const relDir of scanDirsRel) {
    const absDir = path.resolve(projectRoot, relDir);
    const found = listJsFilesIn(absDir, projectRoot);
    for (const f of found) {
      filesByRel.set(f.rel, f.abs);
    }
  }

  const violations = [];
  const summary = {
    files: 0,
    covered: 0,
    notApplicable: 0,
    noWrites: 0,
    needsCoverage: 0,
    chokepointFiles: 0,
    chokepointLostImport: 0
  };

  // Classify each file.
  for (const [rel, abs] of filesByRel.entries()) {
    summary.files += 1;
    const result = classifyFile(abs, rel, INCLUDE_GLOBS, INCLUDE_RES);
    const onAllowlist = CHOKEPOINT_ALLOWLIST.includes(rel);
    if (result.classification === 'no-writes') {
      summary.noWrites += 1;
    } else if (result.classification === 'not-applicable') {
      summary.notApplicable += 1;
    } else if (result.classification === 'covered') {
      summary.covered += 1;
    } else if (result.classification === 'needs-coverage') {
      if (onAllowlist) {
        summary.covered += 1;
      } else {
        summary.needsCoverage += 1;
        const offendingCalls = result.calls.filter(
          (c) =>
            c.shape === 'paste-target-shape' || c.shape === 'unresolved'
        );
        for (const oc of offendingCalls) {
          violations.push({
            rule_id: 'generator_paste_target_optin',
            path: rel,
            line: oc.line,
            arg: oc.arg,
            shape: oc.shape,
            message:
              `${rel}:${oc.line} writes a ${oc.shape} target ` +
              `(${truncate(oc.arg, 80)}) but file does not require ` +
              `tools/verify/lib/paste-target-prompt.cjs and is not on the ` +
              `chokepoint allowlist`
          });
        }
      }
    }
  }

  // Chokepoint-import assertion (R2 mitigation): for each allowlisted entry,
  // independently grep-assert the validator import is still present.
  for (const cp of CHOKEPOINT_ALLOWLIST) {
    const abs = path.resolve(projectRoot, cp);
    let src;
    try {
      src = fs.readFileSync(abs, 'utf8');
    } catch (err) {
      violations.push({
        rule_id: 'chokepoint_lost_validator_import',
        path: cp,
        line: 0,
        message:
          `${cp}: chokepoint allowlist entry not readable (${err.message}); ` +
          `cannot verify validator import — fail-closed`
      });
      summary.chokepointLostImport += 1;
      continue;
    }
    summary.chokepointFiles += 1;
    if (!VALIDATOR_REQUIRE_RE.test(stripJsComments(src))) {
      violations.push({
        rule_id: 'chokepoint_lost_validator_import',
        path: cp,
        line: 0,
        message:
          `${cp}: chokepoint allowlist entry has lost its require of ` +
          `tools/verify/lib/paste-target-prompt.cjs — restore the import or ` +
          `route writes through a covered chokepoint`
      });
      summary.chokepointLostImport += 1;
    }
  }

  if (violations.length > 0) {
    for (const v of violations) {
      const lineSuffix = v.line ? `:${v.line}` : '';
      process.stderr.write(
        `${v.path}${lineSuffix}: ${v.rule_id}: ${v.message}\n`
      );
    }
    process.stdout.write(
      `generator-paste-target-optin: FAIL — ${violations.length} violation(s) ` +
        `across ${summary.files} files (covered=${summary.covered} ` +
        `not-applicable=${summary.notApplicable} no-writes=${summary.noWrites} ` +
        `needs-coverage=${summary.needsCoverage} ` +
        `chokepoint-lost-import=${summary.chokepointLostImport})\n`
    );
    process.stdout.write(
      `INCLUDE_GLOBS source: ${globsSource}; allowlist=${JSON.stringify(
        CHOKEPOINT_ALLOWLIST
      )}\n`
    );
    process.exit(1);
  }

  process.stdout.write(
    `generator-paste-target-optin: PASS — ${summary.files} file(s) scanned, ` +
      `covered=${summary.covered} not-applicable=${summary.notApplicable} ` +
      `no-writes=${summary.noWrites} ` +
      `chokepoint-files=${summary.chokepointFiles}\n`
  );
  process.stdout.write(
    `INCLUDE_GLOBS source: ${globsSource}; allowlist=${JSON.stringify(
      CHOKEPOINT_ALLOWLIST
    )}\n`
  );
  process.exit(0);
}

function truncate(s, n) {
  if (typeof s !== 'string') return '';
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

if (require.main === module) main();

module.exports = { main };
