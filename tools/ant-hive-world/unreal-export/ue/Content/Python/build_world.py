"""
build_world.py -- data-driven level builder for the ant-hive-world projection.

Reads one UnrealImport/1.0 document and rebuilds /Game/AntWorld/Maps/AntWorld
from scratch: territory tiles as a ground grid, resource/feature markers by
type, chamber builds at their recorded coordinates, and a HUD text panel with
turn id / absolute day range / mirror p-value + verdict.

Read-only with respect to the simulation: it only ever opens an import JSON
that already crossed the courier boundary. It writes nothing outside the
Unreal project directory.

Usage (headless):
  UnrealEditor-Cmd.exe <project>.uproject \
      -ExecutePythonScript="<...>\build_world.py <import.json>" \
      -unattended -nosplash -nop4 -stdout

Import file resolution order:
  1. first script argument (sys.argv[1])
  2. environment variable ANTWORLD_IMPORT
  3. lexicographically last *.json in <project>/Imports/

Evidence: every counted step logs a line prefixed ANTWORLD_STAT, the final
summary logs ANTWORLD_RESULT plus ANTWORLD_OK / ANTWORLD_FAIL, and a machine
readable report is written to <project>/Saved/antworld_build_report.json.
"""

import json
import math
import os
import sys
import traceback

import unreal

# ---------------------------------------------------------------- constants

MAP_PACKAGE = "/Game/AntWorld/Maps/AntWorld"
MAT_DIR = "/Game/AntWorld/Materials"
CELL = 200.0            # unreal units per grid cell
TILE_THICKNESS = 0.2    # z scale of a territory slab (cube mesh is 100uu)
MARKER_OFFSET = 62.0    # feature markers sit off-centre so builds stay visible

MESHES = {
    "cube": "/Engine/BasicShapes/Cube.Cube",
    "sphere": "/Engine/BasicShapes/Sphere.Sphere",
    "cylinder": "/Engine/BasicShapes/Cylinder.Cylinder",
    "cone": "/Engine/BasicShapes/Cone.Cone",
}

# hive identity -> (territory colour, build colour)
HIVE_COLORS = {
    "hive-a": ((0.42, 0.20, 0.06), (1.00, 0.55, 0.10)),
    "hive-b": ((0.05, 0.22, 0.28), (0.15, 0.80, 0.90)),
}
HIVE_FALLBACK = ((0.18, 0.18, 0.18), (0.75, 0.75, 0.75))

# resource type -> (mesh key, colour)
FEATURE_STYLE = {
    "food": ("sphere", (0.20, 0.85, 0.25)),
    "wood": ("cylinder", (0.45, 0.28, 0.10)),
    "stone": ("cube", (0.55, 0.55, 0.58)),
    "clay": ("cone", (0.80, 0.42, 0.20)),
    "water": ("sphere", (0.15, 0.45, 0.95)),
    "ore": ("cube", (0.60, 0.25, 0.85)),
    "fiber": ("cylinder", (0.90, 0.85, 0.45)),
}
FEATURE_FALLBACK = ("cube", (0.90, 0.90, 0.90))

# default amount rendered for a food patch that is only present in
# food_source_coords (i.e. a discrete patch location with no remaining
# amount currently reported in food_sources) -- keeps the marker visible
# at a modest height rather than collapsing to zero.
FOOD_COORD_DEFAULT_AMOUNT = 1.0


def log(msg):
    unreal.log("ANTWORLD %s" % msg)


def stat(key, value):
    unreal.log("ANTWORLD_STAT %s=%s" % (key, value))


# ------------------------------------------------------------ import loading

def project_dir():
    return unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())


def resolve_import_path():
    args = [a for a in sys.argv[1:] if a and not a.startswith("-")]
    if args:
        return args[0]
    env = os.environ.get("ANTWORLD_IMPORT")
    if env:
        return env
    imports = os.path.join(project_dir(), "Imports")
    if os.path.isdir(imports):
        found = sorted(f for f in os.listdir(imports) if f.lower().endswith(".json"))
        if found:
            return os.path.join(imports, found[-1])
    raise RuntimeError("no import file: pass a path, set ANTWORLD_IMPORT, or "
                       "put a .json in %s" % imports)


