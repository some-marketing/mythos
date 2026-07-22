'use strict';
// Pure two-way reconciliation between Dart tasks and Apple Reminders.
//
// Given the current active Dart tasks, the current Apple reminders, and the
// snapshot of both sides at the last sync, decide what to change on each side.
//
// Direction policy (v1):
//   - New Dart task            -> create reminder (Dart -> Apple)
//   - Dart task completed       -> complete reminder (Dart -> Apple)
//   - Dart field changed        -> update reminder name/due (Dart wins on fields)
//   - Reminder completed in Apple, task still open in Dart
//                               -> WRITE BACK completion to Dart (Apple -> Dart)
//   - Reminder missing for an open task -> recreate (Dart is source of truth)
//   - Reminder missing for a done task  -> drop the mapping
//
// Safety: write-backs are completion-only and capped. If a single run would
// write back more than config.writeBack.maxPerRun completions, ALL write-backs
// are withheld and a warning is emitted, so a reconciliation bug cannot
// mass-close real Dart tasks. Caller may override with force=true.

function snap(dart) {
  return {
    title: dart.title,
    due: dart.due || null,
    isCompleted: !!dart.isCompleted,
    status: dart.status || null,
  };
}

function dueChanged(a, b) {
  return (a || null) !== (b || null);
}

/**
 * @param {Object} input
 * @param {Array}  input.dartTasks   - [{dartId,title,due,isCompleted,status,board,listName}]
 * @param {Array}  input.appleReminders - [{id,name,body,completed,listName,due}]
 * @param {Object} input.entries     - existing mapping store entries keyed by dartId
 * @param {Object} input.config      - { writeBack:{enabled,maxPerRun}, ... }
 * @param {boolean} [input.force]    - bypass the write-back cap
 * @returns {Object} plan
 */
