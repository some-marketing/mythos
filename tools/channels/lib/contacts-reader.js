'use strict';

/**
 * contacts-reader.js -- Read members of a named macOS Contacts group via osascript.
 *
 * The first invocation prompts the running process for Contacts permission
 * (System Settings > Privacy & Security > Contacts). When invoked from launchd,
 * the daemon process is the one that needs the grant.
 */

const { execFileSync } = require('child_process');

const DEFAULT_GROUP = 'Dart Inbox';
// Sentinels chosen to be vanishingly unlikely in real contact data.
const REC_SEP = '␞'; // RECORD SEPARATOR symbol
const FIELD_SEP = '␟'; // UNIT SEPARATOR symbol
const SUB_SEP = '|||';

function buildScript(groupName) {
  const escaped = groupName.replace(/"/g, '\\"');
  return `
on joinList(theList, theDelim)
  set AppleScript's text item delimiters to theDelim
  set s to theList as text
  set AppleScript's text item delimiters to ""
  return s
end joinList

tell application "Contacts"
  set out to ""
  try
    set targetGroup to first group whose name is "${escaped}"
  on error
    return "__NO_GROUP__"
  end try
  set peopleList to people of targetGroup
  repeat with p in peopleList
    set theName to ""
    try
      set theName to (name of p as text)
    end try
    set theCompany to ""
    try
      if (organization of p) is not missing value then set theCompany to (organization of p as text)
    end try
    set phoneVals to {}
    try
      repeat with ph in (phones of p)
        set end of phoneVals to (value of ph as text)
      end repeat
    end try
    set emailVals to {}
    try
      repeat with em in (emails of p)
        set end of emailVals to (value of em as text)
      end repeat
    end try
    set phoneStr to my joinList(phoneVals, "${SUB_SEP}")
    set emailStr to my joinList(emailVals, "${SUB_SEP}")
    set rec to theName & "${FIELD_SEP}" & theCompany & "${FIELD_SEP}" & phoneStr & "${FIELD_SEP}" & emailStr
    if out is "" then
      set out to rec
    else
      set out to out & "${REC_SEP}" & rec
    end if
  end repeat
  return out
end tell
`;
}

/**
 * Read members of the named Contacts group.
 *
 * @param {object} [opts]
 * @param {string} [opts.group] Group name. Defaults to "Dart Inbox".
 * @returns {Array<{name:string, company:string, phones:string[], emails:string[]}>}
 * @throws {Error} if Contacts permission is denied, group is missing, or osascript fails.
 */
function readGroup(opts = {}) {
  const group = opts.group || DEFAULT_GROUP;
  const script = buildScript(group);
  let raw;
  try {
    raw = execFileSync('/usr/bin/osascript', ['-e', script], {
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 4 * 1024 * 1024
    });
  } catch (err) {
    const stderr = err.stderr ? String(err.stderr) : '';
    if (stderr.includes('-1743') || stderr.toLowerCase().includes('not allowed assistive access') || stderr.toLowerCase().includes('not authorized')) {
      throw new Error(`Contacts permission denied. Grant the calling process Contacts access in System Settings > Privacy & Security > Contacts. osascript stderr: ${stderr.trim()}`);
    }
    throw new Error(`osascript failed reading Contacts group "${group}": ${stderr.trim() || err.message}`);
  }
  const trimmed = raw.trim();
  if (trimmed === '__NO_GROUP__') {
    throw new Error(`Contacts group "${group}" does not exist. Create it in Contacts.app and add members.`);
  }
  if (!trimmed) return [];
  return trimmed.split(REC_SEP).map((rec) => {
    const [name = '', company = '', phoneStr = '', emailStr = ''] = rec.split(FIELD_SEP);
    return {
      name: name.trim(),
      company: company.trim(),
      phones: phoneStr ? phoneStr.split(SUB_SEP).map((s) => s.trim()).filter(Boolean) : [],
      emails: emailStr ? emailStr.split(SUB_SEP).map((s) => s.trim()).filter(Boolean) : []
    };
  });
}

module.exports = { readGroup, DEFAULT_GROUP };
