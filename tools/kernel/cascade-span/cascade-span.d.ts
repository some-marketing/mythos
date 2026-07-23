/**
 * cascade-span.d.ts — CascadeSpan/1.0 canonical typed contract (TypeScript face).
 *
 * The typed twin of cascade-span.schema.json. Keep the two in lockstep: any field
 * change must land in BOTH the JSON Schema and this interface. See cascade-span.js
 * for the reference lib and the ownership/consumption note (master-program-of-work
 * Phase-1 owns the identity/lineage discipline; this contract consumes it and adds
 * the enforcement superstructure).
 */

/** Permission/hardening layer an action was classified into (4-phase staging). */
export type ClassifiedLayer = 'read-only' | 'proposal' | 'bounded-patch' | 'autonomous';

/** The enforcement home's ruling on the proposed action. */
export type Verdict = 'allow' | 'deny' | 'escalate';

/**
 * Which home emitted the span. The field that PROVES convergence: identical
 * shape across homes, only this value differs.
 */
export type EnforcementHome = 'claude-hook' | 'tool-broker' | 'native';

/** Terminal status. 'tombstone' = a crashed/TTL-expired lineage-carrying record. */
export type SpanStatus = 'ok' | 'denied' | 'escalated' | 'tombstone';

/** Node/actor identity. Consumes emit-span.cjs {actor_role, harness, model/mind_class}. */
export interface CascadeSpanNode {
  /** Role/identity acting. Owner field: actor_role. */
  actor: string;
  /** Runtime the action ran under. Owner field: harness. */
  harness: string;
  /** Mind family; null when no model took the action (mechanical hook/sweep). */
  model_family: string | null;
}

/** Work/scope lineage. Consumes the owner's live scope/lineage fields. */
export interface CascadeSpanScope {
  /** Owner field: scope_identity (env SM_OS_WORKSTREAM_SCOPE). */
  scope_identity: string | null;
  /** Bounded work-unit id. Owner field: step_id (env SM_OS_STEP_ID). */
  work_unit: string | null;
  /** Root of the cascade lineage. Owner field: lineage_root_session_id. */
  lineage_root?: string | null;
}

/** The action the enforcement home saw and ruled on. */
export interface CascadeSpanAction {
  /** Proposed action, home-neutral (tool name + summary, or 'session-close: <reason>'). */
  proposed: string;
  classified_layer: ClassifiedLayer;
  verdict: Verdict;
}

/** Timestamps supplied by the caller (passive-sensor invariant). */
export interface CascadeSpanTimestamps {
  /** ISO-8601 action start. */
  started_at: string;
  /** ISO-8601 action end; null while in flight. */
  ended_at?: string | null;
}

/**
 * CascadeSpan/1.0 — the canonical enforcement-span envelope.
 * Identity/lineage fields (span_id, parent_span_id, trace_id, scope.*) are
 * consumed from the master-program-of-work Phase-1 owner and MUST carry the
 * owner's semantics across every enforcement home.
 */
export interface CascadeSpan {
  schema_id: 'CascadeSpan/1.0';
  schema_version: '1.0';
  /** This action's span identity. Owner field: span_id. */
  span_id: string;
  /** Lineage edge to the parent span. Owner field: parent_span_id. null at a root. */
  parent_span_id: string | null;
  /** Cascade/correlation id shared across the action tree. Owner field: trace_id. */
  trace_id: string | null;
  node: CascadeSpanNode;
  scope: CascadeSpanScope;
  action: CascadeSpanAction;
  /** Artifact refs recorded with the span (paths/URIs). */
  evidence: string[];
  enforcement_home: EnforcementHome;
  timestamps: CascadeSpanTimestamps;
  status: SpanStatus;
}
