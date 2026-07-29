'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { buildPlanVisibilityModel } = require('./plan-visibility');

const VISUAL_ROOT = path.join('_dev', 'reports', 'analysis', 'visual-plans');
const DECLARED_RELATIONSHIP_TYPES = new Set(['parent', 'component', 'references', 'overlap']);

function stableHash(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 12);
}

function stableNodeId(taskId) {
  return `plan:${taskId}`;
}

function stableEdgeId(relationship) {
  return `rel:${stableHash(`${relationship.source}\u0000${relationship.type}\u0000${relationship.target}\u0000${relationship.evidence || ''}`)}`;
}

function xmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;'
  }[ch]));
}

function xmlUnescape(value) {
  return String(value ?? '')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function toRelative(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join('/');
}

function defaultExportPaths(scopeId) {
  const safeId = String(scopeId || 'visual-plan').replace(/[^a-zA-Z0-9._-]+/g, '-');
  const diagramPath = path.join(VISUAL_ROOT, `${safeId}.drawio`);
  return {
    diagramPath,
    baselinePath: path.join(VISUAL_ROOT, `${safeId}.baseline.json`)
  };
}

function resolveFocus(model, options = {}) {
  const plansById = new Map(model.plans.map((plan) => [plan.task_id, plan]));
  if (options.taskId) {
    const selected = plansById.get(options.taskId);
    if (!selected) throw new Error(`No visible task plan found for --plan ${options.taskId}`);
    const relatedRelationships = model.relationships.filter((relationship) => (
      relationship.source === options.taskId || relationship.target === options.taskId
    ));
    const ids = new Set([options.taskId]);
    for (const relationship of relatedRelationships) {
      ids.add(relationship.source);
      ids.add(relationship.target);
    }
    return {
      scope: { kind: 'plan', id: options.taskId, label: selected.title || options.taskId },
      plans: [...ids].map((id) => plansById.get(id)).filter(Boolean),
      relationships: relatedRelationships
    };
  }

  if (options.clusterId) {
    const cluster = model.relationship_clusters.find((item) => item.id === options.clusterId);
    if (!cluster) throw new Error(`No relationship cluster found for --cluster ${options.clusterId}`);
    const ids = new Set(cluster.plan_ids || []);
    return {
      scope: { kind: 'cluster', id: options.clusterId, label: cluster.label || options.clusterId },
      plans: [...ids].map((id) => plansById.get(id)).filter(Boolean),
      relationships: model.relationships.filter((relationship) => ids.has(relationship.source) && ids.has(relationship.target))
    };
  }

  throw new Error('Pass exactly one of taskId or clusterId.');
}

function relationshipCorrectable(relationship) {
  return DECLARED_RELATIONSHIP_TYPES.has(relationship.type) && relationship.confidence !== 'derived';
}

function buildBaseline({ projectRoot, generatedAt, includeClient, focus, diagramPath }) {
  const nodes = {};
  focus.plans.forEach((plan, index) => {
    nodes[stableNodeId(plan.task_id)] = {
      id: stableNodeId(plan.task_id),
      task_id: plan.task_id,
      title: plan.title || plan.task_id,
      label: plan.title || plan.task_id,
      source_path: plan.path,
      status: plan.status || 'unknown',
      review_lane: plan.review_lane || 'not-recorded',
      risk_tier: plan.risk_tier || 'not-recorded',
      ordinal: index
    };
  });

  const edges = {};
  focus.relationships.forEach((relationship) => {
    const edgeId = stableEdgeId(relationship);
    edges[edgeId] = {
      id: edgeId,
      source_node_id: stableNodeId(relationship.source),
      target_node_id: stableNodeId(relationship.target),
      source_task_id: relationship.source,
      target_task_id: relationship.target,
      relationship_type: relationship.type,
      relationship_intent: relationship.intent || relationship.type || 'relationship',
      confidence: relationship.confidence || 'unknown',
      confidence_reason: relationship.confidence_reason || '',
      evidence: relationship.evidence || '',
      correctable: relationshipCorrectable(relationship)
    };
  });

  const modelHash = stableHash(JSON.stringify({ nodes, edges }));
  return {
    schema: 'VisualPlanBaseline/1.0',
    generated_at: generatedAt,
    include_client: Boolean(includeClient),
    scope: focus.scope,
    diagram_path: diagramPath,
    baseline_model_hash: modelHash,
    authority: 'derived_context_only',
    correction_boundary: 'Diff edited diagram against this export-time sidecar. Do not regenerate the model for import diffing.',
    nodes,
    edges
  };
}

function renderNodeCell(node, index) {
  const columns = 3;
  const x = 80 + (index % columns) * 260;
  const y = 120 + Math.floor(index / columns) * 150;
  const label = node.label || node.task_id;
  return `      <UserObject id="${xmlEscape(node.id)}" label="${xmlEscape(label)}" smos_kind="plan" task_id="${xmlEscape(node.task_id)}" source_path="${xmlEscape(node.source_path)}" authority_status="derived_context_only" correctable="title_only" status="${xmlEscape(node.status)}" review_lane="${xmlEscape(node.review_lane)}" risk_tier="${xmlEscape(node.risk_tier)}">
        <mxCell id="${xmlEscape(node.id)}" value="${xmlEscape(label)}" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">
          <mxGeometry x="${x}" y="${y}" width="210" height="82" as="geometry" />
        </mxCell>
      </UserObject>`;
}

function renderEdgeCell(edge) {
  const style = edge.correctable
    ? 'endArrow=block;html=1;rounded=0;strokeColor=#64748b;'
    : 'endArrow=block;html=1;rounded=0;dashed=1;strokeColor=#9ca3af;';
  const correctable = edge.correctable ? 'relationship' : 'read_only_derived';
  const value = edge.correctable ? edge.relationship_type : `${edge.relationship_type} (read-only)`;
  return `      <UserObject id="${xmlEscape(edge.id)}" label="${xmlEscape(value)}" smos_kind="relationship" source_task_id="${xmlEscape(edge.source_task_id)}" target_task_id="${xmlEscape(edge.target_task_id)}" relationship_type="${xmlEscape(edge.relationship_type)}" relationship_intent="${xmlEscape(edge.relationship_intent)}" confidence="${xmlEscape(edge.confidence)}" correctable="${correctable}" authority_status="derived_context_only">
        <mxCell id="${xmlEscape(edge.id)}" value="${xmlEscape(value)}" style="${xmlEscape(style)}" edge="1" parent="1" source="${xmlEscape(edge.source_node_id)}" target="${xmlEscape(edge.target_node_id)}">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
      </UserObject>`;
}

function renderLegendCell(scope) {
  const label = [
    'Mythos visual correction surface',
    'Edit node labels for title/summary proposals.',
    'Use [WRONG] or [REWRITE] to flag a node.',
    'Drag connectors between mapped nodes for new relationships.',
    'Dashed read-only connectors are derived mentions.'
  ].join('&#xa;');
  return `      <UserObject id="legend:${xmlEscape(scope.id)}" label="${label}" smos_kind="legend" authority_status="derived_context_only">
        <mxCell id="legend:${xmlEscape(scope.id)}" value="${label}" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;" vertex="1" parent="1">
          <mxGeometry x="80" y="20" width="720" height="70" as="geometry" />
        </mxCell>
      </UserObject>`;
}

function renderDrawioXml({ generatedAt, focus, baseline }) {
  const nodes = Object.values(baseline.nodes).sort((a, b) => a.ordinal - b.ordinal || a.task_id.localeCompare(b.task_id));
  const edges = Object.values(baseline.edges).sort((a, b) => a.id.localeCompare(b.id));
  const cells = [
    '<mxCell id="0" />',
    '<mxCell id="1" parent="0" />',
    renderLegendCell(focus.scope),
    ...nodes.map(renderNodeCell),
    ...edges.map(renderEdgeCell)
  ].join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" modified="${xmlEscape(generatedAt)}" agent="Mythos" version="24.7.17" type="device">
  <diagram id="${xmlEscape(stableHash(focus.scope.id))}" name="${xmlEscape(focus.scope.label || focus.scope.id)}">
    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1100" pageHeight="850" math="0" shadow="0">
      <root>
${cells}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;
}

function buildDrawioExport(projectRoot, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const model = buildPlanVisibilityModel(projectRoot, {
    includeClient: Boolean(options.includeClient),
    generatedAt
  });
  const focus = resolveFocus(model, options);
  const defaults = defaultExportPaths(focus.scope.id);
  const relativeDiagramPath = toRelative(projectRoot, path.resolve(projectRoot, options.output || defaults.diagramPath));
  const baseline = buildBaseline({
    projectRoot,
    generatedAt,
    includeClient: options.includeClient,
    focus,
    diagramPath: relativeDiagramPath
  });
  const xml = renderDrawioXml({ generatedAt, focus, baseline });
  return {
    diagramXml: xml,
    baseline,
    diagramPath: relativeDiagramPath,
    baselinePath: toRelative(projectRoot, path.resolve(projectRoot, options.baselineOutput || defaults.baselinePath))
  };
}

function writeDrawioExport(projectRoot, options = {}) {
  const output = buildDrawioExport(projectRoot, options);
  const diagramPath = path.resolve(projectRoot, output.diagramPath);
  const baselinePath = path.resolve(projectRoot, output.baselinePath);
  fs.mkdirSync(path.dirname(diagramPath), { recursive: true });
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(diagramPath, output.diagramXml);
  fs.writeFileSync(baselinePath, `${JSON.stringify(output.baseline, null, 2)}\n`);
  return output;
}

function tryParseWithFastXmlParser(xml) {
  try {
    const { XMLParser } = require('fast-xml-parser');
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      preserveOrder: false,
      trimValues: false,
      parseAttributeValue: false,
      parseTagValue: false
    });
    return parser.parse(xml);
  } catch {
    return null;
  }
}