def load_import(path):
    with open(path, "r", encoding="utf-8") as handle:
        doc = json.load(handle)
    if doc.get("schema") != "UnrealImport/1.0":
        raise RuntimeError("unexpected schema %r (want UnrealImport/1.0)"
                           % doc.get("schema"))
    for key in ("turn_id", "source", "derived", "provenance"):
        if key not in doc:
            raise RuntimeError("import missing required key %r" % key)
    return doc


# ------------------------------------------------------------ grid geometry

def tile_index(tile_id):
    """'tile-70' / 'wood-tile-93' -> 70 / 93. Returns None when unparseable."""
    tail = tile_id.rsplit("-", 1)[-1]
    try:
        return int(tail)
    except (TypeError, ValueError):
        return None


def infer_grid_width(source):
    """Recover the grid width from any coordinate map: index = y * width + x."""
    votes = {}
    for key, value in source.items():
        if not key.endswith("_coords") or not isinstance(value, dict):
            continue
        for tile_id, coords in value.items():
            idx = tile_index(tile_id)
            if idx is None or not isinstance(coords, list) or len(coords) < 2:
                continue
            x, y = int(coords[0]), int(coords[1])
            if y <= 0:
                continue
            if (idx - x) % y:
                continue
            width = (idx - x) // y
            if width > 0:
                votes[width] = votes.get(width, 0) + 1
    if votes:
        return max(votes.items(), key=lambda kv: (kv[1], -kv[0]))[0]
    territory = source.get("territory") or {}
    if territory:
        return int(math.ceil(math.sqrt(len(territory)))) or 1
    return 1


def cell_to_world(x, y, z=0.0):
    return unreal.Vector(float(x) * CELL, float(y) * CELL, float(z))


# --------------------------------------------------------------- asset setup

def asset_tools():
    return unreal.AssetToolsHelpers.get_asset_tools()


def ensure_base_material():
    path = "%s/M_AntWorld" % MAT_DIR
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        return unreal.EditorAssetLibrary.load_asset(path)
    unreal.EditorAssetLibrary.make_directory(MAT_DIR)
    mat = asset_tools().create_asset("M_AntWorld", MAT_DIR, unreal.Material,
                                     unreal.MaterialFactoryNew())
    mel = unreal.MaterialEditingLibrary
    color = mel.create_material_expression(
        mat, unreal.MaterialExpressionVectorParameter, -400, 0)
    color.set_editor_property("parameter_name", "Color")
    color.set_editor_property("default_value",
                              unreal.LinearColor(0.5, 0.5, 0.5, 1.0))
    mel.connect_material_property(color, "", unreal.MaterialProperty.MP_BASE_COLOR)

    rough = mel.create_material_expression(
        mat, unreal.MaterialExpressionScalarParameter, -400, 250)
    rough.set_editor_property("parameter_name", "Roughness")
    rough.set_editor_property("default_value", 0.65)
    mel.connect_material_property(rough, "", unreal.MaterialProperty.MP_ROUGHNESS)

    mel.recompile_material(mat)
    unreal.EditorAssetLibrary.save_asset(path)
    return mat


class MaterialCache(object):
    def __init__(self, base):
        self.base = base
        self.cache = {}
        self.created = 0

    def get(self, name, rgb):
        if name in self.cache:
            return self.cache[name]
        path = "%s/%s" % (MAT_DIR, name)
        if unreal.EditorAssetLibrary.does_asset_exist(path):
            mic = unreal.EditorAssetLibrary.load_asset(path)
        else:
            mic = asset_tools().create_asset(
                name, MAT_DIR, unreal.MaterialInstanceConstant,
                unreal.MaterialInstanceConstantFactoryNew())
            self.created += 1
        mel = unreal.MaterialEditingLibrary
        mel.set_material_instance_parent(mic, self.base)
        mel.set_material_instance_vector_parameter_value(
            mic, "Color", unreal.LinearColor(rgb[0], rgb[1], rgb[2], 1.0))
        unreal.EditorAssetLibrary.save_loaded_asset(mic)
        self.cache[name] = mic
        return mic


def load_meshes():
    meshes = {}
    for key, path in MESHES.items():
        mesh = unreal.EditorAssetLibrary.load_asset(path)
        if mesh is None:
            raise RuntimeError("could not load engine basic shape %s" % path)
        meshes[key] = mesh
    return meshes


# ----------------------------------------------------------------- level ops

def level_subsystem():
    return unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)


def actor_subsystem():
    return unreal.get_editor_subsystem(unreal.EditorActorSubsystem)


