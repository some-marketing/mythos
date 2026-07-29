#!/usr/bin/osascript -l JavaScript
// Upsert a single digest note by title.
// argv[0] = note title
// argv[1] = path to a file containing the note body (HTML)
// argv[2] = folder name (optional; default account's first folder)
//
// If a note with the title exists (in the target folder), its body is replaced;
// otherwise a new note is created. Output: JSON {action:"created"|"updated", title}.
function run(argv) {
  ObjC.import('Foundation');
  const title = argv[0];
  const bodyPath = argv[1];
  const folderName = argv[2] || null;
  const bodyStr = $.NSString.stringWithContentsOfFileEncodingError(bodyPath, $.NSUTF8StringEncoding, null);
  const body = bodyStr.js;

  const app = Application('Notes');

  // Resolve target folder.
  let folder = null;
  if (folderName) {
    try { folder = app.folders.byName(folderName); folder.name(); } catch (e) { folder = null; }
  }
  if (!folder) {
    // default account default folder
    folder = app.defaultAccount.folders[0];
  }

  // Find an existing note by name within the folder.
  let existing = null;
  try {
    const names = folder.notes.name();
    const idx = names.indexOf(title);
    if (idx !== -1) existing = folder.notes[idx];
  } catch (e) { /* folder may be empty */ }

  if (existing) {
    existing.body = body;
    return JSON.stringify({ action: 'updated', title: title });
  }
  const n = app.Note({ name: title, body: body });
  folder.notes.push(n);
  return JSON.stringify({ action: 'created', title: title });
}