function decodeDiagramPayload(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  if (raw.startsWith('<mxGraphModel')) return raw;
  const candidates = [raw];
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded !== raw) candidates.push(decoded);
  } catch {
    // Ignore malformed URI escapes and try the raw value.
  }
  for (const candidate of candidates) {
    try {
      const inflated = zlib.inflateRawSync(Buffer.from(candidate, 'base64')).toString('utf8');
      if (inflated.includes('<mxGraphModel')) return inflated;
    } catch {
      // Try next encoding candidate.
    }
    try {
      const decoded = Buffer.from(candidate, 'base64').toString('utf8');
      if (decoded.includes('<mxGraphModel')) return decoded;
    } catch {
      // Try next encoding candidate.
    }
  }
  return raw;
}

function extractDiagramGraphXml(drawioXml) {
  tryParseWithFastXmlParser(drawioXml);
  const pages = [];
  const diagramRe = /<diagram\b[^>]*>([\s\S]*?)<\/diagram>/g;
  let match;
  while ((match = diagramRe.exec(drawioXml)) !== null) {
    const content = match[1].trim();
    pages.push(decodeDiagramPayload(content));
  }
  if (!pages.length && drawioXml.includes('<mxGraphModel')) pages.push(drawioXml);
  return pages.filter((page) => page.includes('<mxGraphModel'));
}