def open_blank_level():
    """Idempotent: reuse the map if it exists (emptied), otherwise create it."""
    les = level_subsystem()
    if unreal.EditorAssetLibrary.does_asset_exist(MAP_PACKAGE):
        les.load_level(MAP_PACKAGE)
        removed = 0
        for actor in actor_subsystem().get_all_level_actors():
            try:
                if isinstance(actor, unreal.WorldSettings):
                    continue
                actor_subsystem().destroy_actor(actor)
                removed += 1
            except Exception:
                pass
        stat("actors_cleared", removed)
        return "reused"
    les.new_level(MAP_PACKAGE)
    stat("actors_cleared", 0)
    return "created"


def spawn_mesh(mesh, material, location, scale, label, folder):
    actor = actor_subsystem().spawn_actor_from_class(
        unreal.StaticMeshActor, location, unreal.Rotator(0.0, 0.0, 0.0))
    component = actor.static_mesh_component
    component.set_static_mesh(mesh)
    if material is not None:
        component.set_material(0, material)
    actor.set_actor_scale3d(scale)
    actor.set_actor_label(label)
    actor.set_folder_path(folder)
    return actor


# ------------------------------------------------------------------- builder

def build_territory(source, width, meshes, mats):
    territory = source.get("territory") or {}
    count = 0
    skipped = 0
    for tile_id, hive in sorted(territory.items(), key=lambda kv: (tile_index(kv[0]) or 0)):
        idx = tile_index(tile_id)
        if idx is None:
            skipped += 1
            continue
        x, y = idx % width, idx // width
        color = HIVE_COLORS.get(hive, HIVE_FALLBACK)[0]
        mat = mats.get("MI_Territory_%s" % hive.replace("-", "_"), color)
        spawn_mesh(meshes["cube"], mat,
                   cell_to_world(x, y, -10.0),
                   unreal.Vector(1.9, 1.9, TILE_THICKNESS),
                   "Territory_%s_%s" % (tile_id, hive),
                   unreal.Name("AntWorld/Territory"))
        count += 1
    stat("territory_tiles", count)
    stat("territory_skipped", skipped)
    return count, skipped


def collect_features(source):
    """Every *_sources map flattened to (resource, tile_id, amount), unioned
    with food_source_coords so discrete food patches still render a marker
    even when the current food_sources map has drained/omitted that tile.
    Dedupe is by (resource, tile_id): a tile already present in food_sources
    keeps its reported amount, coords-only tiles get FOOD_COORD_DEFAULT_AMOUNT.
    """
    features = []
    seen = set()
    for key, value in sorted(source.items()):
        if not key.endswith("_sources") or not isinstance(value, dict):
            continue
        resource = key[:-len("_sources")]
        for tile_id, amount in sorted(value.items()):
            try:
                amount = float(amount)
            except (TypeError, ValueError):
                amount = 0.0
            seen.add((resource, tile_id))
            features.append((resource, tile_id, amount))

    coords = source.get("food_source_coords")
    if isinstance(coords, dict):
        for tile_id in sorted(coords):
            key = ("food", tile_id)
            if key in seen:
                continue
            seen.add(key)
            features.append(("food", tile_id, FOOD_COORD_DEFAULT_AMOUNT))
    return features


def build_features(source, width, meshes, mats):
    features = collect_features(source)
    per_type = {}
    count = 0
    skipped = 0
    for resource, tile_id, amount in features:
        idx = tile_index(tile_id)
        if idx is None:
            skipped += 1
            continue
        mesh_key, color = FEATURE_STYLE.get(resource, FEATURE_FALLBACK)
        mat = mats.get("MI_Feature_%s" % resource, color)
        height = 0.35 + min(max(amount, 0.0), 10.0) * 0.075
        x, y = idx % width, idx // width
        location = cell_to_world(x, y)
        location.x += MARKER_OFFSET
        location.y -= MARKER_OFFSET
        location.z = 50.0 * height
        spawn_mesh(meshes[mesh_key], mat, location,
                   unreal.Vector(0.42, 0.42, height),
                   "Feature_%s_%s_amt%.3f" % (resource, tile_id, amount),
                   unreal.Name("AntWorld/Features/%s" % resource))
        count += 1
        per_type[resource] = per_type.get(resource, 0) + 1
    for resource in sorted(per_type):
        stat("feature_%s" % resource, per_type[resource])
    stat("feature_markers", count)
    stat("feature_skipped", skipped)
    return count, skipped, per_type


