'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Validate the guardrail precedence chain: kernel > system > framework.
 *
 * Returns an array of violation objects. Empty array = no violations.
 * Each violation: { level: 'kernel-system'|'system-framework', framework_id?: string, message: string }
 */
function validatePrecedenceChain(projectRoot) {
  const violations = [];

  // Load kernel safety rules
  const kernelPath = path.join(projectRoot, 'instructions/canonical/kernel/safety.yaml');
  let kernelRules = [];
  try {
    const kernel = JSON.parse(fs.readFileSync(kernelPath, 'utf8'));
    kernelRules = Array.isArray(kernel.safety_rules) ? kernel.safety_rules : [];
  } catch { return violations; } // Can't validate without kernel

  // Load system safety rules
  const systemPath = path.join(projectRoot, 'instructions/canonical/system.yaml');
  let systemRules = [];
  let systemModes = [];
  try {
    const system = JSON.parse(fs.readFileSync(systemPath, 'utf8'));
    systemRules = Array.isArray(system.safety_rules) ? system.safety_rules : [];
    systemModes = Array.isArray(system.execution_modes) ? system.execution_modes.map(m => m.id) : [];
  } catch { return violations; }

  // Check kernel → system: all kernel rules must appear in system
  for (const rule of kernelRules) {
    if (!systemRules.includes(rule)) {
      violations.push({
        level: 'kernel-system',
        message: `Kernel rule missing from system safety_rules: "${rule.slice(0, 80)}..."`
      });
    }
  }

  // Load rendered system guardrails to extract forbidden labels
  const guardrailsPath = path.join(projectRoot, '.claude/guardrails.md');
  let forbiddenLabels = [];
  try {
    const guardrailsContent = fs.readFileSync(guardrailsPath, 'utf8');
    // Extract forbidden labels from the guardrails — they appear in a section called "Forbidden Labels"
    const forbiddenMatch = guardrailsContent.match(/forbidden\s+labels[\s\S]*?(?=##|$)/i);
    if (forbiddenMatch) {
      // Extract the specific forbidden terms from the table rows
      // Format: | `Root Cause:` | replacement |
      const tableRowPattern = /\|\s*`([^`]+?)(?::)?`\s*\|/g;
      let match;
      const labels = [];
      while ((match = tableRowPattern.exec(forbiddenMatch[0])) !== null) {
        const label = match[1].trim();
        // Skip the header row
        if (label.toLowerCase() === 'forbidden term') continue;
        labels.push(label.toLowerCase());
      }
      forbiddenLabels = [...new Set(labels)];
    }
  } catch {}

  // Check system → framework: for each registered framework, check guardrails
  try {
    const systemData = JSON.parse(fs.readFileSync(systemPath, 'utf8'));
    if (Array.isArray(systemData.frameworks)) {
      for (const fw of systemData.frameworks) {
        const fwGuardrailsPath = path.join(projectRoot, fw.guardrails);
        if (!fs.existsSync(fwGuardrailsPath)) continue;

        try {
          const fwContent = fs.readFileSync(fwGuardrailsPath, 'utf8');

          // Check: framework should not use forbidden labels as required/expected
          for (const label of forbiddenLabels) {
            // Look for patterns like "required: <label>" or "must include <label>"
            const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
            const requiredPattern = new RegExp(
              `(?:required|must\\s+include|must\\s+use|always\\s+use)\\s*[:\\-]?\\s*${escapedLabel}`,
              'i'
            );
            if (requiredPattern.test(fwContent)) {
              violations.push({
                level: 'system-framework',
                framework_id: fw.id,
                message: `Framework ${fw.id} requires forbidden label "${label}" (system guardrails forbid it)`
              });
            }
          }
        } catch {}
      }
    }
  } catch {}

  return violations;
}

module.exports = { validatePrecedenceChain };