function parseAttributes(text) {
  const attrs = {};
  const attrRe = /([A-Za-z_:][-A-Za-z0-9_:.]*)="([^"]*)"/g;
  let match;
  while ((match = attrRe.exec(text)) !== null) {
    attrs[match[1]] = xmlUnescape(match[2]);
  }
  return attrs;
}

function parseUserObjects(graphXml) {
  const objects = [];
  const userObjectRe = /<UserObject\b([^>]*)>([\s\S]*?)<\/UserObject>/g;
  let match;
  while ((match = userObjectRe.exec(graphXml)) !== null) {
    const attrs = parseAttributes(match[1]);
    const body = match[2];
    const mxMatch = body.match(/<mxCell\b([^>]*)>/);
    const mxCell = mxMatch ? parseAttributes(mxMatch[1]) : {};
    objects.push({ attrs, mxCell });
  }
  return objects;
}

function parseLooseCells(graphXml) {
  const knownIds = new Set(parseUserObjects(graphXml).map((object) => object.mxCell.id || object.attrs.id).filter(Boolean));
  const cells = [];
  const cellRe = /<mxCell\b([^>]*)>/g;
  let match;
  while ((match = cellRe.exec(graphXml)) !== null) {
    const mxCell = parseAttributes(match[1]);
    if (!mxCell.id || knownIds.has(mxCell.id) || mxCell.id === '0' || mxCell.id === '1') continue;
    cells.push(mxCell);
  }
  return cells;
}

