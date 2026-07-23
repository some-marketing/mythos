#!/usr/bin/env node
/**
 * verify-agent.cjs — Mechanical validation of a single agent .md file.
 *
 * Usage: node tools/verify/verify-agent.cjs <path-to-agent.md>
 *        node tools/verify/verify-agent.cjs --all
 *        node tools/verify/verify-agent.cjs <path> --json
 *
 * Validates: frontmatter, required XML tags, XML structure quality,
 *            constraint strength, tool declaration, model selection,
 *            markdown heading avoidance.
 *
 * Exit code 0 = PASS/WARN, 1 = FAIL
 */

const fs = require('fs');
const path = require('path');
const { createSignal, addCheck, writeSignal, printSummary, printJsonOutput } = require('./lib/signal.cjs');
const checks = require('./lib/checks.cjs');

// ─── Argument parsing ───────────────────────────────────────────────────

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flags = process.argv.slice(2).filter(a => a.startsWith('--'));
const runAll = flags.includes('--all');
const jsonMode = flags.includes('--json');

if (!runAll && args.length === 0) {
  console.error('Usage: node tools/verify/verify-agent.cjs <path-to-agent.md>');
  console.error('       node tools/verify/verify-agent.cjs --all');
  process.exit(2);
}

// ─── Helpers ────────────────────────────────────────────────────────────

function getBody(content) {
  const parts = content.split('---');
  if (parts.length < 3) return content;
  return parts.slice(2).join('---');
}

function getFrontmatter(content) {
  if (!content.startsWith('---')) return '';
  const endIdx = content.indexOf('---', 3);
  if (endIdx === -1) return '';
  return content.slice(3, endIdx);
}

function countXmlTagPairs(body) {
  const openTags = [];
  const unclosed = [];
  // Find all opening and self-closing tags
  const tagRegex = /<(\/?)([\w_-]+)[\s>]/g;
  let match;
  while ((match = tagRegex.exec(body)) !== null) {
    const isClosing = match[1] === '/';
    const tagName = match[2];
    if (isClosing) {
      const lastOpen = openTags.lastIndexOf(tagName);
      if (lastOpen === -1) {
        unclosed.push({ tag: tagName, type: 'extra-close' });
      } else {
        openTags.splice(lastOpen, 1);
      }
    } else {
      openTags.push(tagName);
    }
  }
  return { unclosed: openTags, extraClose: unclosed };
}

function countModalVerbs(content) {
  const strong = (content.match(/\b(MUST|NEVER|ALWAYS)\b/g) || []).length;
  const weak = (content.match(/\b(should|could|might|may)\b/gi) || []).length;
  return { strong, weak };
}

function countConstraints(body) {
  // Look for constraints section content
  const constraintsMatch = body.match(/<constraints>([\s\S]*?)<\/constraints>/i);
  if (!constraintsMatch) return 0;
  const content = constraintsMatch[1];
  // Count list items (- or * prefixed lines)
  const items = content.match(/^[\s]*[-*]\s+.+/gm) || [];
  return items.length;
}

function hasGenericRole(body) {
  const roleMatch = body.match(/<role>([\s\S]*?)<\/role>/i);
  if (!roleMatch) return false;
  const roleText = roleMatch[1].toLowerCase();
  const genericTerms = ['helpful assistant', 'helps with', 'general purpose', 'generic helper'];
  return genericTerms.some(term => roleText.includes(term));
}

// ─── Single-file verification ───────────────────────────────────────────

