'use strict';

const fs = require('node:fs');
const { resolveContainedPath } = require('../../reconciliation/lib/evidence-binding.cjs');
const { sha256 } = require('../../reconciliation/lib/normalized-content-hash.cjs');

function reconcileGeneratedSurface({ project_root, source_path, generator_path, output_path, generation_binding } = {}) {
  if (process.env.GENERATED_SURFACE_RECONCILE_V1 === '0') return result('disabled', null, null, null, 'feature_disabled');
  const refs = [source_path, generator_path, output_path].map((ref) => resolveContainedPath(project_root, ref));
  if (refs.some((ref) => ref.state === 'missing')) return result('missing', null, null, null, 'declared_surface_missing');
  if (refs.some((ref) => ref.state !== 'contained')) return result('unclassified', null, null, null, 'path_unowned_or_out_of_bounds');
  if (!generation_binding || !generation_binding.source_sha256 || !generation_binding.generator_sha256 || !generation_binding.output_sha256) return result('unclassified', null, null, null, 'generation_binding_missing');
  const [sourceSha, generatorSha, outputSha] = refs.map((ref) => sha256(fs.readFileSync(ref.path)));
  if (generatorSha !== generation_binding.generator_sha256) return result('generator_version_drift', sourceSha, generatorSha, outputSha, 'generator_source_bytes_changed');
  if (sourceSha !== generation_binding.source_sha256) return result('stale_input', sourceSha, generatorSha, outputSha, 'declared_source_bytes_changed');
  if (outputSha !== generation_binding.output_sha256) return result('byte_drift', sourceSha, generatorSha, outputSha, 'generated_output_bytes_changed');
  return result('clean', sourceSha, generatorSha, outputSha, 'all_generation_binding_hashes_match');
}

function result(state, sourceSha, generatorSha, outputSha, reason) {
  return { schema: 'GeneratedSurfaceVerdict/1.0', state, source_sha256: sourceSha, generator_sha256: generatorSha, output_sha256: outputSha, reason, authority: 'report_only', can_generate: false, can_overwrite: false };
}

module.exports = { reconcileGeneratedSurface };