function parseDrawioXml(drawioXml) {
  const pages = extractDiagramGraphXml(drawioXml);
  const nodes = {};
  const edges = {};
  const notes = [];

  for (const pageXml of pages) {
    for (const object of parseUserObjects(pageXml)) {
      const attrs = object.attrs;
      const mxCell = object.mxCell;
      const id = mxCell.id || attrs.id;
      const label = mxCell.value || attrs.label || '';
      if (attrs.smos_kind === 'plan' || mxCell.vertex === '1' && attrs.task_id) {
        nodes[id] = {
          id,
          task_id: attrs.task_id,
          label: xmlUnescape(label),
          source_path: attrs.source_path || '',
          correctable: attrs.correctable || ''
        };
      } else if (attrs.smos_kind === 'relationship' || mxCell.edge === '1') {
        edges[id] = {
          id,
          label: xmlUnescape(label),
          source_node_id: mxCell.source || attrs.source_node_id,
          target_node_id: mxCell.target || attrs.target_node_id,
          source_task_id: attrs.source_task_id,
          target_task_id: attrs.target_task_id,
          relationship_type: attrs.relationship_type,
          relationship_intent: attrs.relationship_intent,
          confidence: attrs.confidence,
          correctable: attrs.correctable || ''
        };
      } else if (attrs.smos_kind !== 'legend' && String(label).trim()) {
        notes.push({ id, label: xmlUnescape(label), reason: 'unmapped_user_object' });
      }
    }

    for (const cell of parseLooseCells(pageXml)) {
      if (cell.vertex === '1' && String(cell.value || '').trim()) {
        notes.push({ id: cell.id, label: xmlUnescape(cell.value), reason: 'unmapped_shape' });
      } else if (cell.edge === '1') {
        edges[cell.id] = {
          id: cell.id,
          label: xmlUnescape(cell.value || ''),
          source_node_id: cell.source,
          target_node_id: cell.target,
          correctable: 'new_relationship'
        };
      }
    }
  }

  return { pages: pages.length, nodes, edges, notes };
}

function cleanLabelForComparison(label) {
  return String(label || '')
    .replace(/^\s*\[(WRONG|REWRITE)\]\s*/i, '')
    .replace(/\[\[note:[\s\S]*?\]\]/gi, '')
    .trim();
}

function extractNote(label) {
  const match = String(label || '').match(/\[\[note:([\s\S]*?)\]\]/i);
  return match ? match[1].trim() : null;
}

function isWrongLabel(label) {
  return /^\s*\[(WRONG|REWRITE)\]/i.test(String(label || ''));
}

function makeCorrection(type, fields) {
  return {
    id: `${type}:${stableHash(JSON.stringify(fields))}`,
    type,
    authority: 'operator_observation_pending_review',
    ...fields
  };
}