function verifyAgent(agentPath) {
  const fullPath = path.resolve(agentPath);
  const agentName = path.basename(fullPath, '.md');
  const signal = createSignal('verify-agent', `agent:${agentName}`);

  // ── Basics ──

  addCheck(signal, checks.fileExists(fullPath, {
    id: 'agent.exists',
    message: `Agent file exists: ${agentName}`
  }));

  if (!fs.existsSync(fullPath)) {
    return signal;
  }

  const content = fs.readFileSync(fullPath, 'utf8');
  const body = getBody(content);
  const fm = getFrontmatter(content);

  addCheck(signal, checks.fileMinSize(fullPath, 200, {
    id: 'agent.min_size',
    severity: 'warning',
    message: 'Agent file >= 200 bytes (non-trivial content)'
  }));

  // ── Frontmatter ──

  addCheck(signal, checks.yamlHasFrontmatter(fullPath, ['name', 'description'], {
    id: 'agent.frontmatter.required',
    category: 'frontmatter',
    message: 'Has YAML frontmatter with name, description'
  }));

  addCheck(signal, checks.yamlHasFrontmatter(fullPath, ['tools'], {
    id: 'agent.frontmatter.tools',
    category: 'frontmatter',
    severity: 'warning',
    message: 'Has tools declaration in frontmatter'
  }));

  addCheck(signal, checks.yamlHasFrontmatter(fullPath, ['model'], {
    id: 'agent.frontmatter.model',
    category: 'frontmatter',
    severity: 'warning',
    message: 'Has model declaration in frontmatter'
  }));

  // Validate name is kebab-case
  addCheck(signal, {
    id: 'agent.name_format',
    category: 'frontmatter',
    severity: 'warning',
    message: 'Name follows kebab-case convention',
    evidence: fullPath,
    test: () => {
      const nameMatch = fm.match(/^name:\s*(.+)$/m);
      if (!nameMatch) return false;
      return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(nameMatch[1].trim());
    },
    fix_hint: 'Use lowercase-with-hyphens for name (e.g., my-agent-name)'
  });

  // Validate model is valid
  addCheck(signal, {
    id: 'agent.model_valid',
    category: 'frontmatter',
    severity: 'warning',
    message: 'Model is opus, sonnet, or haiku',
    evidence: fullPath,
    test: () => {
      const modelMatch = fm.match(/^model:\s*(.+)$/m);
      if (!modelMatch) return false;
      return ['opus', 'sonnet', 'haiku'].includes(modelMatch[1].trim());
    },
    fix_hint: 'Set model to one of: opus, sonnet, haiku'
  });

  // ── Required XML tags ──

  addCheck(signal, checks.xmlHasTag(fullPath, 'role', {
    id: 'agent.tag.role',
    category: 'structure',
    message: 'Has <role> tag defining expertise'
  }));

  // Workflow: any of workflow, approach, critical_workflow, tasks
  addCheck(signal, {
    id: 'agent.tag.workflow',
    category: 'structure',
    severity: 'critical',
    message: 'Has workflow definition (<workflow>, <tasks>, <approach>, or <critical_workflow>)',
    evidence: fullPath,
    test: () => {
      return ['<workflow', '<tasks', '<approach', '<critical_workflow'].some(t => body.includes(t));
    },
    fix_hint: 'Add <workflow>, <tasks>, or <approach> section with step definitions'
  });

  addCheck(signal, checks.xmlHasTag(fullPath, 'constraints', {
    id: 'agent.tag.constraints',
    category: 'structure',
    message: 'Has <constraints> tag'
  }));

  // ── Recommended XML tags ──

  addCheck(signal, {
    id: 'agent.tag.output_format',
    category: 'recommended',
    severity: 'warning',
    message: 'Has <output_format> tag (recommended)',
    evidence: fullPath,
    test: () => body.includes('<output_format') || body.includes('<output>'),
    fix_hint: 'Add <output_format> section defining expected output structure'
  });

  addCheck(signal, {
    id: 'agent.tag.success_criteria',
    category: 'recommended',
    severity: 'warning',
    message: 'Has <success_criteria> tag (recommended)',
    evidence: fullPath,
    test: () => body.includes('<success_criteria'),
    fix_hint: 'Add <success_criteria> section defining what success looks like'
  });

  // ── Quality: no markdown headings in body ──

  addCheck(signal, checks.xmlNoMarkdownHeadings(fullPath, {
    id: 'agent.no_md_headings',
    message: 'No ## or ### headings in body (uses XML tags instead)'
  }));

  // ── XML structure: unclosed tags ──

  addCheck(signal, {
    id: 'agent.xml_balanced',
    category: 'structure',
    severity: 'warning',
    message: 'XML tags are properly balanced (opened and closed)',
    evidence: fullPath,
    test: () => {
      const result = countXmlTagPairs(body);
      return result.unclosed.length === 0 && result.extraClose.length === 0;
    },
    get detail() {
      const result = countXmlTagPairs(body);
      const issues = [];
      if (result.unclosed.length) issues.push(`Unclosed: ${result.unclosed.join(', ')}`);
      if (result.extraClose.length) issues.push(`Extra close: ${result.extraClose.map(e => e.tag).join(', ')}`);
      return issues.join('; ') || 'All tags balanced';
    },
    fix_hint: 'Close all XML tags properly — every <tag> needs a </tag>'
  });

  // ── Constraint strength ──

  addCheck(signal, {
    id: 'agent.constraint_count',
    category: 'quality',
    severity: 'warning',
    message: 'Has at least 3 constraints defined',
    evidence: fullPath,
    test: () => countConstraints(body) >= 3,
    get detail() { return `${countConstraints(body)} constraints found`; },
    fix_hint: 'Add at least 3 specific constraints with MUST/NEVER/ALWAYS language'
  });

  addCheck(signal, {
    id: 'agent.modal_strength',
    category: 'quality',
    severity: 'warning',
    message: 'Uses strong modal verbs (MUST/NEVER/ALWAYS) in constraints',
    evidence: fullPath,
    test: () => {
      const { strong } = countModalVerbs(body);
      return strong >= 3;
    },
    get detail() {
      const { strong, weak } = countModalVerbs(body);
      return `Strong modals: ${strong}, Weak modals: ${weak}`;
    },
    fix_hint: 'Replace should/could/might with MUST/NEVER/ALWAYS for critical constraints'
  });

  // ── Role quality ──

  addCheck(signal, {
    id: 'agent.role_not_generic',
    category: 'quality',
    severity: 'warning',
    message: 'Role definition is specific, not generic',
    evidence: fullPath,
    test: () => !hasGenericRole(body),
    fix_hint: 'Replace generic role description with specific domain expertise and specialization'
  });

  // ── Description quality ──

  addCheck(signal, {
    id: 'agent.description_has_trigger',
    category: 'quality',
    severity: 'warning',
    message: 'Description includes "when to use" trigger context',
    evidence: fullPath,
    test: () => {
      const descMatch = fm.match(/^description:\s*(.+(?:\n\s+.+)*)$/m);
      if (!descMatch) return false;
      const desc = descMatch[1].toLowerCase();
      return desc.includes('use when') || desc.includes('when ') || desc.includes('use for') || desc.includes('after ');
    },
    fix_hint: 'Include "Use when..." trigger context in description'
  });

  return signal;
}

