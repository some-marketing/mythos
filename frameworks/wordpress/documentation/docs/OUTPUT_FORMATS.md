# Output Formats

## Step log (`.jsonl`)
One JSON object per step, append-only.

Minimal fields (see schema for full):
- `step_index` (1-based)
- `task_slug`
- `action` (navigate, click, fill, select, verify, submit, wait)
- `target` (selector or accessible label)
- `value` (for fill/select)
- `expected` (what confirms success for this step)
- `observed` (what was actually observed)
- `url` (optional)
- `screenshot` (optional)

## Guide (`.md`)
Recommended sections:
1) Goal
2) Prereqs
3) Steps (numbered)
4) Troubleshooting
5) Notes / edge cases

