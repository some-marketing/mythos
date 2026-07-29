#!/usr/bin/env python3
"""Generate repo-local skill duplicates in another harness's format from this
repo's Claude skills.

Genericized from a repo-specific "mirror .claude/skills into Codex's OpenAI-yaml
skill format" script. This version has no hardcoded repo name, naming prefix, or
target harness baked in -- every one of those is a CLI argument with a sane,
clearly-labeled default. It ships with no assumption that any particular
target-harness generator script exists on your machine; pass --yaml-generator
only if you have one, and the mirror still produces a usable SKILL.md + index
without it.

Usage:
    python3 tools/skills/sync-skills.py
    python3 tools/skills/sync-skills.py --prefix my-guild --target-dir external-harness-skills
    python3 tools/skills/sync-skills.py --yaml-generator ~/.codex/skills/.system/skill-creator/scripts/generate_openai_yaml.py
    python3 tools/skills/sync-skills.py --clean
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import yaml


REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCE_PATTERNS = ("**/.claude/skills/**/SKILL.md",)

# Directory-name fragments that mark a skill as a candidate/template rather
# than a real shipped skill -- adjust for your own repo's conventions.
EXCLUDED_PATH_MARKERS = ("framework_candidates", "framework-candidates", "_template")

ACRONYMS = {
    "api": "API",
    "crm": "CRM",
    "css": "CSS",
    "json": "JSON",
    "llm": "LLM",
    "mcp": "MCP",
    "md": "MD",
    "qa": "QA",
    "sql": "SQL",
    "ui": "UI",
    "ux": "UX",
    "wordpress": "WordPress",
}

SMALL_WORDS = {"and", "for", "of", "or", "the", "to", "vs", "with"}


@dataclass(frozen=True)
class SkillRecord:
    source_skill_md: Path
    source_dir: Path
    relative_source_dir: str
    generated_name: str
    display_name: str
    description: str
    default_prompt: str


def iter_source_skill_mds() -> list[Path]:
    skill_mds: list[Path] = []
    for pattern in SOURCE_PATTERNS:
        skill_mds.extend(REPO_ROOT.glob(pattern))
    results = []
    for skill_md in sorted({path.resolve() for path in skill_mds}):
        relative = skill_md.relative_to(REPO_ROOT)
        if any(marker in relative.parts for marker in EXCLUDED_PATH_MARKERS):
            continue
        results.append(skill_md)
    return results


def parse_frontmatter(skill_md: Path) -> tuple[dict, str]:
    content = skill_md.read_text()
    match = re.match(r"^---\n(.*?)\n---\n?(.*)$", content, re.DOTALL)
    if not match:
        raise ValueError(f"Invalid frontmatter in {skill_md}")
    frontmatter = yaml.safe_load(match.group(1))
    if not isinstance(frontmatter, dict):
        raise ValueError(f"Frontmatter is not a mapping in {skill_md}")
    body = match.group(2).lstrip("\n")
    return frontmatter, body


def collapse_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def sanitize_description(value: str) -> str:
    text = collapse_whitespace(value)
    text = text.replace(" -> ", " to ")
    text = text.replace("<", "").replace(">", "")
    return text


def titleize(parts: list[str]) -> str:
    rendered: list[str] = []
    for index, part in enumerate(parts):
        lower = part.lower()
        if lower in ACRONYMS:
            rendered.append(ACRONYMS[lower])
        elif index > 0 and lower in SMALL_WORDS:
            rendered.append(lower)
        else:
            rendered.append(part.replace("-", " ").title())
    return " ".join(rendered)


def build_generated_name(relative: Path, prefix: str) -> str:
    parts = list(relative.parts)
    if parts[0] == ".claude":
        skill_tail = parts[2:-1]
        return "-".join([prefix, *skill_tail])

    if parts[0] != "frameworks":
        raise ValueError(f"Unsupported skill location: {relative}")

    # frameworks/<service>/<framework>/.claude/skills/<skill-name...>/SKILL.md
    service = parts[1]
    framework = parts[2]
    skill_tail = parts[5:-1]
    generated = [prefix, service, framework]
    if skill_tail and skill_tail[0] != framework:
        generated.extend(skill_tail)
    elif len(skill_tail) > 1:
        generated.extend(skill_tail[1:])
    return "-".join(generated)


def build_display_name(relative: Path, display_prefix: str) -> str:
    parts = list(relative.parts)
    if parts[0] == ".claude":
        skill_tail = parts[2:-1]
        return f"{display_prefix} {titleize(skill_tail)}"

    service = parts[1]
    framework = parts[2]
    skill_tail = parts[5:-1]
    display_parts = [display_prefix, service, framework]
    if skill_tail and skill_tail[0] != framework:
        display_parts.extend(skill_tail)
    elif len(skill_tail) > 1:
        display_parts.extend(skill_tail[1:])
    return titleize(display_parts)


def trim_short_description(description: str) -> str:
    text = collapse_whitespace(description)
    if len(text) < 25:
        text = f"{text} workflow helper"
    if len(text) <= 64:
        return text
    trimmed = text[:61].rstrip()
    if " " in trimmed:
        trimmed = trimmed.rsplit(" ", 1)[0]
    trimmed = trimmed.rstrip(" ,;:.")
    return f"{trimmed}..."


def build_default_prompt(name: str, display_name: str, repo_label: str) -> str:
    return f"Use ${name} to follow the {display_name} workflow in {repo_label}."


def build_skill_record(skill_md: Path, prefix: str, display_prefix: str, repo_label: str) -> SkillRecord:
    relative = skill_md.relative_to(REPO_ROOT)
    frontmatter, _body = parse_frontmatter(skill_md)
    description = sanitize_description(str(frontmatter.get("description", "")))
    if not description:
        raise ValueError(f"Missing description in {skill_md}")
    generated_name = build_generated_name(relative, prefix)
    display_name = build_display_name(relative, display_prefix)
    return SkillRecord(
        source_skill_md=skill_md,
        source_dir=skill_md.parent,
        relative_source_dir=str(skill_md.parent.relative_to(REPO_ROOT)),
        generated_name=generated_name,
        display_name=display_name,
        description=description,
        default_prompt=build_default_prompt(generated_name, display_name, repo_label),
    )


def copy_resources(source_dir: Path, target_dir: Path) -> None:
    for path in source_dir.rglob("*"):
        if path.is_dir():
            continue
        if path.name == "SKILL.md":
            continue
        relative = path.relative_to(source_dir)
        destination = target_dir / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)


def write_skill_md(record: SkillRecord, target_root: Path, repo_label: str) -> None:
    _frontmatter, body = parse_frontmatter(record.source_skill_md)
    frontmatter = yaml.safe_dump(
        {
            "name": record.generated_name,
            "description": record.description,
        },
        sort_keys=False,
        allow_unicode=False,
    ).strip()
    content = [
        "---",
        frontmatter,
        "---",
        "",
        f"Mirror of `{record.relative_source_dir}/SKILL.md`.",
        "Use copied bundled resources in this skill when present.",
        f"When the workflow cites other repo paths, treat those {repo_label} paths as source of truth.",
        "",
        body.rstrip(),
        "",
    ]
    target_dir = target_root / record.generated_name
    target_dir.mkdir(parents=True, exist_ok=True)
    (target_dir / "SKILL.md").write_text("\n".join(content))


def write_yaml_via_generator(record: SkillRecord, target_root: Path, generator: Path) -> None:
    target_dir = target_root / record.generated_name
    short_description = trim_short_description(record.description)
    cmd = [
        sys.executable,
        str(generator),
        str(target_dir),
        "--interface",
        f"display_name={record.display_name}",
        "--interface",
        f"short_description={short_description}",
        "--interface",
        f"default_prompt={record.default_prompt}",
    ]
    subprocess.run(cmd, check=True, cwd=REPO_ROOT)


def write_index(records: list[SkillRecord], target_root: Path) -> None:
    payload = {
        "generated_at_root": str(REPO_ROOT),
        "source_count": len(records),
        "skills": [
            {
                "name": record.generated_name,
                "display_name": record.display_name,
                "source_dir": record.relative_source_dir,
                "description": record.description,
            }
            for record in records
        ],
    }
    target_root.mkdir(parents=True, exist_ok=True)
    (target_root / "index.json").write_text(json.dumps(payload, indent=2) + "\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate repo-local skill duplicates in another harness's format from this repo's Claude skills.",
    )
    parser.add_argument(
        "--target-dir",
        default="external-harness-skills",
        help="Directory (repo-relative) to write the mirrored skills into. Default: external-harness-skills",
    )
    parser.add_argument(
        "--prefix",
        default="guild",
        help="Naming prefix for generated skill ids, e.g. '<prefix>-<skill-name>'. Default: guild",
    )
    parser.add_argument(
        "--display-prefix",
        default=None,
        help="Naming prefix for generated display names. Defaults to --prefix, titleized.",
    )
    parser.add_argument(
        "--repo-label",
        default="this repo",
        help="Human-readable label for this repo, used in generated prompt/skill text. Default: 'this repo'",
    )
    parser.add_argument(
        "--yaml-generator",
        default=None,
        type=Path,
        help=(
            "Optional path to a target-harness-specific yaml/interface generator script "
            "(e.g. an OpenAI-format skill-creator generator for a Codex-style target). "
            "If omitted, only SKILL.md mirrors + index.json are produced -- still a "
            "usable output for harnesses that read SKILL.md directly."
        ),
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Remove the existing generated target directory before syncing.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    target_root = REPO_ROOT / args.target_dir
    display_prefix = args.display_prefix or args.prefix.replace("-", " ").title()

    if args.clean and target_root.exists():
        shutil.rmtree(target_root)

    if args.yaml_generator is not None and not args.yaml_generator.exists():
        raise FileNotFoundError(f"Missing generator: {args.yaml_generator}")

    skill_mds = iter_source_skill_mds()
    records = [
        build_skill_record(skill_md, args.prefix, display_prefix, args.repo_label)
        for skill_md in skill_mds
    ]

    for record in records:
        target_dir = target_root / record.generated_name
        target_dir.mkdir(parents=True, exist_ok=True)
        copy_resources(record.source_dir, target_dir)
        write_skill_md(record, target_root, args.repo_label)
        if args.yaml_generator is not None:
            write_yaml_via_generator(record, target_root, args.yaml_generator)

    write_index(records, target_root)
    print(f"Generated {len(records)} skills in {target_root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
