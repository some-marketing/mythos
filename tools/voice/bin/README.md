# tools/voice/bin

Native CLI helpers for the Mythos voice calm-room mode. No GUI, no Screen
Recording permission, no AppleScript — pure Core Audio so they run headless /
unattended.

## create-aggregate-device

A Swift CLI that creates a macOS aggregate output device via Core Audio. The
voice assistant uses this device to:

1. Fan TTS to two Bluetooth speakers (e.g. soundcore Boom 2 + Rave Party 2).
2. Provide a single, stable known-output reference for the acoustic echo
   canceller running on the mic input.

### Build

```
bash tools/voice/bin/build.sh
```

This invokes `swiftc -O create-aggregate-device.swift -o create-aggregate-device
-framework CoreAudio -framework AudioToolbox`. No third-party deps.

### List output devices

```
./tools/voice/bin/create-aggregate-device --list
```

Prints every output-capable audio device with its AudioObjectID, current name,
and persistent UID. Use the **name** column to populate `--sub-devices`; sub-
devices are resolved by current name at create time so the tool survives
speaker re-pairing.

### Create the aggregate

```
./tools/voice/bin/create-aggregate-device \
  --name "SM Aggregate" \
  --sub-devices "soundcore Boom 2,Rave Party 2" \
  --master "soundcore Boom 2" \
  --drift-correction true
```

Behavior:

- Sub-devices are resolved by current device name. If one is not currently
  connected the tool prints a warning to stderr and creates the aggregate with
  only the connected sub-devices instead of hard-failing. If none are
  connected the tool exits non-zero.
- If an aggregate with the given name already exists, it is **destroyed and
  recreated** (idempotent).
- The aggregate is created with `kAudioAggregateDeviceIsPrivateKey = false`
  so `afplay` and other system processes can see and select it.
- `kAudioAggregateDeviceIsStackedKey = false` — this is a standard aggregate,
  not a stacked multi-output.
- The aggregate UID is deterministic:
  `com.mythos.voice.aggregate.<slugified-name>` (e.g. `sm-aggregate`).
- `--master` picks which sub-device is the clock master. If omitted, the
  first connected sub-device wins.
- `--drift-correction true` enables `kAudioSubDeviceDriftCompensationKey` on
  every sub-device. Recommended whenever sub-devices have independent clocks
  (always true for two separate Bluetooth speakers).

### Destroy the aggregate

```
./tools/voice/bin/create-aggregate-device --destroy "SM Aggregate"
```

Looks up the aggregate by current name and calls
`AudioHardwareDestroyAggregateDevice`. Exits non-zero if no device with that
name is present.

### Verify it landed

After creating, you can confirm with:

```
system_profiler SPAudioDataType | grep -A 3 "SM Aggregate"
```

or with the same tool:

```
./tools/voice/bin/create-aggregate-device --list | grep "SM Aggregate"
```

### Exit codes

- `0` — success
- `1` — runtime failure (no devices found, destroy target missing, etc.)
- `2` — usage / bad arguments
- `3` — none of the requested sub-devices were connected
- `4` — failed to destroy existing aggregate during idempotent recreate
- `5` — `AudioHardwareCreateAggregateDevice` returned non-noErr

### Constraints

- macOS 12+, Swift 5.5+.
- No third-party dependencies.
- Does not request Screen Recording, Accessibility, or any other TCC-gated
  permission.
- Safe to run from launchd or any unattended context.
