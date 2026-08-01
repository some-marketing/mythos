#!/usr/bin/env bash
# seed-root-trace.sh — SOURCE this (do not execute) to export the root trace
# context into the current shell at the cascade top:
#
#   source tools/telemetry/dispatches/seed-root-trace.sh [--from-signal <path>] [--scope <s>]
#
# It evals the export statements printed by seed-root-trace.cjs, so after
# sourcing, $MYTHOS_TRACE_ID and $MYTHOS_SPAN_ID are both exported in this shell
# and inherited by every child process spawned from it.
#
# Idempotent: if the shell already carries a real trace context, the existing
# values are re-exported and no duplicate root span is written.

__mythos_seed_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
eval "$(node "${__mythos_seed_dir}/seed-root-trace.cjs" --export-shell "$@")"
unset __mythos_seed_dir