function importCorrections(projectRoot, options = {}) {
  if (!options.diagramPath) throw new Error('diagramPath is required.');
  const diagramPath = path.resolve(projectRoot, options.diagramPath);
  const baselinePath = path.resolve(projectRoot, options.baselinePath || options.diagramPath.replace(/\.drawio$/i, '.baseline.json'));
  const diagramXml = fs.readFileSync(diagramPath, 'utf8');
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const edited = parseDrawioXml(diagramXml);
  const corrections = [];
  const baselineNodes = baseline.nodes || {};
  const baselineEdges = baseline.edges || {};

  for (const [nodeId, baselineNode] of Object.entries(baselineNodes)) {
    const editedNode = edited.nodes[nodeId];
    if (!editedNode) {
      corrections.push(makeCorrection('mark_node_wrong', {
        target_task_id: baselineNode.task_id,
        target_node_id: nodeId,
        reason: 'node_removed_from_diagram',
        original_label: baselineNode.label
      }));
      continue;
    }
    const note = extractNote(editedNode.label);
    if (note) {
      corrections.push(makeCorrection('operator_note', {
        target_task_id: baselineNode.task_id,
        target_node_id: nodeId,
        note,
        evidence: 'node_label_note'
      }));
    }
    if (isWrongLabel(editedNode.label)) {
      corrections.push(makeCorrection('mark_node_wrong', {
        target_task_id: baselineNode.task_id,
        target_node_id: nodeId,
        reason: 'operator_label_marker',
        observed_label: editedNode.label
      }));
    }
    const cleanEdited = cleanLabelForComparison(editedNode.label);
    const cleanBaseline = cleanLabelForComparison(baselineNode.label);
    if (cleanEdited && cleanEdited !== cleanBaseline) {
      corrections.push(makeCorrection('rename_node', {
        target_task_id: baselineNode.task_id,
        target_node_id: nodeId,
        target_field: 'title_or_summary',
        immutable_identity: true,
        original_label: cleanBaseline,
        proposed_label: cleanEdited
      }));
    }
  }

  for (const note of edited.notes || []) {
    corrections.push(makeCorrection('operator_note', {
      target_task_id: null,
      target_node_id: note.id,
      note: note.label,
      evidence: note.reason
    }));
  }

  for (const [edgeId, baselineEdge] of Object.entries(baselineEdges)) {
    const editedEdge = edited.edges[edgeId];
    if (!editedEdge) {
      if (baselineEdge.correctable) {
        corrections.push(makeCorrection('remove_relationship', {
          source_task_id: baselineEdge.source_task_id,
          target_task_id: baselineEdge.target_task_id,
          relationship_type: baselineEdge.relationship_type,
          relationship_id: edgeId,
          source_mappable: true
        }));
      } else {
        corrections.push(makeCorrection('operator_note', {
          target_task_id: baselineEdge.source_task_id,
          related_task_id: baselineEdge.target_task_id,
          relationship_id: edgeId,
          note: `Operator removed read-only derived relationship ${baselineEdge.source_task_id} -> ${baselineEdge.target_task_id}; review source evidence before changing plan truth.`,
          evidence: 'read_only_relationship_removed'
        }));
      }
      continue;
    }

    const editedType = cleanLabelForComparison(editedEdge.label).replace(/\s+\(read-only\)$/i, '');
    if (editedType && editedType !== baselineEdge.relationship_type) {
      if (baselineEdge.correctable) {
        corrections.push(makeCorrection('change_relationship_type', {
          source_task_id: baselineEdge.source_task_id,
          target_task_id: baselineEdge.target_task_id,
          relationship_id: edgeId,
          original_relationship_type: baselineEdge.relationship_type,
          proposed_relationship_type: editedType,
          source_mappable: true
        }));
      } else {
        corrections.push(makeCorrection('operator_note', {
          target_task_id: baselineEdge.source_task_id,
          related_task_id: baselineEdge.target_task_id,
          relationship_id: edgeId,
          note: `Operator relabeled read-only derived relationship from ${baselineEdge.relationship_type} to ${editedType}; review source evidence before changing plan truth.`,
          evidence: 'read_only_relationship_relabel'
        }));
      }
    }
  }

  for (const [edgeId, edge] of Object.entries(edited.edges)) {
    if (baselineEdges[edgeId]) continue;
    const sourceNode = baselineNodes[edge.source_node_id];
    const targetNode = baselineNodes[edge.target_node_id];
    if (sourceNode && targetNode) {
      corrections.push(makeCorrection('add_relationship', {
        source_task_id: sourceNode.task_id,
        target_task_id: targetNode.task_id,
        relationship_type: cleanLabelForComparison(edge.label) || 'operator_proposed',
        relationship_id: edgeId,
        source_mappable: false,
        note: 'New visual connector requires review before mapping to plan source fields.'
      }));
    } else {
      corrections.push(makeCorrection('operator_note', {
        target_task_id: null,
        target_node_id: edgeId,
        note: `Unmapped connector could not be tied to two known plan nodes: ${edge.source_node_id || 'unknown'} -> ${edge.target_node_id || 'unknown'}.`,
        evidence: 'unmapped_connector'
      }));
    }
  }

  const packet = {
    schema: 'VisualPlanCorrections/1.0',
    authority: 'operator_observation_pending_review',
    diagram_path: toRelative(projectRoot, diagramPath),
    baseline_path: toRelative(projectRoot, baselinePath),
    baseline_model_hash: baseline.baseline_model_hash,
    generated_at: baseline.generated_at,
    imported_at: options.importedAt || new Date().toISOString(),
    scope: baseline.scope,
    parsed_pages: edited.pages,
    correction_count: corrections.length,
    corrections
  };
  return {
    packet,
    amendmentDraftMarkdown: renderAmendmentDraftMarkdown(packet)
  };
}

