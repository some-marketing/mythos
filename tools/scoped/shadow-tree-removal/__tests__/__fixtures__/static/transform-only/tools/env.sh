#!/usr/bin/env bash
# fixture: pre-port env vars, schema string, and runner identifier
export MYTHOS_ROOT="/repo"
echo "$MYTHOS_ROOT"
SCHEMA="HandoffSignal/1.0"
runMythosCommand "$@"
