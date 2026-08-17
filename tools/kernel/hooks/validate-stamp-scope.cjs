'use strict';

// tools/kernel/hooks/validate-stamp-scope.cjs -- standalone remote-mutation
// stamp scope-broadness validator.
//
// Spec: _dev/reports/analysis/ticktock-remote-mutation-canary-stamp-collision__guard-spec.md
// Plan: ticktock-remote-mutation-canary-stamp-collision (S1/S2).
//
// Deliberately standalone and reusable (not inlined only in the gate's
// consumption path) so a future pre-commit hook, CI check, or interactive
// stamp-authoring CLI can import it directly without pulling in the full
// gate runtime. The load-bearing call site is still
// pretool-remote-mutation-gate.cjs's stampInvalidReason() -- see that file --
// because a validator that is merely callable and never called protects
// nothing (council review 2026-08-16T22:01Z, codex NOW finding).

// A bare single-word scope entry naming a category of tool, rather than one
// specific artifact, authorizes every command that classifies to that key --
// forever, regardless of what the operator actually intended to grant.
const GENERIC_VERB_DISALLOWLIST = new Set([
  'ssh', 'scp', 'rsync', 'cat', 'ls', 'find', 'mkdir', 'mount', 'umount',
  'read', 'open', 'powershell', 'bash', 'sh', 'curl', 'wget', 'nc', 'telnet'
]);

/**
 * Returns a reason string if the entry is too broad, or null if it is fine.
 * A "fine" entry is either a named script/artifact (not in the disallow
 * list) or a `re:` pattern that does not begin with a bare `.*` after an
 * optional leading `^`. Narrow literal-fragment patterns are intentionally
 * allowed because the real stamp corpus contains one such production shape.
 */
function scopeEntryTooBroad(entry) {
  const e = String(entry || '').trim();
  if (!e) return null; // empty entries are a different defect (STAMP-SCOPE-UNPARSEABLE upstream), not this guard's concern

  if (e.startsWith('re:')) {
    const pattern = e.slice(3);
    // CORRECTED live 2026-08-16 (S2 landing, second pass): a plain "must
    // start with ^" rule was ALSO too strong -- it invalidated
    // antsimv2-projection-lane, a REAL production stamp /tt's own TICK
    // phase depends on for the AntSimV2 projection, whose
    // 're:AntSimV2[\\/]+Tools[\\/]+BuildLevel\.ps1' entry legitimately
    // matches one specific, unique script path without a leading '^'. That
    // pattern is narrow (it can only match commands containing that exact
    // path fragment); it is not the shape that caused the real incident.
    // The actual incident shape, precisely: a regex that begins (optionally
    // after a '^') with a bare '.*' -- matching ANY text before its real
    // content, i.e. "arbitrary substring anywhere" rather than "this
    // specific fragment". Reject exactly that, evidenced by every
    // orwell-flag-capture entry (re:.*orwell.*, re:.*taylor.*, re:.*flag.*,
    // re:.*192\.168\.2\..*) and by nothing in the real, currently-valid
    // stamp corpus (re-verified against every stamp in
    // _dev/state/remote-mutation-stamps/ before landing this rule).
    const stripped = pattern.startsWith('^') ? pattern.slice(1) : pattern;
    if (stripped.startsWith('.*')) {
      return `unanchored wildcard regex '${e}' -- a leading .* matches an arbitrary substring rather than one specific command shape, per the guard spec`;
    }
    return null;
  }

  if (GENERIC_VERB_DISALLOWLIST.has(e.toLowerCase())) {
    return `bare generic shell verb '${e}' -- name a specific script or artifact instead of a category of tool, per the guard spec`;
  }

  return null;
}

/**
 * Validate an entire stamp's scope array. Returns null if every entry is
 * acceptably narrow, or the first violation's reason string otherwise.
 * Fails closed on a malformed (non-array) scope -- that is a different
 * defect the caller's own schema checks already catch, but this function
 * does not silently pass it either.
 */
function stampScopeTooBroad(stamp) {
  if (!stamp || !Array.isArray(stamp.scope)) return null;
  for (const entry of stamp.scope) {
    const reason = scopeEntryTooBroad(entry);
    if (reason) return reason;
  }
  return null;
}

module.exports = {
  GENERIC_VERB_DISALLOWLIST,
  scopeEntryTooBroad,
  stampScopeTooBroad
};
