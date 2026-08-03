#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/embodiment-bridge/verify-s1-roundtrip.js -- plan
// ant-hive-world-embodiment-s2-bridge, S1 required gate: "S1's trivial
// round-trip must pass a scripted check before S2 proceeds."
//
// Checks the bridge round trip against the same known-good physics
// embodiment-s1 already verified (sphere radius 0.05m settles to
// qpos[2] ~= 0.05 under gravity) -- this both proves the bridge transport
// works AND that it's returning genuine physics state, not a stub.

const { stepOnRemote } = require('./bridge-client');

const EXPECTED_SETTLED_Z = 0.05;
const Z_TOLERANCE = 0.01;
const STEPS = 2500; // matches embodiment-s1's own 5.0s / 0.002 timestep run

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function main() {
  console.log(`Requesting ${STEPS} steps from the remote host...`);
  const result = stepOnRemote(STEPS);

  const checks = [];

  checks.push({
    name: 'ok field true',
    pass: result.ok === true
  });

  checks.push({
    name: 'qpos has 7 components (freejoint: 3 pos + 4 quat)',
    pass: Array.isArray(result.qpos) && result.qpos.length === 7
  });

  checks.push({
    name: 'qvel has 6 components (freejoint: 3 linear + 3 angular)',
    pass: Array.isArray(result.qvel) && result.qvel.length === 6
  });

  checks.push({
    name: 'no NaN/Inf in qpos or qvel',
    pass: [...(result.qpos || []), ...(result.qvel || [])].every(isFiniteNumber)
  });

  const z = result.qpos ? result.qpos[2] : null;
  checks.push({
    name: `settled height z ~= ${EXPECTED_SETTLED_Z} (+/- ${Z_TOLERANCE}), got ${z}`,
    pass: isFiniteNumber(z) && Math.abs(z - EXPECTED_SETTLED_Z) <= Z_TOLERANCE
  });

  checks.push({
    name: `sim_time matches requested steps (${STEPS} * 0.002 = ${(STEPS * 0.002).toFixed(3)}s)`,
    pass: Math.abs(result.sim_time - STEPS * 0.002) < 1e-9
  });

  let allPass = true;
  for (const check of checks) {
    console.log(`  [${check.pass ? 'PASS' : 'FAIL'}] ${check.name}`);
    if (!check.pass) allPass = false;
  }

  if (allPass) {
    console.log('\nS1_ROUNDTRIP_VERIFIED_OK');
    process.exit(0);
  } else {
    console.log('\nS1_ROUNDTRIP_VERIFICATION_FAILED');
    process.exit(1);
  }
}

main();
