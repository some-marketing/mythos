#!/usr/bin/env python
"""tools/ant-hive-world/embodiment-bridge/bridge_step.py -- plan
ant-hive-world-embodiment-s2-bridge, S1 (trivial round-trip) + S2
(perception mapping).

Loads bridge_scene.xml (embodiment-s1's sphere+ground plus one static
target marker, see that file's header), steps it a fixed number of times,
and prints the resulting qpos/qvel AND the S0 Decision-1 perception vector
-- [pos_x, pos_y, pos_z, vel_x, vel_y, vel_z, distance_to_target] -- as ONE
line of JSON to stdout. Still no action mapping or reward mapping (S3-S4).

Deployed to Orwell at C:\\Users\\taylo\\smos_ant_embodiment\\bridge_step.py
and invoked via plain SSH remote command execution from the Node side (see
S1's docstring history for why this replaced the originally-proposed
port-forward transport).

Usage: venv\\Scripts\\python.exe bridge_step.py [--steps N]
"""

import argparse
import json
import math
import os

import mujoco

HERE = os.path.dirname(os.path.abspath(__file__))
SCENE_PATH = os.path.join(HERE, "bridge_scene.xml")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--steps", type=int, default=1)
    args = parser.parse_args()

    model = mujoco.MjModel.from_xml_path(SCENE_PATH)
    data = mujoco.MjData(model)

    target_body_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, "target_marker")
    target_pos = model.body_pos[target_body_id].tolist()

    for _ in range(args.steps):
        mujoco.mj_step(model, data)

    pos = data.qpos[0:3].tolist()
    vel = data.qvel[0:3].tolist()
    distance_to_target = math.sqrt(sum((pos[i] - target_pos[i]) ** 2 for i in range(3)))

    result = {
        "ok": True,
        "steps": args.steps,
        "sim_time": float(data.time),
        "qpos": data.qpos.tolist(),
        "qvel": data.qvel.tolist(),
        "target_pos": target_pos,
        "perception": {
            "pos": pos,
            "vel": vel,
            "distance_to_target": distance_to_target,
        },
    }
    print(json.dumps(result))


if __name__ == "__main__":
    main()
