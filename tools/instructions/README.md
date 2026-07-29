# Instruction Tooling

## Commands

- `npm run instructions:generate`
  - Generates Codex/Cursor/OpenCode/Generic files and Claude targets (`CLAUDE.md`, `.claude/*`).

- `npm run instructions:generate -- --preview-claude`
  - Generates the same files, but writes Claude output to `instructions/generated/claude/*` only.

- `npm run instructions:validate`
  - Validates canonical references and checks drift for managed files, including Claude targets.

- `npm run instructions:validate -- --skip-claude`
  - Validates non-Claude harness files only.

- `npm run instructions:validate -- --compare-claude`
  - Forces Claude-target drift checks (equivalent to default in cutover mode).

## Canonical Format

Canonical `.yaml` files in this repo use JSON-compatible YAML for zero-dependency parsing.