// ─── Discover all agents ────────────────────────────────────────────────

function discoverAgents() {
  const projectRoot = path.resolve(__dirname, '../..');
  const agents = [];

  // System agents
  const systemDir = path.join(projectRoot, '.claude', 'agents');
  if (fs.existsSync(systemDir)) {
    for (const file of fs.readdirSync(systemDir)) {
      if (file.endsWith('.md')) {
        agents.push({ path: path.join(systemDir, file), type: 'system' });
      }
    }
  }

  // Framework agents
  const fwRoot = path.join(projectRoot, 'frameworks');
  if (fs.existsSync(fwRoot)) {
    for (const service of fs.readdirSync(fwRoot)) {
      const serviceDir = path.join(fwRoot, service);
      if (!fs.statSync(serviceDir).isDirectory()) continue;
      for (const fw of fs.readdirSync(serviceDir)) {
        const agentDir = path.join(serviceDir, fw, '.claude', 'agents');
        if (fs.existsSync(agentDir) && fs.statSync(agentDir).isDirectory()) {
          for (const file of fs.readdirSync(agentDir)) {
            if (file.endsWith('.md')) {
              agents.push({ path: path.join(agentDir, file), type: `framework:${service}/${fw}` });
            }
          }
        }
      }
    }
  }

  return agents;
}

// ─── Main ───────────────────────────────────────────────────────────────

if (runAll) {
  const agents = discoverAgents();
  let totalPass = 0;
  let totalFail = 0;
  let totalWarn = 0;
  const results = [];

  for (const agent of agents) {
    const signal = verifyAgent(agent.path);
    const projectRoot = path.resolve(__dirname, '../..');
    const scratchDir = path.join(projectRoot, '_dev', 'reports', 'signals');
    const agentName = path.basename(agent.path, '.md');
    const outputPath = path.join(scratchDir, `verify-agent__${agentName}.signal.json`);
    writeSignal(signal, outputPath);

    const verdict = signal.gate_decision.proceed ? (signal.summary.warnings > 0 ? 'WARN' : 'PASS') : 'FAIL';
    if (verdict === 'PASS') totalPass++;
    else if (verdict === 'WARN') totalWarn++;
    else totalFail++;

    results.push({ name: agentName, type: agent.type, verdict, checks: signal.summary });
  }

  if (jsonMode) {
    console.log(JSON.stringify({ agents: results, summary: { total: agents.length, pass: totalPass, warn: totalWarn, fail: totalFail } }, null, 2));
  } else {
    console.log(`\n── Agent Verification Summary ──`);
    for (const r of results) {
      const icon = r.verdict === 'PASS' ? 'PASS' : r.verdict === 'WARN' ? 'WARN' : 'FAIL';
      console.log(`  ${icon}: ${r.name} (${r.type}) — ${r.checks.passed}/${r.checks.total} checks`);
    }
    console.log(`\n${totalPass + totalWarn}/${agents.length} agents passed (${totalFail} failed, ${totalWarn} warnings).`);
  }

  process.exit(totalFail > 0 ? 1 : 0);
} else {
  const agentPath = args[0];
  const signal = verifyAgent(agentPath);

  if (!printJsonOutput(signal)) {
    const projectRoot = path.resolve(__dirname, '../..');
    const scratchDir = path.join(projectRoot, '_dev', 'reports', 'signals');
    const agentName = path.basename(path.resolve(agentPath), '.md');
    const outputPath = path.join(scratchDir, `verify-agent__${agentName}.signal.json`);
    writeSignal(signal, outputPath);
    printSummary(signal);
    console.log(`\nSignal: ${outputPath}`);
  }

  process.exit(signal.gate_decision.proceed ? 0 : 1);
}
