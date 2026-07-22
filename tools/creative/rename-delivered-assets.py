#!/usr/bin/env python3
"""
rename-delivered-assets.py — normalize dealership creative-asset filenames to a
stable delivery convention, from a config that grounds every field in the brief.

WHY THIS EXISTS
  Many design vendors deliver dealership statics/videos with generic slot/concept filenames
  ("SLOT 2 VARIANT A - DESIGN 1 [1_1 1080X1080].png", "Concept 3 - Design 2 [9.16].png").
  The delivery-root Drive folder (dealership -> month -> assets) needs every file
  renamed to a stable convention so downstream ad builds + humans can read them.

CONVENTION
  Images:  Year_Make_Model_Promotion            (+ disambiguators, see below)
  Videos:  Speaker_Theme|YearMakeModel_Promotion|Evergreen   (pipe segments)

  Because one concept ships as multiple designs x ratios (x A/B variants), the four
  canonical fields alone collide. This tool preserves the source's design / variant /
  ratio / duplicate markers as trailing underscore-joined disambiguators so every
  file stays distinct and the rename is 1:1 and reversible:

      2026_Ford_BroncoSport_0PctOr4750Off_VA_D1_1x1.png
      2026_Mazda_Mazda3CX30CX5_219BiWeekly_D2_4x5.png

GROUNDING RULE (hard)
  Year / Make / Model / Promotion are NEVER read from image pixels. They come only
  from the config (which the operator/worker fills from the brief + offer + folder
  path) plus the slot/concept/design/variant/ratio tokens parsed out of the existing
  filename. A file whose slot/concept is not in the config, or whose name does not
  parse, is FLAGGED and left untouched — never guessed.

USAGE
  Dry run (default; prints old->new map + flagged list, renames nothing):
      python3 tools/creative/rename-delivered-assets.py --config <config.json>
  Apply (filesystem rename on the mounted Drive; reversible):
      python3 tools/creative/rename-delivered-assets.py --config <config.json> --apply

  --root <path>   Override the deliveryRoot from the config (e.g. re-point at a mount).
  --json          Emit the computed plan as JSON (for logging / a reverse map).

The tool is cwd-independent and reusable across deliveries: all delivery-specific
knowledge lives in the JSON config, nothing is hardcoded here.
"""

import argparse
import json
import os
import re
import sys

# Filename parsers per folder "format". Each returns a dict with keys:
#   slot, variant (or None), design, ratio_raw, dup (marker string or ""), ext
FORMATS = {
    # "SLOT 2 VARIANT A - DESIGN 1 [1_1 1080X1080].png"  /  "SLOT 3 - DESIGN 2 [4_5 ...].png"
    "slot-variant-design": re.compile(
        r"^SLOT\s+(?P<slot>\d+)"
        r"(?:\s+VARIANT\s+(?P<variant>[A-Za-z]))?"
        r"\s*-\s*DESIGN\s+(?P<design>\d+)"
        r"\s*\[(?P<ratio>[^\]]+)\]"
        r"(?P<dup>-\d+)?"
        r"(?P<ext>\.[A-Za-z0-9]+)$",
        re.IGNORECASE,
    ),
    # "Concept 3 - Design 2 [9.16].png"
    "concept": re.compile(
        r"^Concept\s+(?P<slot>\d+)"
        r"\s*-\s*Design\s+(?P<design>\d+)"
        r"\s*\[(?P<ratio>[^\]]+)\]"
        r"(?P<dup>-\d+)?"
        r"(?P<ext>\.[A-Za-z0-9]+)$",
        re.IGNORECASE,
    ),
}


def normalize_ratio(ratio_raw, ratio_map):
    # Bracket content may carry a size after the ratio ("1_1 1080X1080"); the ratio
    # token is the first whitespace-delimited piece.
    key = ratio_raw.strip().split()[0]
    return ratio_map.get(key)


