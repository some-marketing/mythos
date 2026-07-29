'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const { sha256, stableJson } = require('../transforms/utils.cjs');

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'framework-run-plan.schema.json'), 'utf8'));
const validateSchema = new Ajv2020({ strict: false }).compile(schema);

function graphProblems(nodes) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const problems = [];
  if (byId.size !== nodes.length) problems.push('duplicate_node_id');
  for (const node of nodes) for (const dep of node.dependencies) if (!byId.has(dep)) problems.push(`unknown_dependency:${node.id}:${dep}`);
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) { problems.push(`dependency_cycle:${id}`); return; }
    if (visited.has(id) || !byId.has(id)) return;
    visiting.add(id);
    for (const dep of byId.get(id).dependencies) visit(dep);
    visiting.delete(id); visited.add(id);
  }
  for (const id of byId.keys()) visit(id);
  function dependsOn(nodeId, targetId, seen = new Set()) {
    if (seen.has(nodeId) || !byId.has(nodeId)) return false;
    seen.add(nodeId);
    const deps = byId.get(nodeId).dependencies;
    return deps.includes(targetId) || deps.some((dep) => dependsOn(dep, targetId, seen));
  }
  for (let i = 0; i < nodes.length; i += 1) for (let j = i + 1; j < nodes.length; j += 1) {
    const overlap = nodes[i].writes.filter((item) => nodes[j].writes.includes(item));
    if (overlap.length && !dependsOn(nodes[i].id, nodes[j].id) && !dependsOn(nodes[j].id, nodes[i].id)) problems.push(`parallel_write_overlap:${nodes[i].id}:${nodes[j].id}:${overlap.join(',')}`);
  }
  return [...new Set(problems)];
}

function validateRunPlan(plan, current = {}) {
  const problems = [];
  if (!validateSchema(plan)) problems.push(...validateSchema.errors.map((error) => `schema:${error.instancePath || '/'}:${error.keyword}`));
  if (plan && Array.isArray(plan.nodes)) problems.push(...graphProblems(plan.nodes));
  if (current.manifest && plan && sha256(stableJson(current.manifest)) !== plan.manifest_sha256) problems.push('manifest_hash_drift');
  if (current.inputs_sha256 && plan && current.inputs_sha256 !== plan.inputs_sha256) problems.push('input_hash_drift');
  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}

module.exports = { graphProblems, validateRunPlan };
