#!/usr/bin/env bash
# fixture: pre-port env vars, schema string, and runner identifier
export SM_OS_ROOT="/repo"
echo "$SM_OS_ROOT"
SCHEMA="CoordinationSignal/1.0"
runSmosCommand "$@"
