export type DebriefProjectionOutcome = 'allow' | 'deny' | 'tombstone';

export interface DebriefCloseSpanProjection {
  schema_id: 'DebriefCloseSpanProjection/1.0';
  span_schema_version: '1.0';
  event_class: 'debrief-close-decision';
  node_actor: string;
  logical_session_id: string;
  scope_identity: string | null;
  work_unit: string | null;
  lineage_root: string | null;
  parent_span_id: string | null;
  trace_id: string;
  layer_depth: number;
  logical_call_site: 'debrief_before_closeout';
  action_id: string;
  outcome: DebriefProjectionOutcome;
  enforced: boolean;
  tombstone: boolean;
}

export interface DebriefCloseCorrelationContext {
  action_id: string;
  trace_id: string;
  parent_span_id: string | null;
  logical_session_id: string;
  scope_identity: string | null;
  work_unit: string | null;
  lineage_root: string | null;
  layer_depth: number;
  logical_call_site: 'debrief_before_closeout';
}
