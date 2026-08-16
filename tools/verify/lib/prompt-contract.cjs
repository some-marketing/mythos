const fs = require('fs');
const path = require('path');

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function validateTextRules(content, rules) {
  const failures = [];
  for (const rule of rules) {
    if (!rule.pattern.test(content)) {
      failures.push(rule.message);
    }
  }
  return failures;
}

const executePlanRules = [
  {
    pattern: /Minimize main-thread context/i,
    message: 'missing main-thread minimization rule'
  },
  {
    pattern: /delegate .* bounded subagents or workers/i,
    message: 'missing subagent-first execution rule'
  },
  {
    pattern: /validator must not be the same subagent or worker/i,
    message: 'missing independent validator rule'
  },
  {
    pattern: /The main thread synthesizes what to communicate to the operator and to Codex/i,
    message: 'missing main-thread synthesis rule'
  },
  {
    pattern: /signals:watch:codex:start/i,
    message: 'missing listener start command'
  },
  {
    pattern: /signals:watch:codex:stop/i,
    message: 'missing listener stop command'
  }
];

const promptContracts = [
  {
    id: 'master_loop_closure',
    relPath: 'tools/codex/prompt-system/claude-prompt-pack-master-loop-closure.md',
    rules: [
      {
        pattern: /Keep the main thread thin/i,
        message: 'missing thin main-thread rule'
      },
      {
        pattern: /Launch exactly two read-only subagents in parallel/i,
        message: 'missing exact two read-only subagents rule'
      },
      {
        pattern: /Synthesize findings in the main thread/i,
        message: 'missing main-thread synthesis step'
      },
      {
        pattern: /independent read-only validator/i,
        message: 'missing independent validator requirement'
      },
      {
        pattern: /signals:watch:codex:start/i,
        message: 'missing listener start requirement'
      },
      {
        pattern: /signals:watch:codex:stop/i,
        message: 'missing listener stop requirement'
      },
      {
        pattern: /Closeout bundle[\s\S]*summary of what the sequence accomplished[\s\S]*summary of lessons captured[\s\S]*action items revealed but not yet codified[\s\S]*recommended_next_command: clear/i,
        message: 'missing full closeout bundle contract'
      }
    ]
  },
  {
    id: 'operational_loop_closure',
    relPath: 'tools/codex/prompt-system/claude-prompt-pack-operational-loop-closure.md',
    rules: [
      {
        pattern: /Launch exactly two read-only subagents in parallel/i,
        message: 'missing exact two read-only subagents rule'
      },
      {
        pattern: /Keep the main thread thin/i,
        message: 'missing thin main-thread rule'
      },
      {
        pattern: /Validate that slice with an independent read-only validator/i,
        message: 'missing independent validator step'
      },
      {
        pattern: /signals:watch:codex:start/i,
        message: 'missing listener start requirement'
      },
      {
        pattern: /signals:watch:codex:stop/i,
        message: 'missing listener stop requirement'
      },
      {
        pattern: /Closeout bundle[\s\S]*summary of what the pass completed[\s\S]*summary of lessons captured[\s\S]*action items revealed but not yet codified[\s\S]*recommended_next_command: clear/i,
        message: 'missing full closeout bundle contract'
      }
    ]
  },
  {
    id: 'multiagent_planning_and_compliance',
    relPath: 'tools/codex/prompt-system/claude-prompt-pack-multiagent-planning-and-compliance.md',
    rules: [
      {
        pattern: /Keep the main thread thin/i,
        message: 'missing thin main-thread rule'
      },
      {
        pattern: /Launch exactly 3 read-only subagents in parallel/i,
        message: 'missing exact three read-only subagents rule'
      },
      {
        pattern: /Synthesize the findings in the main thread/i,
        message: 'missing main-thread synthesis step'
      },
      {
        pattern: /verification matrix before any implementation recommendation/i,
        message: 'missing verification-matrix-first rule'
      },
      {
        pattern: /execution handoff packet with exact next commands/i,
        message: 'missing exact-next-commands handoff rule'
      },
      {
        pattern: /Write-owning workers are not used in this planning pack/i,
        message: 'missing read-only planning boundary'
      }
    ]
  },
  {
    id: 'debrief_and_clear_readiness',
    relPath: 'tools/codex/prompt-system/claude-run-debrief-and-clear-readiness.md',
    rules: [
      {
        pattern: /Required output order:[\s\S]*Debrief packet[\s\S]*Lessons summary[\s\S]*Uncodified action items[\s\S]*Code-validation summary[\s\S]*Clear-readiness decision/i,
        message: 'missing required closeout order'
      },
      {
        pattern: /Surface any action items revealed by the sequence that were NOT yet codified/i,
        message: 'missing uncodified action items rule'
      },
      {
        pattern: /recommended_next_command: clear/i,
        message: 'missing clear recommendation rule'
      },
      {
        pattern: /Do not emit `recommended_next_command: clear` before the debrief and validation work is done/i,
        message: 'missing clear gating rule'
      }
    ]
  }
];

function validatePromptContractFile(filePath) {
  const normalizedPath = path.resolve(filePath).replace(/\\/g, '/');
  const contract = promptContracts.find((entry) => normalizedPath.endsWith(entry.relPath));
  if (!contract) {
    return {
      valid: false,
      errors: [`no prompt-pack contract defined for ${filePath}`]
    };
  }
  const content = readText(filePath);
  const errors = validateTextRules(content, contract.rules);
  return { valid: errors.length === 0, errors };
}

function validateExecutePlanContractFile(filePath) {
  const content = readText(filePath);
  const errors = validateTextRules(content, executePlanRules);
  return { valid: errors.length === 0, errors };
}

module.exports = {
  executePlanRules,
  promptContracts,
  validatePromptContractFile,
  validateExecutePlanContractFile
};
