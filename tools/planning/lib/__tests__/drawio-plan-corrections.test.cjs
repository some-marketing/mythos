'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const {
  decodeDiagramPayload,
  importCorrections,
  parseDrawioXml,
  writeDrawioExport
} = require('../drawio-plan-corrections.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drawio-plan-corrections-'));
  const planRoot = path.join(root, '_dev/reports/analysis/task-plans');
  writeJson(path.join(planRoot, 'parent-plan__plan.json'), {
    task_id: 'parent-plan',
    title: 'Parent Plan',
    scope_type: 'system',
    bounded_plan: { steps: [{ step_id: 'p1', status: 'ready' }] }
  });
  writeJson(path.join(planRoot, 'child-plan__plan.json'), {
    task_id: 'child-plan',
    title: 'Child Plan',
    scope_type: 'system',
    parent_task_id: 'parent-plan',
    description: 'Mentions related-plan as nearby work, but does not declare it.',
    routing_expectations: { review_lane: 'codex-bridge', risk_tier: 'medium' },
    bounded_plan: { steps: [{ step_id: 'c1', status: 'ready' }] }
  });
  writeJson(path.join(planRoot, 'related-plan__plan.json'), {
    task_id: 'related-plan',
    title: 'Related Plan',
    scope_type: 'system',
    bounded_plan: { steps: [{ step_id: 'r1', status: 'planned' }] }
  });
  return root;
}

function removeUserObjectById(xml, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return xml.replace(new RegExp(`\\s*<UserObject\\b[^>]*id="${escaped}"[\\s\\S]*?<\\/UserObject>`, 'm'), '');
}

function compressGraphPayload(xml) {
  const graph = xml.match(/<mxGraphModel[\s\S]*<\/mxGraphModel>/)[0];
  const compressed = zlib.deflateRawSync(Buffer.from(graph, 'utf8')).toString('base64');
  return `<?xml version="1.0" encoding="UTF-8"?><mxfile><diagram id="compressed">${compressed}</diagram></mxfile>`;
}

test('drawio export writes uncompressed UserObject XML and baseline sidecar', () => {
  const root = makeRoot();
  const output = writeDrawioExport(root, {
    taskId: 'child-plan',
    output: '_dev/reports/analysis/visual-plans/child-plan.drawio'
  });

  const xml = fs.readFileSync(path.join(root, output.diagramPath), 'utf8');
  const baseline = JSON.parse(fs.readFileSync(path.join(root, output.baselinePath), 'utf8'));
  assert.match(xml, /<mxGraphModel/);
  assert.match(xml, /<UserObject/);
  assert.match(xml, /task_id="child-plan"/);
  assert.equal(baseline.schema, 'VisualPlanBaseline/1.0');
  assert.equal(baseline.scope.kind, 'plan');
  assert.ok(baseline.baseline_model_hash);
  assert.ok(Object.values(baseline.edges).some((edge) => edge.relationship_type === 'parent' && edge.correctable === true));
  assert.ok(Object.values(baseline.edges).some((edge) => edge.relationship_type === 'mentions' && edge.correctable === false));
});

test('drawio importer produces corrections without mutating source plans', () => {
  const root = makeRoot();
  const output = writeDrawioExport(root, {
    taskId: 'child-plan',
    output: '_dev/reports/analysis/visual-plans/child-plan.drawio'
  });
  const diagramPath = path.join(root, output.diagramPath);
  const baseline = JSON.parse(fs.readFileSync(path.join(root, output.baselinePath), 'utf8'));
  const sourcePlanPath = path.join(root, '_dev/reports/analysis/task-plans/child-plan__plan.json');
  const sourceBefore = fs.readFileSync(sourcePlanPath, 'utf8');
  const parentEdge = Object.values(baseline.edges).find((edge) => edge.relationship_type === 'parent');
  const derivedEdge = Object.values(baseline.edges).find((edge) => edge.relationship_type === 'mentions');

  let edited = fs.readFileSync(diagramPath, 'utf8');
  edited = edited.replace('value="Child Plan"', 'value="[WRONG] Child Plan Revised [[note:check this plan]]"');
  edited = edited.replace(`id="${parentEdge.id}" value="parent"`, `id="${parentEdge.id}" value="dependency"`);
  edited = removeUserObjectById(edited, derivedEdge.id);
  edited = edited.replace(
    '</root>',
    '<mxCell id="operator-edge-1" value="review" edge="1" parent="1" source="plan:parent-plan" target="plan:related-plan"><mxGeometry relative="1" as="geometry" /></mxCell><mxCell id="operator-note-1" value="Operator sticky note" vertex="1" parent="1" style="shape=note;fillColor=#fff2cc;"><mxGeometry x="40" y="40" width="160" height="80" as="geometry" /></mxCell></root>'
  );
  fs.writeFileSync(diagramPath, edited);

  const result = importCorrections(root, {
    diagramPath: output.diagramPath,
    baselinePath: output.baselinePath,
    importedAt: '2026-06-23T00:00:00Z'
  });

  const types = result.packet.corrections.map((correction) => correction.type);
  assert.ok(types.includes('rename_node'));
  assert.ok(types.includes('mark_node_wrong'));
  assert.ok(types.includes('operator_note'));
  assert.ok(types.includes('change_relationship_type'));
  assert.ok(types.includes('add_relationship'));
  assert.ok(result.packet.corrections.some((correction) => (
    correction.type === 'operator_note'
    && correction.evidence === 'read_only_relationship_removed'
  )));
  assert.ok(result.packet.corrections.some((correction) => (
    correction.type === 'rename_node'
    && correction.target_field === 'title_or_summary'
    && correction.immutable_identity === true
  )));
  assert.equal(fs.readFileSync(sourcePlanPath, 'utf8'), sourceBefore);
  assert.match(result.amendmentDraftMarkdown, /Visual Plan Correction Draft/);
  assert.match(result.amendmentDraftMarkdown, /### child-plan/);
});

test('drawio parser supports compressed and multi-page diagram payloads', () => {
  const root = makeRoot();
  const output = writeDrawioExport(root, {
    taskId: 'child-plan',
    output: '_dev/reports/analysis/visual-plans/child-plan.drawio'
  });
  const xml = fs.readFileSync(path.join(root, output.diagramPath), 'utf8');
  const compressedXml = compressGraphPayload(xml);
  const parsedCompressed = parseDrawioXml(compressedXml);
  assert.equal(parsedCompressed.pages, 1);
  assert.ok(parsedCompressed.nodes['plan:child-plan']);

  const compressedPayload = compressedXml.match(/<diagram[^>]*>([\s\S]*?)<\/diagram>/)[1];
  assert.match(decodeDiagramPayload(compressedPayload), /<mxGraphModel/);

  const graph = xml.match(/<mxGraphModel[\s\S]*<\/mxGraphModel>/)[0];
  const multiPage = `<?xml version="1.0" encoding="UTF-8"?><mxfile><diagram id="one">${graph}</diagram><diagram id="two">${compressedPayload}</diagram></mxfile>`;
  const parsedMulti = parseDrawioXml(multiPage);
  assert.equal(parsedMulti.pages, 2);
  assert.ok(parsedMulti.nodes['plan:child-plan']);
});