def build_builds(derived, meshes, mats):
    ledger = derived.get("build_ledger") or []
    count = 0
    skipped = 0
    per_hive = {}
    for i, entry in enumerate(ledger):
        coords = entry.get("coords")
        if not isinstance(coords, list) or len(coords) < 2:
            skipped += 1
            continue
        hive = entry.get("hive", "unknown")
        kind = entry.get("kind", "build")
        tick = entry.get("tick", -1)
        color = HIVE_COLORS.get(hive, HIVE_FALLBACK)[1]
        mat = mats.get("MI_Build_%s" % hive.replace("-", "_"), color)
        z_scale = 0.7
        location = cell_to_world(coords[0], coords[1], 50.0 * z_scale)
        if len(coords) > 2:
            location.z += float(coords[2]) * CELL
        spawn_mesh(meshes["cylinder"], mat, location,
                   unreal.Vector(0.95, 0.95, z_scale),
                   "Build_%03d_%s_%s_tick%s" % (i, hive, kind, tick),
                   unreal.Name("AntWorld/Builds"))
        count += 1
        per_hive[hive] = per_hive.get(hive, 0) + 1
    for hive in sorted(per_hive):
        stat("build_%s" % hive, per_hive[hive])
    stat("builds", count)
    stat("build_skipped", skipped)
    return count, skipped, per_hive


def mirror_verdict(mirror):
    if not mirror:
        return "no mirror statistic (empty geometry log)", None
    p = mirror.get("p_value")
    if p is None:
        return "mirror p-value unavailable", None
    if p < 0.05:
        return "SIGNIFICANT vs permutation null (p < 0.05)", p
    return "not distinguishable from the permutation null", p


def hud_lines(doc, width, counts):
    source = doc["source"]
    prov = doc["provenance"]
    mirror = doc["derived"].get("mirror")
    verdict, p = mirror_verdict(mirror)
    day_start = prov.get("absolute_day_start", 0)
    ticks = prov.get("ticks", 0)
    day_end = day_start + max(ticks - 1, 0)
    res = source.get("resources") or {}
    res_line = "  ".join("%s %.1f" % (k, float(v))
                         for k, v in sorted(res.items()))
    lines = [
        "ANT-HIVE-WORLD  //  turn %s" % doc.get("turn_id"),
        "days %d-%d  (%d ticks)   seq %s" % (day_start, day_end, ticks,
                                             source.get("seq")),
        "mirror p = %s   %s" % ("n/a" if p is None else ("%.3f" % p), verdict),
        "builds %d   territory %d tiles (%dx%d)   features %d" % (
            counts["builds"], counts["territory"], width, width,
            counts["features"]),
        "prey %.3g   predators %.3g" % (
            float(source.get("prey_population") or 0.0),
            float(source.get("predator_population") or 0.0)),
        res_line,
        "payload %s" % (prov.get("payload_hash") or "")[:16],
    ]
    return lines


def build_hud(doc, width, counts, grid_span):
    text = "\n".join(hud_lines(doc, width, counts))
    actor = actor_subsystem().spawn_actor_from_class(
        unreal.TextRenderActor,
        unreal.Vector(-1.2 * CELL, grid_span * 0.5, 420.0),
        unreal.Rotator(0.0, 0.0, 180.0))
    component = actor.text_render
    component.set_text(text)
    component.set_world_size(46.0)
    component.set_text_render_color(unreal.Color(255, 255, 255, 255))
    component.set_horizontal_alignment(unreal.HorizTextAligment.EHTA_CENTER)
    component.set_vertical_alignment(unreal.VerticalTextAligment.EVRTA_TEXT_CENTER)
    actor.set_actor_label("AntWorld_HUD")
    actor.set_folder_path(unreal.Name("AntWorld/HUD"))
    stat("hud_lines", len(text.split("\n")))
    return actor, text


