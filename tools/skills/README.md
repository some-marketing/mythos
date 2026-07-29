# sync-skills.py

Mirrors this repo's Claude skills (`**/.claude/skills/**/SKILL.md`) into
another harness's own skill directory format — a generic "duplicate skills
across harnesses" utility, not tied to any one target harness.

```bash
python3 tools/skills/sync-skills.py
python3 tools/skills/sync-skills.py --prefix my-guild --target-dir external-harness-skills
python3 tools/skills/sync-skills.py --yaml-generator ~/.codex/skills/.system/skill-creator/scripts/generate_openai_yaml.py
python3 tools/skills/sync-skills.py --clean
```

Requires `pyyaml` (`pip install pyyaml`).

## What it does

1. Walks every `.claude/skills/<name>/SKILL.md` (plus, if your repo has them,
   `frameworks/<service>/<framework>/.claude/skills/...` framework-scoped
   skills) and parses its frontmatter.
2. Generates a namespaced id and display name for each — `<prefix>-<skill>`
   by default, e.g. `guild-manage-frameworks`.
3. Copies every bundled resource (scripts, templates, references — anything
   in the skill's directory besides `SKILL.md` itself) alongside the
   mirrored `SKILL.md`.
4. Writes a mirrored `SKILL.md` whose body is the original, with a short
   provenance note prepended pointing back at the source path.
5. Writes `index.json` at the target root listing every mirrored skill.

## Target-harness parameterization

Nothing about the target harness is hardcoded:

- `--target-dir` — where the mirror lands (default `external-harness-skills`)
- `--prefix` / `--display-prefix` — the naming prefix for generated ids/names (default `guild`)
- `--repo-label` — how this repo refers to itself in generated text (default `this repo`)
- `--yaml-generator` — an optional path to a target-harness-specific
  interface/yaml generator script (for example, an OpenAI-format
  skill-creator generator if you're mirroring into a Codex-style skill
  directory). If you don't have one, or don't need one, omit this flag —
  the mirror still produces a fully usable `SKILL.md` + `index.json` without
  it, for any harness that reads Markdown skill files directly.

## Excluding candidate/template skills

`EXCLUDED_PATH_MARKERS` at the top of the script (`framework_candidates`,
`framework-candidates`, `_template`) skips path segments that mark a skill
as a not-yet-promoted candidate rather than a real shipped skill. Add your
own repo's equivalent markers there if your layout uses different names.
