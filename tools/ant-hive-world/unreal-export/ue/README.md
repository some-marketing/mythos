# AntWorldProjection — Unreal Engine scaffold (S2)

The Unreal side of `unreal-world-projection`. A data-driven UE 5.8 level that
rebuilds itself from one `UnrealImport/1.0` document: territory tiles as a
ground grid, resource markers by type, chamber builds at their recorded
coordinates, and a HUD panel with turn id, absolute day range, and the
mirror-detector p-value with its verdict.

Everything here is text — a `.uproject`, two `.ini` files, Python, and shell.
The `.umap` and material assets are *generated on the host* by running the
Python builder; no binary Unreal assets are tracked in this repo.

## Open the level on orwell's desktop

One command, from the orwell desktop (PowerShell or Run box):

```
& "C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor.exe" "D:\UnrealProjects\AntWorldProjection\AntWorldProjection.uproject"
```

The project's `EditorStartupMap` is `/Game/AntWorld/Maps/AntWorld`, so the
built world loads directly. In the World Outliner the actors are foldered as
`AntWorld/Territory`, `AntWorld/Features/<resource>`, `AntWorld/Builds`,
`AntWorld/Environment`, `AntWorld/HUD`. For a framed view, right-click
`AntWorld_OverviewCamera` → *Pilot 'AntWorld_OverviewCamera'*.

Opening the editor never rebuilds the level — `init_unreal.py` is deliberately
side-effect free, so an interactive inspection can't be clobbered.

## Layout

| Path | Role |
|---|---|
| `AntWorldProjection.uproject` | Blueprint-only project, UE 5.8, enables `PythonScriptPlugin` + `EditorScriptingUtilities` |
| `Config/DefaultEngine.ini` | Startup map, DX12, auto-exposure off (stable brightness) |
| `Content/Python/build_world.py` | The builder — reads an import JSON, spawns the world, saves the level, writes a JSON report |
| `Content/Python/init_unreal.py` | Runs on every editor start; logs only |
| `Tools/BuildLevel.ps1` | Host-side headless build wrapper (runs `UnrealEditor-Cmd.exe`, prints evidence markers) |
| `deploy.sh` | Copies this tree plus the import JSONs to `D:\UnrealProjects\AntWorldProjection` |

## Rebuild the level

From the repo, after editing anything here:

```bash
bash tools/ant-hive-world/unreal-export/ue/deploy.sh            # code + import files
bash tools/ant-hive-world/unreal-export/ue/deploy.sh --code-only
```

Then, on the host:

```
powershell -NoProfile -ExecutionPolicy Bypass -File D:\UnrealProjects\AntWorldProjection\Tools\BuildLevel.ps1 `
  -Import D:\UnrealProjects\AntWorldProjection\Imports\unreal-import__baseline-3000-r6.json -NullRHI
```

`-NullRHI` is **required when driving the build over SSH**: a non-interactive
Windows session cannot create a D3D12 swapchain, and the editor dies with
`DXGI_ERROR_NOT_CURRENTLY_AVAILABLE` without it. From an interactive desktop
session, drop the switch.

The build is idempotent: if the map already exists it is loaded, emptied, and
repopulated, so re-running against a newer import advances the scene in place.
That is the hook S3's watch loop will call.

## Evidence surface

Every run emits, to stdout and to `Saved/antworld_headless.log`:

- `ANTWORLD_STAT <key>=<value>` — one line per counted step
- `ANTWORLD_RESULT {…}` — the full count block as JSON
- `ANTWORLD_OK` / `ANTWORLD_FAIL`

and writes `Saved/antworld_build_report.json` with counts, provenance
(`payload_hash`, `absolute_day_start`, `ticks`), the mirror statistic, the HUD
text, and the engine version. `BuildLevel.ps1` additionally prints
`ANTWORLD_HOST_EXITCODE`, `ANTWORLD_HOST_UMAP_PRESENT`, and the map's byte
size. Treat the report file as the machine-readable receipt and the markers as
the log-grep receipt.

## How the data maps to the world

- **Grid.** Tile ids are `tile-N` (sometimes prefixed, e.g. `wood-tile-93`),
  and `N = y * width + x`. The width is recovered from the `*_coords` maps by
  solving that relation and taking the modal answer (10 for the baseline
  fixtures), falling back to `ceil(sqrt(len(territory)))`. One cell is 200
  Unreal units.
- **Territory** (`source.territory`) — a thin cube slab per tile, coloured by
  owning hive (`hive-a` warm amber, `hive-b` cool teal).
- **Features** (every `source.*_sources` map) — one marker per source, shape
  and colour per resource type (food sphere/green, wood cylinder/brown, stone
  cube/grey, clay cone/orange, water sphere/blue, ore cube/violet, fiber
  cylinder/pale). Marker height scales with the remaining amount, clamped at
  10. Markers sit off tile centre so builds stay readable.
- **Builds** (`derived.build_ledger`) — a cylinder per entry at its recorded
  `coords`, coloured by hive, labelled `Build_<i>_<hive>_<kind>_tick<tick>`.
  The tick is carried in the actor label so the S3 timelapse can reveal builds
  in recorded order without re-reading the import.
- **HUD** — a `TextRenderActor` (no UMG, so it renders in-editor without PIE)
  carrying turn id, day range, seq, mirror p-value and verdict, actor counts,
  populations, the resource pool, and the leading 16 hex of the payload hash.
- **Environment** — movable directional light, sky light, sky atmosphere, and
  a framed overview camera. Lighting is fully dynamic, so nothing needs a
  lighting build.

## Boundaries

Read-only consumer of post-turn, courier-crossed harvest data. Nothing here
reads or writes anything under `D:\HyperV\` — no VM, seed, courier, or golden
surface. The host footprint is exactly `D:\UnrealProjects\AntWorldProjection`
plus reading the installed engine at `C:\Program Files\Epic Games\UE_5.8`.
