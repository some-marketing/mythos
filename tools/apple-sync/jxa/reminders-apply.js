#!/usr/bin/osascript -l JavaScript
// Apply a batch of reminder operations read from a JSON file.
// argv[0] = path to ops JSON file.
//
// Ops file shape:
//   { "ops": [
//       {"op":"ensureList","name":"Dart: Example Board"},
//       {"op":"create","list":"Dart: Example Board","tempId":"dart-123","name":"...","body":"...","due":"2026-06-01T12:00:00Z"},
//       {"op":"update","id":"x-apple-reminderkit://...","name":"...","body":"...","due":null},
//       {"op":"complete","id":"x-apple-reminderkit://...","completed":true}
//   ]}
//
// Output: JSON {created:{tempId:newId,...}, applied:N, errors:[{op,detail}]}.
function run(argv) {
  ObjC.import('Foundation');
  const path = argv[0];
  const data = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  const parsed = JSON.parse(data.js);
  const ops = parsed.ops || [];
  const app = Application('Reminders');

  const created = {};
  const errors = [];
  let applied = 0;

  function listExists(name) {
    const names = app.lists.name();
    return names.indexOf(name) !== -1;
  }

  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    try {
      if (o.op === 'ensureList') {
        if (!listExists(o.name)) {
          const nl = app.List({ name: o.name });
          app.lists.push(nl);
        }
        applied++;
      } else if (o.op === 'create') {
        const props = { name: o.name };
        if (o.body) props.body = o.body;
        if (o.due) props.dueDate = new Date(o.due);
        const r = app.Reminder(props);
        app.lists.byName(o.list).reminders.push(r);
        created[o.tempId] = r.id();
        applied++;
      } else if (o.op === 'update') {
        const r = app.reminders.byId(o.id);
        if (o.name !== undefined) r.name = o.name;
        if (o.body !== undefined) r.body = o.body;
        if (o.due !== undefined) r.dueDate = o.due ? new Date(o.due) : null;
        applied++;
      } else if (o.op === 'complete') {
        const r = app.reminders.byId(o.id);
        r.completed = !!o.completed;
        applied++;
      } else {
        errors.push({ op: o.op, detail: 'unknown op' });
      }
    } catch (e) {
      errors.push({ op: o.op, id: o.id || o.tempId || o.name, detail: String(e) });
    }
  }

  return JSON.stringify({ created: created, applied: applied, errors: errors });
}
