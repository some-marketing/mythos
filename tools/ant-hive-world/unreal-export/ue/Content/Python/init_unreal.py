"""
init_unreal.py -- runs automatically on every editor start (including headless).

Deliberately side-effect free. It does NOT rebuild the level: the built level is
saved to disk, so opening the project simply loads it. Rebuilding is an explicit
act, so that opening the editor can never clobber a level the operator is
inspecting.

To rebuild the level from inside the editor (Output Log -> Cmd -> Python):

    import importlib, build_world; importlib.reload(build_world)

...or from the command line, see Tools/BuildLevel.ps1.
"""

import os

import unreal


def _imports_dir():
    return os.path.join(
        unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir()),
        "Imports")


def _summary():
    path = _imports_dir()
    if not os.path.isdir(path):
        return "AntWorld: no Imports directory yet (%s)" % path
    files = sorted(f for f in os.listdir(path) if f.lower().endswith(".json"))
    return "AntWorld: %d import file(s) in %s" % (len(files), path)


unreal.log(_summary())
unreal.log("AntWorld: rebuild with "
           "`import importlib, build_world; importlib.reload(build_world)` "
           "in the Python console.")
