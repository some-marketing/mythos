/**
 * QUESTIONS_FOR_DEVELOPER.md skeleton template.
 */

/**
 * Generate QUESTIONS_FOR_DEVELOPER.md skeleton.
 * @param {string} bundleId
 * @param {object[]} runs - Run descriptors
 * @returns {string} Markdown content with LLM placeholder
 */
export function questionsSkeleton(bundleId, runs) {
  const lines = [];
  lines.push('# Questions for Developer');
  lines.push('');
  lines.push('<!-- MANAGED:METADATA:START -->');
  lines.push(`**Bundle:** \`${bundleId}\``);
  lines.push(`**Runs:** ${runs.length}`);
  lines.push('<!-- MANAGED:METADATA:END -->');
  lines.push('');
  lines.push('The following questions arose during payload analysis and require developer input.');
  lines.push('Each question includes evidence citations — click the paths to locate the relevant artifacts.');
  lines.push('');
  lines.push('<!-- LLM:QUESTIONS -->');
  lines.push('');

  return lines.join('\n');
}

export default { questionsSkeleton };
