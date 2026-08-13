'use strict';

/**
 * bash-write-extract.cjs — pure static extraction of write-target candidates
 * from a Bash command string.
 *
 * Capability tier (harness-runtime-contract terms): B1 pure-lib — BEST-EFFORT
 * ADVISORY extraction; static analysis cannot see all writes; the opaque
 * list is the honesty channel. This module NEVER touches the filesystem,
 * never executes anything, and never guesses a path it isn't confident of —
 * when it cannot resolve a write target with certainty it emits an `opaque`
 * entry with a reason instead of fabricating a candidate path. Nothing
 * enforces that a caller actually consults this module's output, and no
 * caller should treat an empty `candidates` list as proof a command has no
 * side effects — read `opaque` too.
 *
 * This file was originally staged at tools/scoped/write-ledger-bash-capture/
 * while tools/kernel/ sat behind a live ConveneReceipt perimeter (see
 * tools/verify/hooks/pre-write-convene-required.cjs) that the authoring
 * worker did not hold. Its final home is here, tools/kernel/hooks/lib/
 * bash-write-extract.cjs, moved once the ConveneReceipt covering
 * tools/kernel/hooks/lib/ landed, per the substrate-fidelity-verifier
 * staging precedent.
 *
 * Scope and known simplifications (read before trusting an absence of a
 * candidate):
 *   - No full shell grammar. Quote handling covers single quotes ('...',
 *     fully literal, no expansion) and double quotes ("...", $ and `
 *     expansion recognized, \ escapes $ ` " \). Anything the scanner can't
 *     be sure about becomes an `opaque` entry with reason
 *     'unparseable-segment' rather than a guess.
 *   - Segment splitting is quote-aware but happens on the literal characters
 *     ; && || | & at the top level (outside quotes and outside a
 *     $( ) / `` command-substitution span). No brace expansion, no here-docs,
 *     no process substitution (<( ) / >( )) — those are left unmodeled and
 *     fall through to the generic "unrecognized command, no shell write
 *     operator visible" opaque bucket when they don't match a known
 *     mechanism.
 *   - Flag parsing per mechanism is intentionally shallow: any token
 *     starting with '-' is treated as a flag and skipped, with a couple of
 *     value-taking flags special-cased (see MKDIR_VALUE_FLAGS below). This
 *     is a judgment call, not a full getopt implementation — documented so
 *     it can be tightened later without surprise.
 *   - "Unknown command, no shell write operator" is deliberately opaque
 *     rather than silent: static analysis cannot prove an arbitrary
 *     executable (a script, a git subcommand other than `mv`, an
 *     interpreter running a file instead of inline code, etc.) doesn't
 *     write files internally. A small SAFE_READONLY_COMMANDS allowlist
 *     exists to cut noise for the most common read-only utilities; it is
 *     conservative on purpose — false "opaque" is the safe failure mode
 *     here, false "no write" is not.
 *
 * Module use:
 *   const { extractBashWrites } = require('.../bash-write-extract.cjs');
 *   extractBashWrites('echo hi > out.txt', { cwd: '/repo' });
 *   // -> { candidates: [{ path: '/repo/out.txt', confidence: 'literal', mechanism: 'redirect' }],
 *   //      opaque: [], truncated: false }
 */

const path = require('path');

const MAX_COMMAND_BYTES = 4096;

// Commands known to never write files themselves (their own invocation, not
// what a shell write-operator glued onto them might do — that's still
// caught separately by the redirect/tee mechanisms). Conservative on
// purpose: anything not on this list, with no visible shell write operator,
// is reported as opaque rather than assumed safe.
const SAFE_READONLY_COMMANDS = new Set([
  'ls', 'cat', 'echo', 'pwd', 'grep', 'egrep', 'fgrep', 'which', 'test',
  '[', 'true', 'false', 'sleep', 'printf', 'wc', 'head', 'tail', 'sort',
  'uniq', 'diff', 'basename', 'dirname', 'env', 'date', 'whoami', 'id',
  'uname', 'ps', 'du', 'df', 'jq', 'printenv', 'cd', 'export', 'set',
]);

// Interpreters whose -e/-c flag runs inline code we cannot see into.
const INLINE_INTERPRETERS = new Set(['node', 'python', 'python3', 'ruby', 'perl']);
const INLINE_INTERPRETER_FLAGS = new Set(['-e', '-c', '--eval']);

