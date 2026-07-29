'use strict';

/**
 * Leyline physics runtime — S1 (loader) + S2 (evaluator).
 *
 * Membrane: this module only ever reads DERIVED rule-fact records (id,
 * relationForm, subjects, statement-as-data, aboutBeings). It never reads or
 * embeds original source-text prose — the rule-fact JSONL is the only
 * permitted input.
 *
 * Fact provenance: every rule this loader produces carries the source fact's
 * `id` forward. `evaluate()` never fires an effect without recording the
 * firing fact-id in its trace. Facts that cannot be given a
 * condition/effect are reported in `unmapped`, never silently dropped.
 *
 * Determinism: `evaluate(state, rules)` is a pure function — it does not
 * read clocks, randomness, or any input besides its arguments, and returns a
 * fresh state object. Same (state, rules) in => same (state, trace) out,
 * always.
 */

const fs = require('fs');
const readline = require('readline');

// Placeholder progression-tier vocabulary for this worked example. A real
// deployment supplies whatever tier/rank words its own setting uses; the
// engine only ever normalizes and string-matches this list, it never
// attaches meaning to any one word.
const EXAMPLE_RANK_WORDS = [
  'bronze', 'iron', 'silver', 'gold', 'diamond', 'coral', 'obsidian',
  'copper', 'sapphire', 'ruby', 'emerald', 'true',
];

const WORD_NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/**
 * Matches explicit defeat/yield/kill/harvest/trigger language in a fact
 * statement. A `source` fact only becomes an executable defeat mechanic when
 * its own text uses one of these words — otherwise "X is a source of Y" is
 * broad/ambiguous provenance prose, and turning it into a "defeat X to yield
 * Y" rule would fabricate a mechanic the fact never states. Facts that fail
 * this check are parked in `unmapped`.
 */
const EXPLICIT_DEFEAT_YIELD_RE = /\b(defeat(?:s|ed|ing)?|yield(?:s|ed|ing)?|kill(?:s|ed|ing)?|harvest(?:s|ed|ing)?|trigger(?:s|ed|ing)?)\b/i;

function hasExplicitDefeatYieldLanguage(statement) {
  return EXPLICIT_DEFEAT_YIELD_RE.test(statement);
}

function normalizeKey(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Parses an explicit quantity out of a fact statement, if one is stated. */
function parseQuantity(statement) {
  const digitMatch = statement.match(/\b(\d+)\b/);
  if (digitMatch) return parseInt(digitMatch[1], 10);
  const lower = statement.toLowerCase();
  for (const [word, value] of Object.entries(WORD_NUMBERS)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) return value;
  }
  return null;
}

function findRankWord(statement) {
  const lower = statement.toLowerCase();
  for (const word of EXAMPLE_RANK_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) return word;
  }
  return null;
}

/**
 * Deep-clones a plain-JSON-shaped state object. State must stay JSON-safe
 * (no functions, dates, Maps) for the evaluator to remain pure/deterministic.
 */
function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

/** The state containers every rule strategy reads/writes. */
const STATE_CONTAINERS = ['resources', 'entities', 'agents', 'env', 'flags'];

/**
 * Fills in any missing top-level containers a rule strategy touches
 * (resources/entities/agents/env/flags/events) with their empty default, so
 * that `evaluate` is total over ANY partial or empty state — a fresh world
 * with nothing populated yet must not crash. Never overwrites a container
 * that is already present, so it never changes the meaning of a
 * fully-populated state.
 */
function withDefaultedContainers(state) {
  const normalized = { ...state };
  for (const key of STATE_CONTAINERS) {
    if (normalized[key] === undefined || normalized[key] === null) normalized[key] = {};
  }
  if (!Array.isArray(normalized.events)) normalized.events = [];
  return normalized;
}

/**
 * Builds an executable rule from one admitted rule-fact, or returns
 * { unmapped: reason } when the fact's relationForm/subjects don't carry
 * enough structure to derive a condition/effect without fabricating
 * physics not present in the fact record.
 *
 * Strategies are keyed by relationForm and are schema-generic: they read only
 * fields already present on the fact record (relationForm, subjects,
 * statement, aboutBeings), never invented per-fact constants beyond a
 * quantity explicitly stated in the fact's own statement text.
 */
