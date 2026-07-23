'use strict';

// ---------------------------------------------------------------------------
// Corrective playbook runner
// ---------------------------------------------------------------------------
// Detects drift triggers from execution context and runs deterministic
// corrective playbooks. Each trigger maps to exactly one response.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Playbook definitions
// ---------------------------------------------------------------------------

/**
 * Canonical playbook registry. Each entry:
 *   trigger      {string} - Machine-readable trigger identifier.
 *   label        {string} - Human-readable trigger name.
 *   description  {string} - What this trigger detects.
 *   detect       {function(context): boolean} - Returns true when trigger fires.
 *   response     {object} - Deterministic corrective response.
 */
var PLAYBOOKS = [
  {
    trigger: 'over_exploration',
    label: 'Over-Exploration',
    description: 'Worker is exploring beyond the bounded plan scope.',
    detect: function (ctx) {
      return ctx.reassess_count > (ctx.max_reassess || 3) ||
        ctx.step_history_length > (ctx.expected_steps || 10) * 2;
    },
    response: {
      action: 'halt_and_refocus',
      message: 'Halt exploration. Return to the current bounded plan step. Do not investigate beyond the declared scope.',
      severity: 'warning'
    }
  },
  {
    trigger: 'blocked_on_actor_bridge_as_success',
    label: 'Blocked-on-Actor Bridged as Success',
    description: 'Worker claims completion but a required actor-bridge is still pending.',
    detect: function (ctx) {
      return ctx.claims_complete === true && ctx.bridge_blocked === true;
    },
    response: {
      action: 'reject_completion',
      message: 'Completion rejected. The required actor-bridge has not reached a terminal state. Do not mark as done until the bridge is consumed or feedback is received.',
      severity: 'error'
    }
  },
  {
    trigger: 'status_dump_too_large',
    label: 'Status Dump Too Large',
    description: 'Status report exceeds token or line bounds.',
    detect: function (ctx) {
      return ctx.token_count > (ctx.max_tokens || 500) ||
        ctx.summary_line_count > (ctx.max_lines || 20);
    },
    response: {
      action: 'truncate_and_reformat',
      message: 'Status report exceeds bounds. Truncate to the declared maximum and re-emit. Do not dump raw logs or full file contents into status.',
      severity: 'warning'
    }
  },
  {
    trigger: 'module_landed_without_integration',
    label: 'Module Landed Without Integration',
    description: 'A new module file was created but not wired into any consumer or index.',
    detect: function (ctx) {
      return ctx.new_files_count > 0 && ctx.integration_references === 0;
    },
    response: {
      action: 'flag_orphan_module',
      message: 'New module(s) created but no integration point found. Wire the module into its consumer, index, or manifest before marking the step done.',
      severity: 'warning'
    }
  },
  {
    trigger: 'markdown_over_json_drift',
    label: 'Markdown-over-JSON Drift',
    description: 'Worker is writing plan data or structured output to markdown instead of canonical JSON.',
    detect: function (ctx) {
      return ctx.md_plan_writes > 0 && ctx.json_plan_writes === 0;
    },
    response: {
      action: 'redirect_to_json',
      message: 'Plan artifacts must be written as JSON, not markdown. Markdown is for documentation only. Rewrite the output as canonical JSON.',
      severity: 'error'
    }
  },
  {
    trigger: 'ambiguous_worker_ownership_or_integration_order',
    label: 'Ambiguous Worker Ownership / Integration Order',
    description: 'Multiple workers claim overlapping file ownership or integration order is unclear.',
    detect: function (ctx) {
      return ctx.overlap_count > 0 || ctx.ownership_ambiguous === true;
    },
    response: {
      action: 'halt_and_clarify',
      message: 'File ownership overlap or ambiguous integration order detected. All writes to contested files are blocked. Resolve ownership before proceeding.',
      severity: 'error'
    }
  },
  {
    trigger: 'broad_output_scraping',
    label: 'Broad Output Scraping',
    description: 'Worker is reading large volumes of output without filtering.',
    detect: function (ctx) {
      return ctx.unfiltered_read_bytes > (ctx.max_read_bytes || 50000);
    },
    response: {
      action: 'apply_filter',
      message: 'Broad output scraping detected. Apply a log filter or scope the read to only the relevant section. Do not ingest unbounded output.',
      severity: 'warning'
    }
  }
];

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect which playbook triggers fire for the given context.
 *
 * Context is a flat object with fields relevant to each trigger's detect
 * function. Unknown fields are ignored; missing fields default to safe values.
 *
 * @param {object} context - Execution context with numeric and boolean fields.
 * @returns {Array<{ trigger: string, label: string, response: object }>}
 */
function detectTrigger(context) {
  var ctx = context || {};
  var fired = [];

  for (var i = 0; i < PLAYBOOKS.length; i++) {
    var pb = PLAYBOOKS[i];
    var matches = false;
    try {
      matches = pb.detect(ctx);
    } catch (_err) {
      // Detection function threw — treat as no match
      matches = false;
    }
    if (matches) {
      fired.push({
        trigger: pb.trigger,
        label: pb.label,
        response: pb.response
      });
    }
  }

  return fired;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Run a specific playbook by trigger name.
 *
 * @param {string} trigger - Trigger identifier.
 * @returns {{ found: boolean, trigger: string, response: object|null }}
 */
function runPlaybook(trigger) {
  for (var i = 0; i < PLAYBOOKS.length; i++) {
    if (PLAYBOOKS[i].trigger === trigger) {
      return {
        found: true,
        trigger: trigger,
        response: PLAYBOOKS[i].response
      };
    }
  }

  return {
    found: false,
    trigger: trigger,
    response: null
  };
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

/**
 * List all registered playbooks with their metadata.
 *
 * @returns {Array<{ trigger: string, label: string, description: string, severity: string }>}
 */
function listPlaybooks() {
  return PLAYBOOKS.map(function (pb) {
    return {
      trigger: pb.trigger,
      label: pb.label,
      description: pb.description,
      severity: pb.response.severity
    };
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  detectTrigger: detectTrigger,
  runPlaybook: runPlaybook,
  listPlaybooks: listPlaybooks
};