function reconcile(input) {
  const dartTasks = input.dartTasks || [];
  const appleReminders = input.appleReminders || [];
  const entries = input.entries || {};
  const config = input.config || {};
  const wb = config.writeBack || { enabled: true, maxPerRun: 25 };
  const force = !!input.force;

  const dartById = new Map(dartTasks.map((t) => [t.dartId, t]));
  const appleById = new Map(appleReminders.map((r) => [r.id, r]));
  // Idempotency anchor: reminders carry their Dart id in the body, so an
  // existing reminder can be ADOPTED by a task that has no mapping entry yet
  // (e.g. after a crashed populating run). This prevents duplicate creates.
  const appleByDartId = new Map();
  for (const r of appleReminders) {
    if (r.dartId) appleByDartId.set(String(r.dartId), r);
  }

  const reminderOps = [];
  const ensuredLists = new Set();
  const dartWriteBacks = [];
  const nextEntries = {};
  const warnings = [];
  const stats = { created: 0, updated: 0, completedInApple: 0, writeBack: 0, recreated: 0, dropped: 0, unchanged: 0 };

  function ensureList(listName) {
    if (!ensuredLists.has(listName)) {
      ensuredLists.add(listName);
      reminderOps.push({ op: 'ensureList', name: listName });
    }
  }

  // Universe = current active Dart tasks UNION mapped tasks (to catch tasks that
  // left the active set because they were completed/abandoned in Dart).
  const universe = new Set([...dartById.keys(), ...Object.keys(entries)]);

  for (const dartId of universe) {
    const dart = dartById.get(dartId);
    const entry = entries[dartId];

    // Case A: brand-new active task, no mapping yet.
    if (!entry) {
      if (!dart) continue; // shouldn't happen

      // A0: an existing reminder already carries this dartId -> ADOPT it
      // instead of creating a duplicate (recovers from a crashed populate).
      const adopt = appleByDartId.get(dartId);
      if (adopt) {
        const next = {
          dartId, reminderId: adopt.id, listName: adopt.listName || dart.listName,
          lastDart: snap(dart), lastApple: { name: adopt.name, completed: !!adopt.completed },
        };
        // If the task was completed in Apple since, write completion back.
        if (adopt.completed && !dart.isCompleted && wb.enabled) {
          dartWriteBacks.push({ dartId, reminderId: adopt.id, title: dart.title });
          next.lastDart.isCompleted = true;
        } else if (dart.isCompleted && !adopt.completed) {
          reminderOps.push({ op: 'complete', id: adopt.id, completed: true });
          next.lastApple.completed = true;
          stats.completedInApple++;
        } else if (adopt.name !== dart.title) {
          reminderOps.push({ op: 'update', id: adopt.id, name: dart.title, body: buildBody(dart), due: dart.due || null });
          stats.updated++;
        } else {
          stats.adopted = (stats.adopted || 0) + 1;
        }
        nextEntries[dartId] = next;
        continue;
      }

      ensureList(dart.listName);
      reminderOps.push({
        op: 'create',
        list: dart.listName,
        tempId: dartId,
        name: dart.title,
        body: buildBody(dart),
        due: dart.due || null,
      });
      stats.created++;
      nextEntries[dartId] = {
        dartId,
        reminderTempId: dartId,
        listName: dart.listName,
        lastDart: snap(dart),
        lastApple: { name: dart.title, completed: false },
      };
      continue;
    }

    const apple = appleById.get(entry.reminderId);

    // Case B: mapped reminder no longer exists in Apple.
    if (!apple) {
      if (dart && !dart.isCompleted) {
        // Open task, reminder gone -> recreate (Dart is source of truth).
        ensureList(dart.listName);
        reminderOps.push({
          op: 'create', list: dart.listName, tempId: dartId,
          name: dart.title, body: buildBody(dart), due: dart.due || null,
        });
        stats.recreated++;
        nextEntries[dartId] = {
          dartId, reminderTempId: dartId, listName: dart.listName,
          lastDart: snap(dart), lastApple: { name: dart.title, completed: false },
        };
        warnings.push({ kind: 'recreated-missing-reminder', dartId });
      } else {
        // Done/absent task and reminder gone -> drop the mapping entirely.
        stats.dropped++;
      }
      continue;
    }

    // Case C: both sides present. Compare against snapshot.
    const appleCompletedNow = !!apple.completed;
    const appleCompletedBefore = !!(entry.lastApple && entry.lastApple.completed);
    const dartCompletedNow = dart ? !!dart.isCompleted : true; // gone from active set => done
    const dartCompletedBefore = !!(entry.lastDart && entry.lastDart.isCompleted);

    const appleNewlyComplete = appleCompletedNow && !appleCompletedBefore;
    const next = {
      dartId,
      reminderId: entry.reminderId,
      listName: entry.listName,
      lastDart: dart ? snap(dart) : entry.lastDart,
      lastApple: { name: apple.name, completed: appleCompletedNow },
    };

    if (appleNewlyComplete && !dartCompletedNow && wb.enabled) {
      // Apple -> Dart completion write-back (the two-way signal).
      dartWriteBacks.push({ dartId, reminderId: entry.reminderId, title: entry.lastDart.title });
      next.lastDart = Object.assign({}, next.lastDart, { isCompleted: true });
      nextEntries[dartId] = next;
      continue;
    }

    if (dartCompletedNow && !appleCompletedNow) {
      // Dart -> Apple completion.
      reminderOps.push({ op: 'complete', id: entry.reminderId, completed: true });
      stats.completedInApple++;
      next.lastApple.completed = true;
      nextEntries[dartId] = next;
      continue;
    }

    // Field sync (Dart wins) for open tasks.
    if (dart && !dartCompletedNow) {
      const titleChanged = dart.title !== entry.lastDart.title;
      const dChanged = dueChanged(dart.due, entry.lastDart.due);
      if (titleChanged || dChanged) {
        reminderOps.push({
          op: 'update', id: entry.reminderId,
          name: dart.title, body: buildBody(dart), due: dart.due || null,
        });
        stats.updated++;
        nextEntries[dartId] = next;
        continue;
      }
    }

    stats.unchanged++;
    nextEntries[dartId] = next;
  }

  // Write-back safety cap.
  let blockedWriteBacks = [];
  if (dartWriteBacks.length > (wb.maxPerRun || 25) && !force) {
    warnings.push({
      kind: 'writeback-cap-exceeded',
      count: dartWriteBacks.length,
      max: wb.maxPerRun || 25,
      detail: 'All completion write-backs withheld this run. Re-run with --force to apply.',
    });
    blockedWriteBacks = dartWriteBacks.splice(0, dartWriteBacks.length);
    // Revert snapshots for the withheld write-backs so they retry next run.
    for (const w of blockedWriteBacks) {
      if (nextEntries[w.dartId]) {
        nextEntries[w.dartId].lastDart = Object.assign(
          {}, nextEntries[w.dartId].lastDart, { isCompleted: false }
        );
      }
    }
  }
  stats.writeBack = dartWriteBacks.length;

  return { reminderOps, dartWriteBacks, blockedWriteBacks, nextEntries, stats, warnings };
}

function buildBody(dart) {
  const lines = [];
  if (dart.board) lines.push('Board: ' + dart.board);
  if (dart.status) lines.push('Status: ' + dart.status);
  if (dart.url) lines.push(dart.url);
  lines.push('synced from Dart [dartId:' + dart.dartId + ']');
  return lines.join('\n');
}

module.exports = { reconcile, buildBody, snap };