def build_environment(grid_span):
    spawned = []
    eas = actor_subsystem()

    sun = eas.spawn_actor_from_class(unreal.DirectionalLight,
                                     unreal.Vector(0.0, 0.0, 1200.0),
                                     unreal.Rotator(0.0, -48.0, 35.0))
    sun.root_component.set_mobility(unreal.ComponentMobility.MOVABLE)
    sun.set_actor_label("AntWorld_Sun")
    spawned.append(sun)

    sky = eas.spawn_actor_from_class(unreal.SkyLight,
                                     unreal.Vector(0.0, 0.0, 1000.0),
                                     unreal.Rotator(0.0, 0.0, 0.0))
    sky.root_component.set_mobility(unreal.ComponentMobility.MOVABLE)
    sky.set_actor_label("AntWorld_SkyLight")
    spawned.append(sky)

    try:
        atmosphere = eas.spawn_actor_from_class(unreal.SkyAtmosphere,
                                                unreal.Vector(0.0, 0.0, 0.0),
                                                unreal.Rotator(0.0, 0.0, 0.0))
        atmosphere.set_actor_label("AntWorld_SkyAtmosphere")
        spawned.append(atmosphere)
    except Exception as exc:
        log("sky atmosphere skipped: %s" % exc)

    centre = grid_span * 0.5
    camera = eas.spawn_actor_from_class(
        unreal.CameraActor,
        unreal.Vector(centre - grid_span * 1.15, centre, grid_span * 0.95),
        unreal.Rotator(0.0, -38.0, 0.0))
    camera.set_actor_label("AntWorld_OverviewCamera")
    spawned.append(camera)

    for actor in spawned:
        actor.set_folder_path(unreal.Name("AntWorld/Environment"))
    stat("environment_actors", len(spawned))
    return len(spawned)


# ---------------------------------------------------------------------- main

def run():
    import_path = resolve_import_path()
    log("import=%s" % import_path)
    doc = load_import(import_path)
    source = doc["source"]
    derived = doc["derived"]

    width = infer_grid_width(source)
    grid_span = width * CELL
    stat("grid_width", width)
    stat("turn_id", doc.get("turn_id"))

    state = open_blank_level()
    stat("level_state", state)

    meshes = load_meshes()
    mats = MaterialCache(ensure_base_material())

    territory, territory_skipped = build_territory(source, width, meshes, mats)
    features, feature_skipped, per_type = build_features(source, width, meshes, mats)
    builds, build_skipped, per_hive = build_builds(derived, meshes, mats)
    env = build_environment(grid_span)
    counts = {"territory": territory, "features": features, "builds": builds}
    _, hud_text = build_hud(doc, width, counts, grid_span)
    stat("materials_created", mats.created)

    saved = level_subsystem().save_current_level()
    stat("level_saved", saved)
    unreal.EditorAssetLibrary.save_directory("/Game/AntWorld", False, True)

    total_actors = len(actor_subsystem().get_all_level_actors())
    stat("actors_total", total_actors)

    report = {
        "ok": bool(saved) and territory > 0 and builds > 0 and features > 0,
        "import_path": import_path,
        "turn_id": doc.get("turn_id"),
        "map_package": MAP_PACKAGE,
        "level_state": state,
        "level_saved": bool(saved),
        "grid_width": width,
        "counts": {
            "territory_tiles": territory,
            "territory_skipped": territory_skipped,
            "feature_markers": features,
            "feature_skipped": feature_skipped,
            "features_by_type": per_type,
            "builds": builds,
            "builds_skipped": build_skipped,
            "builds_by_hive": per_hive,
            "environment_actors": env,
            "actors_total": total_actors,
            "materials_created": mats.created,
        },
        "provenance": {
            "payload_hash": doc["provenance"].get("payload_hash"),
            "absolute_day_start": doc["provenance"].get("absolute_day_start"),
            "ticks": doc["provenance"].get("ticks"),
        },
        "mirror": derived.get("mirror"),
        "hud_text": hud_text,
        "engine_version": unreal.SystemLibrary.get_engine_version(),
    }
    report_path = os.path.join(project_dir(), "Saved", "antworld_build_report.json")
    os.makedirs(os.path.dirname(report_path), exist_ok=True)
    with open(report_path, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, sort_keys=True)
    log("report=%s" % report_path)
    unreal.log("ANTWORLD_RESULT %s" % json.dumps(report["counts"], sort_keys=True))
    return report


def main():
    try:
        report = run()
    except Exception:
        unreal.log_error("ANTWORLD_FAIL\n%s" % traceback.format_exc())
        raise
    if report["ok"]:
        unreal.log("ANTWORLD_OK map=%s" % MAP_PACKAGE)
    else:
        unreal.log_error("ANTWORLD_FAIL report says not ok")


main()
