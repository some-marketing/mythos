'use strict';

const ACTOR_LABELS = Object.freeze({
  claude: 'Claude (fast reasoning, orchestration, in-session execution)',
  codex: 'Codex (slow rigor, code-truth verification)',
  gemini: 'Gemini (contextual breadth, reframing, big picture)',
  manual: 'Manual (paste prompt into any model/harness, save the reply file)',
  'local-qwen': 'Local qwen3:4b (fast local lobe, Ollama)',
  'local-deepseek': 'Local deepseek-r1:14b (local reasoning lobe, Ollama)',
  'local-coder': 'Local qwen2.5-coder:14b (local code/structure lobe, Ollama)',
  'local-gemma': 'Local gemma4:31b (local breadth lobe, Ollama; heavy)',
  'openrouter-anthropic/claude-sonnet-4': 'OpenRouter: Claude Sonnet 4 (fast reasoning)',
  'openrouter-openai/gpt-4o': 'OpenRouter: GPT-4o (code truth, verification)',
  'openrouter-google/gemini-2.5-pro': 'OpenRouter: Gemini 2.5 Pro (breadth, reframing)'
});

const PROFILES = Object.freeze({
  kernel: Object.freeze({
    id: 'kernel',
    label: 'Kernel triad',
    description: 'Default three-lobe kernel triad: fast lobe, slow lobe, contextual breadth lobe.',
    consequence_grade: true,
    slots: Object.freeze([
      Object.freeze({
        id: 'alpha',
        label: 'ALPHA',
        function: 'Intent, memory, originating principle, and fast orchestration.',
        default_actor: 'claude'
      }),
      Object.freeze({
        id: 'now',
        label: 'NOW',
        function: 'Repo truth, executable constraints, implementation reality, and falsification.',
        default_actor: 'codex'
      }),
      Object.freeze({
        id: 'omega',
        label: 'OMEGA',
        function: 'Breadth, consequence, future-facing context, and community impact.',
        default_actor: 'gemini'
      })
    ])
  }),
  'code-review': Object.freeze({
    id: 'code-review',
    label: 'Code review triad',
    description: 'Task-focused triad for implementation design or review.',
    consequence_grade: true,
    slots: Object.freeze([
      Object.freeze({
        id: 'intent',
        label: 'INTENT',
        function: 'Clarify requested behavior and integration boundaries.',
        default_actor: 'claude'
      }),
      Object.freeze({
        id: 'truth',
        label: 'TRUTH',
        function: 'Check source, tests, contracts, and executable repo facts.',
        default_actor: 'codex'
      }),
      Object.freeze({
        id: 'edge',
        label: 'EDGE',
        function: 'Look for missed cases, broader implications, and alternate framing.',
        default_actor: 'gemini'
      })
    ])
  }),
  'local-leaf': Object.freeze({
    id: 'local-leaf',
    label: 'Local leaf triad',
    description: 'Low-risk, narrow-scope triad that avoids claiming consequence-grade global consensus.',
    consequence_grade: false,
    slots: Object.freeze([
      Object.freeze({
        id: 'intent',
        label: 'INTENT',
        function: 'Name the bounded leaf question and success condition.',
        default_actor: 'claude'
      }),
      Object.freeze({
        id: 'check',
        label: 'CHECK',
        function: 'Run the narrow repo-truth or mechanical review lane.',
        default_actor: 'codex'
      }),
      Object.freeze({
        id: 'counter',
        label: 'COUNTER',
        function: 'Surface what the narrow lane may be missing without widening authority.',
        default_actor: 'gemini'
      })
    ])
  }),
  'local-council': Object.freeze({
    id: 'local-council',
    label: 'Local council (Ollama, zero-cloud)',
    description: 'Fully local triad on Ollama models — deliberation runs with ZERO cloud dependency. NOT consequence-grade: the lobes are diverse local models but not the cloud distinct-intelligence trio; use for cost-free/private exploration, then escalate to the kernel triad for consequence-grade consensus.',
    consequence_grade: false,
    slots: Object.freeze([
      Object.freeze({
        id: 'alpha',
        label: 'ALPHA',
        function: 'Fast take, intent, breadth.',
        default_actor: 'local-qwen'
      }),
      Object.freeze({
        id: 'now',
        label: 'NOW',
        function: 'Reasoning, rigor, falsification.',
        default_actor: 'local-deepseek'
      }),
      Object.freeze({
        id: 'omega',
        label: 'OMEGA',
        function: 'Structure, implementation reality, code-truth.',
        default_actor: 'local-coder'
      })
    ])
  }),

  'openrouter-triad': Object.freeze({
    id: 'openrouter-triad',
    label: 'OpenRouter triad',
    description: 'Three-lobe deliberation using OpenRouter-hosted models. Models are configurable via --actor overrides. NOT the canonical kernel triad (Claude/Codex/Gemini) — this is a configurable alternative for exploration, cost optimization, or model diversity. NOT consequence-grade unless explicitly validated.',
    consequence_grade: false,
    slots: Object.freeze([
      Object.freeze({
        id: 'alpha',
        label: 'ALPHA',
        function: 'Fast reasoning, intent, orchestration.',
        default_actor: 'openrouter-anthropic/claude-sonnet-4'
      }),
      Object.freeze({
        id: 'now',
        label: 'NOW',
        function: 'Repo truth, code verification, falsification.',
        default_actor: 'openrouter-openai/gpt-4o'
      }),
      Object.freeze({
        id: 'omega',
        label: 'OMEGA',
        function: 'Breadth, consequence, reframing, big picture.',
        default_actor: 'openrouter-google/gemini-2.5-pro'
      })
    ])
  })
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeId(value) {
  return String(value || '').trim().toLowerCase();
}

function listProfiles() {
  return Object.values(PROFILES).map(clone);
}

function getProfile(profileId = 'kernel') {
  const id = normalizeId(profileId) || 'kernel';
  const profile = PROFILES[id];
  if (!profile) {
    throw new Error(`Unknown --profile "${profileId}". Expected one of: ${Object.keys(PROFILES).join(', ')}`);
  }
  return clone(profile);
}

function parseActorOverrides(entries = []) {
  const overrides = {};
  for (const entry of entries) {
    const raw = String(entry || '').trim();
    if (!raw) continue;
    const idx = raw.indexOf('=');
    if (idx === -1) {
      throw new Error(`Invalid --actor "${raw}". Expected slot=actor.`);
    }
    const slot = normalizeId(raw.slice(0, idx));
    const actor = normalizeId(raw.slice(idx + 1));
    if (!slot || !actor) {
      throw new Error(`Invalid --actor "${raw}". Expected non-empty slot=actor.`);
    }
    overrides[slot] = actor;
  }
  return overrides;
}

function resolveTriad(args = {}) {
  const profile = getProfile(args.profile || 'kernel');
  const overrides = parseActorOverrides(args.actorOverrides || []);
  const slots = profile.slots.map((slot) => ({
    ...slot,
    actor: overrides[normalizeId(slot.id)] || normalizeId(slot.default_actor)
  }));

  const actorCounts = new Map();
  for (const slot of slots) {
    actorCounts.set(slot.actor, (actorCounts.get(slot.actor) || 0) + 1);
  }

  return {
    ...profile,
    slots,
    actor_labels: ACTOR_LABELS,
    duplicate_actors: Array.from(actorCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([actor]) => actor)
  };
}

function describeSlot(slot, actorLabels = ACTOR_LABELS) {
  const actorLabel = actorLabels[slot.actor] || slot.actor;
  return `${slot.label} / ${slot.actor} — ${slot.function} (${actorLabel})`;
}

module.exports = {
  ACTOR_LABELS,
  getProfile,
  listProfiles,
  parseActorOverrides,
  resolveTriad,
  describeSlot
};