const WRITE_MECHANISM_COMMANDS = new Set(['tee', 'cp', 'mv', 'mkdir', 'touch']);

const MKDIR_VALUE_FLAGS = new Set(['-m', '--mode']);

// --- tokenizer ---------------------------------------------------------

/**
 * Single-pass, quote-aware tokenizer. Produces a flat list of items in
 * source order:
 *   { type: 'word', raw, hasVar, hasCmdSub, start, end }
 *   { type: 'op', text, start, end }   // one of ; && || | & > >> < <<
 * Sets `ok: false` (and stops emitting further items) the moment it hits an
 * unbalanced quote or command-substitution span — the caller treats
 * whatever segment that failure fell inside as unparseable.
 */
function tokenize(command) {
  const items = [];
  const n = command.length;
  let i = 0;
  let ok = true;

  let wordStart = -1;
  let wordBuf = '';
  let wordHasVar = false;
  let wordHasCmdSub = false;

  function flushWord(end) {
    if (wordStart === -1) return;
    items.push({ type: 'word', raw: wordBuf, hasVar: wordHasVar, hasCmdSub: wordHasCmdSub, start: wordStart, end });
    wordStart = -1;
    wordBuf = '';
    wordHasVar = false;
    wordHasCmdSub = false;
  }

  function ensureWordStarted(at) {
    if (wordStart === -1) wordStart = at;
  }

  // Consume a $( ... ) span starting at index `i` (command[i] === '(' and
  // command[i-2..i-1] === '$('). Returns the index just past the matching
  // ')', or -1 if unbalanced. Quote-aware but shallow: tracks nested
  // parens and skips over nested quoted spans so a ')' inside a string
  // literal doesn't close the substitution early.
  function skipCmdSub(start) {
    let depth = 1;
    let j = start + 1;
    while (j < n && depth > 0) {
      const c = command[j];
      if (c === '\\') { j += 2; continue; }
      if (c === "'") {
        const close = command.indexOf("'", j + 1);
        if (close === -1) return -1;
        j = close + 1;
        continue;
      }
      if (c === '"') {
        let k = j + 1;
        while (k < n && command[k] !== '"') {
          if (command[k] === '\\') k += 2; else k += 1;
        }
        if (k >= n) return -1;
        j = k + 1;
        continue;
      }
      if (c === '(') { depth += 1; j += 1; continue; }
      if (c === ')') { depth -= 1; j += 1; continue; }
      j += 1;
    }
    return depth === 0 ? j : -1;
  }

  while (i < n && ok) {
    const c = command[i];

    if (c === ' ' || c === '\t') {
      flushWord(i);
      i += 1;
      continue;
    }

    // Newlines are top-level segment separators, exactly like ';' — a
    // shell reads each physical line as its own command unless a trailing
    // backslash, an open quote, or a pending operator (e.g. a dangling &&)
    // continues it, none of which apply once we're here (those cases are
    // already consumed elsewhere: backslash-newline is swallowed by the
    // '\\' escape branch below via wordBuf, and quote/cmd-sub spans consume
    // their own newlines internally). \r\n collapses to a single separator.
    if (c === '\n' || c === '\r') {
      flushWord(i);
      const start = i;
      const end = (c === '\r' && command[i + 1] === '\n') ? i + 2 : i + 1;
      items.push({ type: 'op', text: ';', start, end });
      i = end;
      continue;
    }

    if (c === "'") {
      ensureWordStarted(i);
      const close = command.indexOf("'", i + 1);
      if (close === -1) { ok = false; break; }
      wordBuf += command.slice(i + 1, close); // literal, no expansion
      i = close + 1;
      continue;
    }

    if (c === '"') {
      ensureWordStarted(i);
      let j = i + 1;
      let seg = '';
      let closed = false;
      while (j < n) {
        const dc = command[j];
        if (dc === '\\' && j + 1 < n && '$`"\\'.includes(command[j + 1])) {
          seg += command[j + 1];
          j += 2;
          continue;
        }
        if (dc === '"') { closed = true; j += 1; break; }
        if (dc === '`') { wordHasCmdSub = true; seg += dc; j += 1; continue; }
        if (dc === '$' && command[j + 1] === '(') {
          wordHasCmdSub = true;
          const end = skipCmdSub(j + 1);
          if (end === -1) { ok = false; break; }
          seg += command.slice(j, end);
          j = end;
          continue;
        }
        if (dc === '$' && /[A-Za-z_{]/.test(command[j + 1] || '')) {
          wordHasVar = true;
        }
        seg += dc;
        j += 1;
      }
      if (!ok) break;
      if (!closed) { ok = false; break; }
      wordBuf += seg;
      i = j;
      continue;
    }

    if (c === '`') {
      ensureWordStarted(i);
      wordHasCmdSub = true;
      let j = i + 1;
      let closed = false;
      let seg = '`';
      while (j < n) {
        if (command[j] === '\\') { seg += command.slice(j, j + 2); j += 2; continue; }
        if (command[j] === '`') { seg += '`'; j += 1; closed = true; break; }
        seg += command[j];
        j += 1;
      }
      if (!closed) { ok = false; break; }
      wordBuf += seg;
      i = j;
      continue;
    }

    if (c === '$' && command[i + 1] === '(') {
      ensureWordStarted(i);
      wordHasCmdSub = true;
      const end = skipCmdSub(i + 1);
      if (end === -1) { ok = false; break; }
      wordBuf += command.slice(i, end);
      i = end;
      continue;
    }

    if (c === '$' && /[A-Za-z_{]/.test(command[i + 1] || '')) {
      ensureWordStarted(i);
      wordHasVar = true;
      wordBuf += c;
      i += 1;
      continue;
    }

    if (c === '\\' && i + 1 < n) {
      ensureWordStarted(i);
      wordBuf += command[i + 1];
      i += 2;
      continue;
    }

    if (';&|><'.includes(c)) {
      flushWord(i);
      const start = i;
      let text = c;
      if (c === '&' && command[i + 1] === '&') { text = '&&'; i += 2; }
      else if (c === '|' && command[i + 1] === '|') { text = '||'; i += 2; }
      else if (c === '>' && command[i + 1] === '>') { text = '>>'; i += 2; }
      else if (c === '<' && command[i + 1] === '<') { text = '<<'; i += 2; }
      else { i += 1; }
      items.push({ type: 'op', text, start, end: i });
      continue;
    }

    ensureWordStarted(i);
    wordBuf += c;
    i += 1;
  }

  if (ok) flushWord(n);

  return { items, ok };
}

// Fold an immediately-adjacent leading '&' or digit-run into a following
// redirect operator: `2>`, `2>>`, `&>`, `&>>`. Adjacency means no gap
// between the previous item's end and this operator's start.
function foldRedirectOperators(items) {
  const out = [];
  for (let idx = 0; idx < items.length; idx += 1) {
    const item = items[idx];
    if (item.type === 'op' && (item.text === '>' || item.text === '>>')) {
      const prev = out[out.length - 1];
      if (prev && prev.end === item.start) {
        if (prev.type === 'word' && /^\d+$/.test(prev.raw)) {
          out.pop();
          out.push({ type: 'op', text: prev.raw + item.text, start: prev.start, end: item.end });
          continue;
        }
        if (prev.type === 'op' && prev.text === '&') {
          out.pop();
          out.push({ type: 'op', text: '&' + item.text, start: prev.start, end: item.end });
          continue;
        }
      }
    }
    out.push(item);
  }
  return out;
}

const REDIRECT_OP_RE = /^(?:\d+)?>>?$|^&>>?$/;

// --- segment grouping ----------------------------------------------------

// Top-level separators: ; && || | & (bare & backgrounds a job — treated as
// a segment terminator, same as ;).
const SEGMENT_SPLIT_OPS = new Set([';', '&&', '||', '|', '&']);

function groupSegments(items) {
  const segments = [];
  let current = [];
  for (const item of items) {
    if (item.type === 'op' && SEGMENT_SPLIT_OPS.has(item.text)) {
      if (current.length) segments.push(current);
      current = [];
      continue;
    }
    current.push(item);
  }
  if (current.length) segments.push(current);
  return segments;
}

// --- path helpers ----------------------------------------------------

function resolveTarget(raw, cwd) {
  if (!cwd) return raw;
  return path.resolve(cwd, raw);
}

function resolveInferredTarget(dirRaw, sourceRaw, cwd) {
  const base = path.posix.basename(sourceRaw.replace(/\\/g, '/'));
  const joined = dirRaw.endsWith('/') ? dirRaw + base : dirRaw + '/' + base;
  return resolveTarget(joined, cwd);
}

function segmentSnippet(command, segItems) {
  if (!segItems.length) return '';
  const start = segItems[0].start;
  const end = segItems[segItems.length - 1].end;
  return command.slice(start, end);
}

function isAssignmentWord(item) {
  return item.type === 'word' && !item.hasCmdSub && /^[A-Za-z_][A-Za-z0-9_]*=/.test(item.raw);
}

function isFlag(word) {
  return word.raw.length > 1 && word.raw[0] === '-';
}

// --- per-mechanism extraction ----------------------------------------------

function pushCandidate(out, path_, confidence, mechanism) {
  out.candidates.push({ path: path_, confidence, mechanism });
}

function pushOpaqueTarget(out, word, reason) {
  out.opaque.push({ reason, snippet: word.raw });
}

function targetOpaqueReason(word) {
  if (word.hasCmdSub) return 'command-substitution';
  if (word.hasVar) return 'variable-expansion';
  return null;
}

function extractRedirects(command, segItems, cwd, out) {
  let found = false;
  for (let i = 0; i < segItems.length; i += 1) {
    const item = segItems[i];
    if (item.type !== 'op' || !REDIRECT_OP_RE.test(item.text)) continue;
    const target = segItems[i + 1];
    if (!target || target.type !== 'word') continue;
    found = true;
    const reason = targetOpaqueReason(target);
    if (reason) {
      pushOpaqueTarget(out, target, reason);
    } else {
      pushCandidate(out, resolveTarget(target.raw, cwd), 'literal', 'redirect');
    }
  }
  return found;
}

function wordsOnly(segItems) {
  return segItems.filter((it) => it.type === 'word');
}

function skipAssignments(words) {
  let i = 0;
  while (i < words.length && isAssignmentWord(words[i])) i += 1;
  return words.slice(i);
}

function extractTee(words, cwd, out) {
  const rest = skipAssignments(words).slice(1); // drop 'tee'
  const targets = rest.filter((w) => !isFlag(w));
  for (const t of targets) {
    const reason = targetOpaqueReason(t);
    if (reason) pushOpaqueTarget(out, t, reason);
    else pushCandidate(out, resolveTarget(t.raw, cwd), 'literal', 'tee');
  }
}

function extractCpMv(words, cwd, out, mechanism) {
  const rest = skipAssignments(words).slice(1); // drop 'cp'/'mv'
  const positional = rest.filter((w) => !isFlag(w));
  if (positional.length < 2) return; // nothing to pair as src->dst
  const dst = positional[positional.length - 1];
  const sources = positional.slice(0, -1);
  const dstReason = targetOpaqueReason(dst);
  if (dstReason) {
    pushOpaqueTarget(out, dst, dstReason);
    return;
  }
  if (sources.length === 1 && !dst.raw.endsWith('/')) {
    pushCandidate(out, resolveTarget(dst.raw, cwd), 'literal', mechanism);
    return;
  }
  for (const src of sources) {
    const srcReason = targetOpaqueReason(src);
    if (srcReason) { pushOpaqueTarget(out, src, srcReason); continue; }
    pushCandidate(out, resolveInferredTarget(dst.raw, src.raw, cwd), 'inferred', mechanism);
  }
}

function extractGitMv(words, cwd, out) {
  const rest = skipAssignments(words).slice(2); // drop 'git' 'mv'
  const positional = rest.filter((w) => !isFlag(w));
  if (positional.length < 2) return;
  const dst = positional[positional.length - 1];
  const sources = positional.slice(0, -1);
  const dstReason = targetOpaqueReason(dst);
  if (dstReason) { pushOpaqueTarget(out, dst, dstReason); return; }
  if (sources.length === 1 && !dst.raw.endsWith('/')) {
    pushCandidate(out, resolveTarget(dst.raw, cwd), 'literal', 'git-mv');
    return;
  }
  for (const src of sources) {
    const srcReason = targetOpaqueReason(src);
    if (srcReason) { pushOpaqueTarget(out, src, srcReason); continue; }
    pushCandidate(out, resolveInferredTarget(dst.raw, src.raw, cwd), 'inferred', 'git-mv');
  }
}

function extractMkdir(words, cwd, out) {
  const rest = skipAssignments(words).slice(1); // drop 'mkdir'
  const targets = [];
  for (let i = 0; i < rest.length; i += 1) {
    const w = rest[i];
    if (isFlag(w)) {
      if (MKDIR_VALUE_FLAGS.has(w.raw)) i += 1; // skip its value token too
      continue;
    }
    targets.push(w);
  }
  for (const t of targets) {
    const reason = targetOpaqueReason(t);
    if (reason) pushOpaqueTarget(out, t, reason);
    else pushCandidate(out, resolveTarget(t.raw, cwd), 'literal', 'mkdir');
  }
}

function extractTouch(words, cwd, out) {
  const rest = skipAssignments(words).slice(1); // drop 'touch'
  const targets = rest.filter((w) => !isFlag(w));
  for (const t of targets) {
    const reason = targetOpaqueReason(t);
    if (reason) pushOpaqueTarget(out, t, reason);
    else pushCandidate(out, resolveTarget(t.raw, cwd), 'literal', 'touch');
  }
}

// --- segment dispatch -------------------------------------------------

function processSegment(command, segItems, cwd, out) {
  const words = wordsOnly(segItems);
  const meaningfulWords = skipAssignments(words);
  const commandWord = meaningfulWords[0];

  // Inline interpreter running code we cannot see into: opaque, no further
  // analysis of this segment (it might redirect too, but we can't tell
  // what an inline -e/-c payload writes, so don't half-report it).
  if (commandWord && INLINE_INTERPRETERS.has(commandWord.raw)) {
    const hasInlineFlag = meaningfulWords.some((w) => INLINE_INTERPRETER_FLAGS.has(w.raw) || /^--eval=/.test(w.raw));
    if (hasInlineFlag) {
      out.opaque.push({ reason: 'inline-interpreter-writes-unknown', snippet: segmentSnippet(command, segItems) });
      return;
    }
  }

  // Redirect targets are captured regardless of what the command itself is —
  // this does not short-circuit the unknown-executable check below, so an
  // unknown script's own internal writes still get their opaque marker even
  // when its output is also being redirected to a known target.
  extractRedirects(command, segItems, cwd, out);

  if (commandWord && commandWord.raw === 'tee') {
    extractTee(meaningfulWords, cwd, out);
    return;
  }
  if (commandWord && commandWord.raw === 'cp') {
    extractCpMv(meaningfulWords, cwd, out, 'cp');
    return;
  }
  if (commandWord && commandWord.raw === 'mv') {
    extractCpMv(meaningfulWords, cwd, out, 'mv');
    return;
  }
  if (commandWord && commandWord.raw === 'mkdir') {
    extractMkdir(meaningfulWords, cwd, out);
    return;
  }
  if (commandWord && commandWord.raw === 'touch') {
    extractTouch(meaningfulWords, cwd, out);
    return;
  }
  if (commandWord && commandWord.raw === 'git') {
    if (meaningfulWords[1] && meaningfulWords[1].raw === 'mv') {
      extractGitMv(meaningfulWords, cwd, out);
      return;
    }
    // Any other git subcommand's internal writes are unmodeled — fall
    // through to the generic unknown-command bucket below (a redirect on
    // the same segment, if any, was already captured above and does not
    // suppress this).
  }

  if (!commandWord) return; // nothing but flags/assignments; no-op segment

  if (SAFE_READONLY_COMMANDS.has(commandWord.raw)) return;
  if (WRITE_MECHANISM_COMMANDS.has(commandWord.raw)) return; // handled above

  out.opaque.push({ reason: 'script-internal-writes-unknown', snippet: segmentSnippet(command, segItems) });
}

// --- public entry point -------------------------------------------------

function extractBashWrites(command, options = {}) {
  const cwd = options && options.cwd ? options.cwd : undefined;
  const cmd = String(command || '');

  if (Buffer.byteLength(cmd, 'utf8') > MAX_COMMAND_BYTES) {
    return { candidates: [], opaque: [{ reason: 'over-budget' }], truncated: true };
  }

  const out = { candidates: [], opaque: [], truncated: false };

  const { items, ok } = tokenize(cmd);
  if (!ok) {
    out.opaque.push({ reason: 'unparseable-segment', snippet: cmd });
    return out;
  }

  const folded = foldRedirectOperators(items);
  const segments = groupSegments(folded);
  for (const seg of segments) {
    processSegment(cmd, seg, cwd, out);
  }

  return out;
}

module.exports = { extractBashWrites };