function groupCorrectionsByTask(corrections) {
  const groups = new Map();
  for (const correction of corrections) {
    const key = correction.target_task_id || correction.source_task_id || 'unmapped';
    const rows = groups.get(key) || [];
    rows.push(correction);
    groups.set(key, rows);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function renderAmendmentDraftMarkdown(packet) {
  const lines = [
    '# Visual Plan Correction Draft',
    '',
    `schema: ${packet.schema}`,
    `authority: ${packet.authority}`,
    `diagram: ${packet.diagram_path}`,
    `baseline: ${packet.baseline_path}`,
    `baseline_model_hash: ${packet.baseline_model_hash}`,
    `imported_at: ${packet.imported_at}`,
    '',
    '> This is a precursor artifact for `/amend-plan`. It records operator observations from a visual diagram and must not be applied without review.',
    '',
    '## Correction Summary',
    '',
    `corrections: ${packet.correction_count}`,
    `scope: ${packet.scope?.kind || 'unknown'}:${packet.scope?.id || 'unknown'}`,
    '',
    '## Per-Plan Drafts'
  ];

  for (const [taskId, corrections] of groupCorrectionsByTask(packet.corrections)) {
    lines.push('', `### ${taskId}`, '');
    for (const correction of corrections) {
      lines.push(`1. ${correction.type}: ${summarizeCorrection(correction)}`);
    }
  }

  lines.push(
    '',
    '## Next Review Command',
    '',
    '`/amend-plan <task-id>` after reviewing the correction packet, or future `npm run plans:amend -- --from-corrections <corrections.json>` once that ingestion path exists.'
  );
  return `${lines.join('\n')}\n`;
}

function summarizeCorrection(correction) {
  if (correction.type === 'rename_node') return `propose title/summary label "${correction.original_label}" -> "${correction.proposed_label}" for ${correction.target_task_id}; identity remains immutable.`;
  if (correction.type === 'mark_node_wrong') return `mark ${correction.target_task_id || correction.target_node_id} for rewrite (${correction.reason}).`;
  if (correction.type === 'add_relationship') return `propose ${correction.source_task_id} -> ${correction.target_task_id} as ${correction.relationship_type}; source mapping requires review.`;
  if (correction.type === 'remove_relationship') return `propose removing ${correction.source_task_id} -> ${correction.target_task_id} (${correction.relationship_type}).`;
  if (correction.type === 'change_relationship_type') return `propose ${correction.source_task_id} -> ${correction.target_task_id} type ${correction.original_relationship_type} -> ${correction.proposed_relationship_type}.`;
  if (correction.type === 'operator_note') return correction.note || 'operator note';
  return JSON.stringify(correction);
}

function writeCorrectionImport(projectRoot, options = {}) {
  const result = importCorrections(projectRoot, options);
  const diagramPath = path.resolve(projectRoot, options.diagramPath);
  const outputDir = path.resolve(projectRoot, options.outputDir || path.dirname(diagramPath));
  const base = path.basename(diagramPath).replace(/\.drawio$/i, '');
  const packetPath = path.join(outputDir, `${base}.corrections.json`);
  const draftPath = path.join(outputDir, `${base}.amendment-draft.md`);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(packetPath, `${JSON.stringify(result.packet, null, 2)}\n`);
  fs.writeFileSync(draftPath, result.amendmentDraftMarkdown);
  return {
    ...result,
    packetPath: toRelative(projectRoot, packetPath),
    draftPath: toRelative(projectRoot, draftPath)
  };
}

module.exports = {
  buildDrawioExport,
  writeDrawioExport,
  decodeDiagramPayload,
  parseDrawioXml,
  importCorrections,
  writeCorrectionImport,
  renderAmendmentDraftMarkdown
};