def plan_folder(root, rel_folder, spec, global_ratio_map):
    """Return (renames, flags) for one dealership/month folder.

    renames: list of dicts {old_rel, new_rel, old_abs, new_abs}
    flags:   list of dicts {file, reason}
    """
    abs_folder = os.path.join(root, rel_folder)
    renames, flags = [], []
    if not os.path.isdir(abs_folder):
        flags.append({"file": rel_folder, "reason": "folder not found under delivery root"})
        return renames, flags

    fmt = FORMATS.get(spec["format"])
    if fmt is None:
        flags.append({"file": rel_folder, "reason": f"unknown format '{spec['format']}'"})
        return renames, flags

    ratio_map = {**global_ratio_map, **spec.get("ratioMap", {})}
    year, make = spec["year"], spec["make"]
    slots = spec["slots"]

    proposed = {}  # new_basename -> [old_basename,...]  (collision detection)

    for name in sorted(os.listdir(abs_folder)):
        p = os.path.join(abs_folder, name)
        if not os.path.isfile(p):
            continue
        if name.startswith(".") or name.startswith("~"):
            flags.append({"file": os.path.join(rel_folder, name), "reason": "hidden/temp/sidecar file — skipped"})
            continue

        m = fmt.match(name)
        if not m:
            flags.append({"file": os.path.join(rel_folder, name), "reason": "filename did not parse against format"})
            continue

        gd = m.groupdict()
        slot = gd["slot"]
        variant = gd.get("variant")
        design = gd["design"]
        dup = gd.get("dup") or ""
        ext = gd["ext"].lower()

        ratio = normalize_ratio(m.group("ratio"), ratio_map)
        if ratio is None:
            flags.append({"file": os.path.join(rel_folder, name),
                          "reason": f"ratio token '{m.group('ratio')}' not in ratioMap"})
            continue

        slot_spec = slots.get(slot)
        if slot_spec is None:
            flags.append({"file": os.path.join(rel_folder, name),
                          "reason": f"slot/concept {slot} not grounded in config"})
            continue

        model = slot_spec.get("model")
        promo = slot_spec.get("promo")
        variant_marker = ""

        # Variant-bearing slot: promo (and possibly model) come from the variant block.
        if "variants" in slot_spec:
            if not variant:
                flags.append({"file": os.path.join(rel_folder, name),
                              "reason": f"slot {slot} expects a VARIANT but filename has none"})
                continue
            vspec = slot_spec["variants"].get(variant.upper())
            if vspec is None:
                flags.append({"file": os.path.join(rel_folder, name),
                              "reason": f"variant {variant} not grounded for slot {slot}"})
                continue
            model = vspec.get("model", model)
            promo = vspec.get("promo", promo)
            variant_marker = f"V{variant.upper()}"
        elif variant:
            # Filename carries a variant the config didn't expect — surface it.
            variant_marker = f"V{variant.upper()}"

        if not model or not promo:
            flags.append({"file": os.path.join(rel_folder, name),
                          "reason": "model or promo missing in config for this slot"})
            continue

        parts = [year, make, model, promo]
        if variant_marker:
            parts.append(variant_marker)
        parts.append(f"D{design}")
        parts.append(ratio)
        new_base = "_".join(parts)
        if dup:
            new_base += "_alt" + dup.lstrip("-")
        new_base += ext

        proposed.setdefault(new_base, []).append(name)

    # Resolve any residual collisions deterministically (should be rare given the
    # design/variant/ratio/dup disambiguators already in the name).
    for new_base, olds in proposed.items():
        if len(olds) == 1:
            final = {olds[0]: new_base}
        else:
            stem, ext = os.path.splitext(new_base)
            final = {old: f"{stem}_v{i+1}{ext}" for i, old in enumerate(sorted(olds))}
        for old, new in final.items():
            renames.append({
                "old_rel": os.path.join(rel_folder, old),
                "new_rel": os.path.join(rel_folder, new),
                "old_abs": os.path.join(abs_folder, old),
                "new_abs": os.path.join(abs_folder, new),
            })

    return renames, flags


def main():
    ap = argparse.ArgumentParser(description="Rename delivered dealership assets to a stable delivery convention.")
    ap.add_argument("--config", required=True, help="Path to the delivery config JSON.")
    ap.add_argument("--root", default=None, help="Override deliveryRoot from the config.")
    ap.add_argument("--apply", action="store_true", help="Perform the renames (default is dry-run).")
    ap.add_argument("--json", action="store_true", help="Emit the computed plan as JSON.")
    args = ap.parse_args()

    with open(args.config, "r", encoding="utf-8") as fh:
        cfg = json.load(fh)

    root = args.root or cfg["deliveryRoot"]
    if not os.path.isdir(root):
        print(f"ERROR: deliveryRoot not found: {root}", file=sys.stderr)
        sys.exit(2)

    global_ratio_map = cfg.get("ratioMap", {})
    all_renames, all_flags = [], []
    for rel_folder, spec in cfg["folders"].items():
        r, f = plan_folder(root, rel_folder, spec, global_ratio_map)
        all_renames.extend(r)
        all_flags.extend(f)

    # Guard: no two renames may target the same absolute path, and no target may
    # collide with an existing file we are not ourselves renaming.
    targets = {}
    for r in all_renames:
        targets.setdefault(r["new_abs"], []).append(r["old_abs"])
    hard_conflicts = {t: srcs for t, srcs in targets.items() if len(srcs) > 1}
    if hard_conflicts:
        print("ABORT: target-name collisions detected (would overwrite):", file=sys.stderr)
        for t, srcs in hard_conflicts.items():
            print(f"  {t} <= {srcs}", file=sys.stderr)
        sys.exit(3)

    if args.json:
        print(json.dumps({"root": root, "renames": all_renames, "flags": all_flags}, indent=2))
        return

    print(f"Delivery root: {root}")
    print(f"Mode: {'APPLY' if args.apply else 'DRY-RUN'}")
    print(f"Planned renames: {len(all_renames)} | Flagged/skipped: {len(all_flags)}\n")

    print("=== RENAME MAP (old -> new) ===")
    for r in sorted(all_renames, key=lambda x: x["old_rel"]):
        print(f"  {os.path.basename(r['old_rel'])}\n    -> {os.path.basename(r['new_rel'])}")

    if all_flags:
        print("\n=== FLAGGED / SKIPPED ===")
        for f in all_flags:
            print(f"  {f['file']}  --  {f['reason']}")

    if not args.apply:
        print("\nDRY-RUN only. Re-run with --apply to perform the renames.")
        return

    print("\n=== APPLYING ===")
    done = 0
    for r in all_renames:
        if r["old_abs"] == r["new_abs"]:
            continue
        if os.path.exists(r["new_abs"]):
            print(f"  SKIP (target exists): {os.path.basename(r['new_abs'])}")
            continue
        os.rename(r["old_abs"], r["new_abs"])
        done += 1
    print(f"Renamed {done} file(s).")


if __name__ == "__main__":
    main()
