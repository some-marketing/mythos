#!/usr/bin/env bash
# Build the Mythos Core Audio aggregate device CLI.
# No third-party deps. Targets macOS 12+ (Apple Silicon).

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

swiftc -O create-aggregate-device.swift \
    -o create-aggregate-device \
    -framework CoreAudio \
    -framework AudioToolbox

echo "built: $HERE/create-aggregate-device"

swiftc -O set-sample-rate.swift \
    -o set-sample-rate \
    -framework CoreAudio

echo "built: $HERE/set-sample-rate"
