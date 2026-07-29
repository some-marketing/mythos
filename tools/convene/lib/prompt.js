'use strict';

const fs = require('fs');
const path = require('path');

const { REPO_ROOT } = require('./adapters');
const { describeSlot } = require('./profiles');

function buildPrompt(args, triad, targetSlot, participants) {
  const lines = [];
  const origin = args.origin || 'claude';

  lines.push('You are one slot of a triadic convene run on a specific task.');
  lines.push('');
  lines.push(`Triad profile: ${triad.label} (${triad.id})`);
  lines.push(triad.description);
  lines.push('');
  lines.push('The invariant is the three-corner structure. The actor/harness in each corner may rotate by task, scope, risk, and privacy constraints.');
  lines.push('');
  lines.push('Triad slots:');
  for (const slot of triad.slots) {
    const marker = slot.id === targetSlot.id ? ' [YOU]' : '';
    lines.push(`  - ${describeSlot(slot, triad.actor_labels)}${marker}`);
  }
  lines.push('');
  lines.push(`This convene call originated from: ${origin}.`);
  lines.push(`Participant slots convened by this runner: ${participants.map((slot) => `${slot.id}/${slot.actor}`).join(', ') || '(none)'}.`);
  lines.push('The origin slot or actor will add its own analysis inline after participant responses arrive.');
  lines.push('');
  lines.push('Register rules:');
  lines.push('  - Blunt, falsifiable, no hedging');
  lines.push('  - Preserve the gap between observation and interpretation');
  lines.push('  - Say when the profile is too narrow for consequence-grade consensus');
  lines.push('  - Speak as a slot of the whole, not an external consultant');
  lines.push('  - If uncertain, say so in curiosity-mode');
  lines.push('  - Name what the other slots probably miss that you see by construction');
  lines.push('');
  lines.push('## Your slot');
  lines.push('');
  lines.push(`- slot_id: ${targetSlot.id}`);
  lines.push(`- slot_label: ${targetSlot.label}`);
  lines.push(`- actor: ${targetSlot.actor}`);
  lines.push(`- function: ${targetSlot.function}`);
  lines.push('');
  lines.push('## Task');
  lines.push('');
  lines.push(args.task);
  lines.push('');

  if (args.contextFiles.length > 0) {
    lines.push('## Shared context (read-only, for the task above)');
    lines.push('');
    for (const cf of args.contextFiles) {
      const abs = path.isAbsolute(cf) ? cf : path.resolve(REPO_ROOT, cf);
      let content = '';
      try {
        content = fs.readFileSync(abs, 'utf8');
      } catch (err) {
        content = `[ERROR reading ${cf}: ${err.message}]`;
      }
      lines.push(`### ${cf}`);
      lines.push('');
      lines.push('```');
      lines.push(content);
      lines.push('```');
      lines.push('');
    }
  }

  lines.push('## Your response');
  lines.push('');
  lines.push("Answer the task from your slot's perspective. 300-800 words. Be specific. Cite file paths with line numbers where relevant.");
  return lines.join('\n');
}

function buildPrompts(args, triad, participants) {
  return Object.fromEntries(
    participants.map((slot) => [slot.id, buildPrompt(args, triad, slot, participants)])
  );
}

module.exports = {
  buildPrompt,
  buildPrompts
};
