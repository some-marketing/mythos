'use strict';

const fs = require('fs');
const path = require('path');

const { describeSlot } = require('./profiles');

function resultHeader(slot, result) {
  return `# ${slot.label} / ${slot.actor} response\n\n- slot_id: ${slot.id}\n- actor: ${slot.actor}\n- pinned_model: ${slot.pinned_model || 'none'}\n- status: ${result.status}\n- duration_ms: ${result.duration_ms}\n- exit_code: ${result.exit_code}\n- error: ${result.error || 'none'}\n\n---\n\n`;
}

function safeName(value) {
  return String(value || 'unknown').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

function writeArtifacts(outDir, args, triad, prompts, results, participants) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'prompt.md'), Object.values(prompts)[0] + '\n');
  const promptDir = path.join(outDir, 'prompts');
  fs.mkdirSync(promptDir, { recursive: true });
  for (const [slotId, prompt] of Object.entries(prompts)) {
    const slot = triad.slots.find((candidate) => candidate.id === slotId);
    const actor = slot ? slot.actor : 'unknown';
    fs.writeFileSync(path.join(promptDir, `${safeName(slotId)}__${safeName(actor)}.md`), prompt + '\n');
  }

  for (const slot of triad.slots) {
    const result = results[slot.id];
    if (!result) continue;
    const body = resultHeader(slot, result) + (result.output || '(no output)') + '\n';
    fs.writeFileSync(path.join(outDir, `${safeName(slot.id)}__${safeName(slot.actor)}.md`), body);

    // Backward-compatible artifact names for the historic default profile.
    if (!fs.existsSync(path.join(outDir, `${safeName(slot.actor)}.md`))) {
      fs.writeFileSync(path.join(outDir, `${safeName(slot.actor)}.md`), body);
    }
  }

  const synthSkeleton = [
    '# Convene synthesis skeleton',
    '',
    `**Scope:** ${args.scope}`,
    `**Timestamp:** ${new Date().toISOString()}`,
    `**Origin:** ${args.origin}`,
    `**Profile:** ${triad.id} (${triad.label})`,
    `**Consequence-grade profile:** ${triad.consequence_grade ? 'yes' : 'no'}`,
    `**Participant slots convened:** ${participants.map((slot) => `${slot.id}/${slot.actor}`).join(', ')}`,
    '',
    '## Task',
    '',
    args.task,
    ''
  ];

  synthSkeleton.push('## Triad slots');
  synthSkeleton.push('');
  for (const slot of triad.slots) {
    synthSkeleton.push(`- ${describeSlot(slot, triad.actor_labels)}`);
  }
  synthSkeleton.push('');

  for (const slot of triad.slots) {
    synthSkeleton.push(`## ${slot.label} / ${slot.actor}`);
    synthSkeleton.push('');
    if (slot.is_origin) {
      synthSkeleton.push('[ORIGIN SLOT/ACTOR FILLS THIS IN AFTER READING PARTICIPANT RESPONSES]');
    } else if (results[slot.id]) {
      synthSkeleton.push(`See ${safeName(slot.id)}__${safeName(slot.actor)}.md in this directory. Status: ${results[slot.id].status}.`);
    } else {
      synthSkeleton.push('(not called)');
    }
    synthSkeleton.push('');
  }

  synthSkeleton.push(
    '## Cross-verification catches',
    '',
    '[SYNTHESIS SECTION: which slot caught which issue, where they agreed, where they disagreed, where any slot was wrong or too narrow]',
    '',
    '## Net findings',
    '',
    '[ONE-VOICE SUMMARY: speak as the kernel/profile, not as three consultants. Preserve unresolved disagreement explicitly.]',
    ''
  );
  fs.writeFileSync(path.join(outDir, 'synthesis-skeleton.md'), synthSkeleton.join('\n'));

  const manifest = {
    schema: 'ConveneRun/3.0',
    previous_schema: 'ConveneRun/2.0',
    timestamp: new Date().toISOString(),
    scope: args.scope,
    task: args.task,
    context_files: args.contextFiles,
    origin: args.origin,
    profile: {
      id: triad.id,
      label: triad.label,
      consequence_grade: triad.consequence_grade
    },
    triad_slots: triad.slots.map((slot) => ({
      id: slot.id,
      label: slot.label,
      function: slot.function,
      actor: slot.actor,
      pinned_model: slot.pinned_model || null,
      is_origin: Boolean(slot.is_origin)
    })),
    participants: participants.map((slot) => slot.actor),
    participant_slots: participants.map((slot) => ({ id: slot.id, actor: slot.actor })),
    duplicate_actors: triad.duplicate_actors,
    timeout_seconds: args.timeoutSeconds,
    dry_run: args.dryRun,
    only: args.only,
    results: Object.fromEntries(triad.slots.map((slot) => {
      const result = results[slot.id];
      return [slot.id, result ? {
        actor: result.actor,
        pinned_model: slot.pinned_model || null,
        status: result.status,
        duration_ms: result.duration_ms,
        exit_code: result.exit_code,
        error: result.error,
        output_length: (result.output || '').length
      } : null];
    }))
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

module.exports = {
  safeName,
  writeArtifacts
};