function buildRule(fact) {
  const { id, relationForm, subjects, statement, aboutBeings } = fact;
  const keys = subjects.map(normalizeKey);
  const quantity = parseQuantity(statement) || 1;

  const base = { id, relationForm, subjects, statement, aboutBeings };

  switch (relationForm) {
    case 'source': {
      if (keys.length < 2) {
        return { unmapped: `source requires >=2 subjects, got ${keys.length}` };
      }
      if (!hasExplicitDefeatYieldLanguage(statement)) {
        return { unmapped: 'source-fact lacks explicit defeat/yield trigger' };
      }
      // Generic: an event naming ANY of this fact's subjects as its target
      // (order-agnostic, since fact-record subject ordering is not
      // consistently source-then-product across records) causes every OTHER
      // subject in the fact to be produced as a resource, by the quantity
      // explicitly stated in the fact text (default 1).
      return {
        ...base,
        condition(state) {
          const events = state.events || [];
          return events.some((ev) => ev.type === 'defeat' && keys.includes(normalizeKey(ev.target)));
        },
        effect(state, trace) {
          const events = state.events || [];
          for (const ev of events) {
            if (ev.type !== 'defeat' || !keys.includes(normalizeKey(ev.target))) continue;
            const targetKey = normalizeKey(ev.target);
            for (const productKey of keys) {
              if (productKey === targetKey) continue;
              state.resources[productKey] = (state.resources[productKey] || 0) + quantity;
              trace.push({ factId: id, relationForm, effect: 'resource+', key: productKey, amount: quantity });
            }
          }
        },
      };
    }

    case 'transform': {
      if (keys.length < 1) {
        return { unmapped: 'transform requires >=1 subject' };
      }
      const primaryKey = keys[0];
      const pairKey = keys.length > 1 ? keys[1] : keys[0];
      const flagKey = `transform:${id}`;
      return {
        ...base,
        condition(state) {
          return (state.resources[primaryKey] || 0) > 0;
        },
        effect(state, trace) {
          state.flags[flagKey] = { enabled: true, primary: primaryKey, target: pairKey };
          trace.push({ factId: id, relationForm, effect: 'flag-set', key: flagKey });
        },
      };
    }

    case 'band-response': {
      if (keys.length < 2) {
        return { unmapped: `band-response requires >=2 subjects, got ${keys.length}` };
      }
      const rankWord = findRankWord(statement);
      return {
        ...base,
        condition(state) {
          const agents = Object.values(state.agents || {});
          if (!rankWord) return agents.length > 0;
          return agents.some((agent) => normalizeKey(agent.rank || '') === rankWord);
        },
        effect(state, trace) {
          for (const [agentId, agent] of Object.entries(state.agents || {})) {
            if (rankWord && normalizeKey(agent.rank || '') !== rankWord) continue;
            agent.modifiers = agent.modifiers || {};
            agent.modifiers[id] = { relationForm, rank: agent.rank || null };
            trace.push({ factId: id, relationForm, effect: 'modifier-set', key: agentId });
          }
        },
      };
    }

    case 'gradient': {
      if (keys.length < 2) {
        return { unmapped: `gradient requires >=2 subjects, got ${keys.length}` };
      }
      const driverKey = keys[0];
      const derivedKey = keys[1];
      return {
        ...base,
        condition(state) {
          return typeof (state.env || {})[driverKey] === 'number';
        },
        effect(state, trace) {
          const driverValue = state.env[driverKey];
          state.derived = state.derived || {};
          state.derived[derivedKey] = driverValue;
          trace.push({ factId: id, relationForm, effect: 'derived-scale', key: derivedKey, from: driverKey, value: driverValue });
        },
      };
    }

    case 'diffusion': {
      if (keys.length < 1) {
        return { unmapped: 'diffusion requires >=1 subject' };
      }
      const entityKey = keys[0];
      return {
        ...base,
        condition(state) {
          const entity = (state.entities || {})[entityKey];
          return !!entity && (entity.integrity === undefined || entity.integrity > 0);
        },
        effect(state, trace) {
          const entity = state.entities[entityKey];
          const decay = 1;
          entity.integrity = (entity.integrity === undefined ? 1 : entity.integrity) - decay;
          trace.push({ factId: id, relationForm, effect: 'decay', key: entityKey, integrity: entity.integrity });
          if (entity.integrity <= 0) {
            delete state.entities[entityKey];
            trace.push({ factId: id, relationForm, effect: 'dissolved', key: entityKey });
          }
        },
      };
    }

    case 'threshold-conversion': {
      if (keys.length < 2) {
        return { unmapped: `threshold-conversion requires >=2 subjects, got ${keys.length}` };
      }
      const triggerKey = keys[0];
      const statusKey = `status:${id}`;
      const threshold = quantity;
      return {
        ...base,
        condition(state) {
          return (state.resources[triggerKey] || 0) >= threshold;
        },
        effect(state, trace) {
          state.flags[statusKey] = { active: true, triggerKey, threshold };
          trace.push({ factId: id, relationForm, effect: 'threshold-crossed', key: statusKey, threshold });
        },
      };
    }

    case 'sink': {
      if (keys.length < 1) {
        return { unmapped: 'sink requires >=1 subject' };
      }
      const resourceKey = keys[0];
      const drain = 1;
      return {
        ...base,
        condition(state) {
          return (state.resources[resourceKey] || 0) > 0;
        },
        effect(state, trace) {
          state.resources[resourceKey] = Math.max(0, (state.resources[resourceKey] || 0) - drain);
          trace.push({ factId: id, relationForm, effect: 'resource-', key: resourceKey, amount: drain });
        },
      };
    }

    default: {
      return { unmapped: `no runtime strategy for relationForm "${relationForm}"` };
    }
  }
}

