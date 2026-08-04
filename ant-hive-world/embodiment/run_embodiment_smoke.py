#!/usr/bin/env python
"""tools/ant-hive-world/embodiment/run_embodiment_smoke.py -- plan
ant-hive-world-embodiment-s1, S3.

Loads the S2 scene, steps the simulation with a placeholder (no-op) policy
-- zero control input, since there are no actuators in this scene at all;
the body falls and settles purely under gravity and ground contact, no
decision-making involved yet -- and logs EVERY step as a JSON line with:
simulation time, full qpos (position+orientation), full qvel (linear+
angular velocity), and a run-identity field (scene file name + a hash of
its contents) binding the log to exactly this run and this scene.

Per the reviewed feasibility guidance: run for enough simulated time
(5.0s) for the body to complete its fall, any bounce, and settle well
within the trailing verification window.
"""

import hashlib
import json
import os
import sys
import time as _time

import mujoco

HERE = os.path.dirname(os.path.abspath(__file__))
SCENE_PATH = os.path.join(HERE, "scene.xml")
LOG_PATH = os.path.join(HERE, "run-log.jsonl")

SIM_DURATION_S = 5.0


def scene_identity(scene_path):
    with open(scene_path, "rb") as f:
        contents = f.read()
    return {
        "scene_file": os.path.basename(scene_path),
        "scene_sha256": hashlib.sha256(contents).hexdigest(),
    }


def main():
    model = mujoco.MjModel.from_xml_path(SCENE_PATH)
    data = mujoco.MjData(model)

    identity = scene_identity(SCENE_PATH)
    n_steps = int(SIM_DURATION_S / model.opt.timestep)

    with open(LOG_PATH, "w") as log_file:
        for _ in range(n_steps):
            mujoco.mj_step(model, data)
            entry = {
                "sim_time": float(data.time),
                "qpos": data.qpos.tolist(),
                "qvel": data.qvel.tolist(),
                "scene_file": identity["scene_file"],
                "scene_sha256": identity["scene_sha256"],
            }
            log_file.write(json.dumps(entry) + "\n")

    print(
        "RUN_EMBODIMENT_SMOKE_OK steps=%d sim_seconds=%.3f log=%s"
        % (n_steps, data.time, LOG_PATH)
    )


if __name__ == "__main__":
    main()
