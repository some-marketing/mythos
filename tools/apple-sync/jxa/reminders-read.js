#!/usr/bin/osascript -l JavaScript
// Bulk-read all reminders in lists whose name starts with the given prefix.
// argv[0] = list-name prefix (e.g. "Dart: ")
// Output: JSON array of {id, name, body, completed, listName, due} to stdout.
//
// Uses JXA bulk-property accessors (list.reminders.name() returns an array in
// ONE Apple Event) instead of per-reminder property calls, which keeps a
// few-hundred-reminder read fast enough for a poller.
function run(argv) {
  const prefix = argv[0] || 'Dart: ';
  const app = Application('Reminders');
  const out = [];
  const lists = app.lists;
  const listNames = lists.name(); // bulk
  for (let i = 0; i < listNames.length; i++) {
    const name = listNames[i];
    if (name.indexOf(prefix) !== 0) continue;
    const list = lists.byName(name);
    const ids = list.reminders.id();
    const names = list.reminders.name();
    const bodies = list.reminders.body();
    const completed = list.reminders.completed();
    let dues;
    try { dues = list.reminders.dueDate(); } catch (e) { dues = ids.map(() => null); }
    for (let j = 0; j < ids.length; j++) {
      out.push({
        id: ids[j],
        name: names[j],
        body: bodies[j] || '',
        completed: !!completed[j],
        listName: name,
        due: dues[j] ? dues[j].toISOString() : null,
      });
    }
  }
  return JSON.stringify(out);
}