/**
 * Loads a rule-facts JSONL file and maps every admitted fact to an
 * executable rule, or to an unmapped-with-reason entry. Never throws away a
 * fact silently: every line ends up in exactly one of `rules` or `unmapped`.
 */
function loadRuleFacts(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n').filter((line) => line.trim().length > 0);

  const rules = [];
  const unmapped = [];

  for (const line of lines) {
    const record = JSON.parse(line);
    const fact = record.fact;
    const built = buildRule(fact);
    if (built.unmapped) {
      unmapped.push({ id: fact.id, relationForm: fact.relationForm, statement: fact.statement, reason: built.unmapped });
    } else {
      rules.push(built);
    }
  }

  return { rules, unmapped, totalFacts: lines.length };
}

async function loadRuleFactsStreaming(filePath) {
  // Streaming variant retained for large future fact sets; behaviorally
  // identical to loadRuleFacts, just non-blocking I/O.
  const rl = readline.createInterface({ input: fs.createReadStream(filePath, 'utf8'), crlfDelay: Infinity });
  const rules = [];
  const unmapped = [];
  let totalFacts = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    totalFacts += 1;
    const record = JSON.parse(line);
    const fact = record.fact;
    const built = buildRule(fact);
    if (built.unmapped) {
      unmapped.push({ id: fact.id, relationForm: fact.relationForm, statement: fact.statement, reason: built.unmapped });
    } else {
      rules.push(built);
    }
  }
  return { rules, unmapped, totalFacts };
}

/**
 * Pure, deterministic per-tick evaluator (S2). Rules are evaluated in a
 * fixed order (array order, i.e. facts' file order) so that any interacting
 * effects fire identically across runs. Returns a NEW state (input state is
 * never mutated) plus a trace naming every fact-id that fired and what it
 * did.
 */
function evaluate(state, rules) {
  const nextState = withDefaultedContainers(cloneState(state));
  const trace = [];

  for (const rule of rules) {
    // Total over partial state: a rule whose precondition isn't met on this
    // state must simply not fire (never throw). Containers are defaulted
    // above; this try/catch is belt-and-suspenders for any strategy that
    // still reaches into a shape it wasn't guarded for — one rule failing
    // must not abort the whole tick, and the skip is still recorded with
    // the rule's fact-id so provenance is never silently lost.
    try {
      if (rule.condition(nextState)) {
        rule.effect(nextState, trace);
      }
    } catch (err) {
      trace.push({ factId: rule.id, relationForm: rule.relationForm, effect: 'skipped-error', error: err.message });
    }
  }

  return { state: nextState, trace };
}

module.exports = {
  normalizeKey,
  parseQuantity,
  findRankWord,
  hasExplicitDefeatYieldLanguage,
  buildRule,
  loadRuleFacts,
  loadRuleFactsStreaming,
  evaluate,
  cloneState,
  withDefaultedContainers,
};
