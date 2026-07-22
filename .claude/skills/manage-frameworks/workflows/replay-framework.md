# Replay Framework Workflow

## Steps

1. **[USER] Select candidate and case scope** — Choose a candidate root and one replay case or `all`.
2. **[AUTO] Validate replay cases** — Ensure each selected replay case has `case.json` and ready inputs.
3. **[AUTO] Run replay-readiness checks** — Verify the candidate can be exercised without hidden dependencies on the original source material.
4. **[AUTO] Record run outputs** — Write `run.json`, `execution_log.jsonl`, and `summary.md` under `replay_runs/`.
5. **[AUTO] Refresh candidate summary** — Update replay counts, promotion readiness, and candidate status.

## Output

- One replay run directory per executed case
- Updated `candidate.json`
