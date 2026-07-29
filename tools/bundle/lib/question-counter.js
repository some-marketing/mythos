/**
 * Count Q-### patterns in a questions markdown file.
 *
 * @module question-counter
 */

import fs from 'fs';

/**
 * Count Q-### patterns in QUESTIONS_FOR_DEVELOPER.md
 * @param {string} questionsFilePath - Absolute path to the markdown file
 * @returns {{ count: number, ids: string[] }}
 */
export function countQuestions(questionsFilePath) {
  let text;
  try {
    text = fs.readFileSync(questionsFilePath, 'utf-8');
  } catch {
    return { count: 0, ids: [] };
  }

  const pattern = /\bQ-(\d+)\b/g;
  const ids = [];
  const seen = new Set();
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const id = `Q-${match[1]}`;
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }

  return { count: ids.length, ids };
}

export default { countQuestions };
