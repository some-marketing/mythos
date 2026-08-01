---
name: audio-output
description: >
  Control macOS audio output — enumerate devices, bridge multiple Bluetooth
  speakers into a single system output (aggregate or stacked multi-output),
  switch the system output device, diagnose Bluetooth audio issues. Use when
  the operator says "bridge the speakers", names two or more output devices
  they want to play together, asks to route audio to a specific speaker, or
  reports intermittent / desynced / one-speaker-only audio.
version: 1.0.0
execution_mode: DIRECT
trust_tier: local_macos_audio
---

<skill>

<objective>
Give the operator a single reliable surface for macOS audio output control. The value is the judgment layer: which aggregation shape, which master, which sample rate, when drift correction matters, how to diagnose Bluetooth failure modes, and how to actually switch the system output so audio flows. The Swift CLI at `tools/voice/bin/create-aggregate-device` is the execution primitive; this skill is the reasoning around it.
</objective>

<when_to_use>
Activate when the operator:
- Says "bridge", "merge", "combine", "pair", "play through both/all", or similar, naming two or more speakers
- Reports audio only coming out of one speaker in a multi-speaker setup
- Reports intermittent, desynced, or stuttering audio on a Bluetooth output
- Asks to switch the system output to a specific device
- Asks what speakers / outputs are currently connected

Do NOT activate for:
- Audio file editing, DAW work, or content production (wrong domain)
- Voice-assistant-specific calm-room setup (that's the voice pipeline's own concern, though it uses the same binary underneath)
</when_to_use>

<execution_primitives>
The underlying tools this skill orchestrates:

- **`tools/voice/bin/create-aggregate-device`** — Swift CLI, Core Audio. Creates/destroys macOS aggregate devices (standard or stacked). Handles idempotent recreate. Lives under `tools/voice/bin/` for historical reasons; the binary is still semantically voice-coupled (UID namespace `com.mythos.voice.aggregate.*`). Relocating it is a later change, not part of this skill.
- **`tools/voice/bin/set-sample-rate`** — Swift CLI, Core Audio. Sets the nominal sample rate of a named output device (44100, 48000, 96000, etc.). User-space; no sudo. Used by the contention ladder when mismatched rates cause stutter.
- **`tools/voice/bin/airdrop-mode`** — bash wrapper around `defaults write com.apple.sharingd DiscoverableMode` + `killall sharingd`. Sets AirDrop discoverability to `Off`, `Contacts`, or `Everyone`. User-space; no sudo (sharingd runs per-user). Used by the contention ladder to reduce RF interference.
- **`SwitchAudioSource`** — Homebrew CLI (`/opt/homebrew/bin/SwitchAudioSource`). Lists and switches the system input/output device. Check for presence before using.
- **`blueutil`** — Homebrew CLI (`/opt/homebrew/bin/blueutil`). User-space Bluetooth control: power (`--power 0|1`), list paired/connected (`--paired`, `--connected`), disconnect/connect by address (`--disconnect ADDR`, `--connect ADDR`). No sudo required. Install with `brew install blueutil` if missing.
- **Audio MIDI Setup.app** — GUI fallback. Only reach for this if the operator is already in GUI mode or the CLI path can't express what's needed.

Verify the binary exists before use: `ls tools/voice/bin/create-aggregate-device`. If missing, build with `bash tools/voice/bin/build.sh`.
</execution_primitives>

<aggregation_shapes>
Two different Core Audio concepts — picking wrong is the most common failure.

**Standard aggregate** (`--stacked false`, default):
- Channels are mapped sequentially: sub-device 1 gets channels 1–2, sub-device 2 gets channels 3–4, etc.
- Stereo content (all normal music) only fills channels 1–2, so only the first sub-device plays.
- Use for: multichannel audio routing, surround setups, hardware interfaces with multi-channel intent.
- **Wrong for: "fan this music to two speakers at once"** — this is the #1 user-visible trap.

**Stacked multi-output** (`--stacked true`):
- The same stereo stream is duplicated to every sub-device.
- Use for: playing music / TTS / any stereo content through multiple speakers simultaneously.
- This is what macOS's GUI calls a "Multi-Output Device".

Default for the operator's usual "bridge the speakers" request: **stacked**.
</aggregation_shapes>

<master_clock>
In any aggregate, one sub-device is the clock master; the others are drift-corrected.

Rules of thumb:
- If one sub-device is a stable built-in or wired device and one is Bluetooth, the **wired/built-in should be master**.
- If both sub-devices are Bluetooth, **make the weaker / more intermittent speaker the master**. Counter-intuitive but empirically better — the stronger link drift-corrects to the weaker one rather than overrunning it.
- Drift correction (`--drift-correction true`) should be ON whenever sub-devices have independent clocks, which is always true for two separate Bluetooth speakers.
</master_clock>

<bluetooth_contention>
Two simultaneous A2DP streams over 2.4 GHz is the leading cause of intermittent playback in stacked aggregates. Symptoms: one speaker stutters or drops while the other is fine.

Diagnostic ladder (cheap → expensive):
1. **Swap master** — if Boom is master and Rave stutters, make Rave master. Rule of thumb: weaker BT link wins master.
2. **Toggle drift correction** — default is `true`, but on BT-to-BT pairs with marginal RF, the resampling itself can cause stutter. Try `--drift-correction false` as an experiment.
3. **Check sample rates** — `system_profiler SPAudioDataType | grep -A 6 -i '<speaker name>'` to read `Current SampleRate`. If mismatched, run `./tools/voice/bin/set-sample-rate --name "<device>" --hz 44100` on standalone output devices or on the aggregate itself. Note: BT speakers that are active sub-devices of an aggregate are not individually addressable by this tool — the aggregate controls their rate. User-space, no sudo.
4. **Reconnect single speaker via `blueutil`** — `blueutil --disconnect <MAC>; sleep 2; blueutil --connect <MAC>` clears stale link state on one speaker. Get the MAC from `blueutil --paired | grep <name>`. After reconnect, rebuild the aggregate (the Core Audio object id changes). Least-invasive reset; try before BT power cycle.
5. **PartyCast / Auracast — vendor-app speaker-to-speaker bond** — before reaching for OS-level resets, check whether the speakers can bond directly to each other via the vendor app (Soundcore for Boom 2 / Rave Party 2, etc.). If they can, the Mac sends ONE stream to ONE speaker and the speakers sync themselves, bypassing the Mac's dual-stream BT contention entirely. This is a first-class fix for "solo-link is clicky even without a second stream" — documented in the audio-bridge convene syntheses. The first action is in the vendor app, not on the Mac.
6. **Reduce RF interference** — move the Mac physically between the two speakers, disable AirDrop discoverability with `./tools/voice/bin/airdrop-mode off` (user-space; reversible with `airdrop-mode everyone`), turn off nearby idle Bluetooth devices, check for microwave/2.4 GHz Wi-Fi interference.
7. **Check speaker firmware** — `system_profiler SPBluetoothDataType | grep -A 6 '<speaker name>'` shows `Firmware Version`. Low versions (e.g. 1.0.0) often have A2DP bugs. Have the operator check vendor app for firmware updates.
8. **Full re-pair** — unpair and re-add the speaker in Bluetooth settings when step 4 isn't enough.
9. **Operator-gated: BT power cycle** — `blueutil --power 0; sleep 2; blueutil --power 1` resets the BT radio. User-space but briefly disrupts ALL Bluetooth devices (keyboard, mouse, phone handoff). **Do not run without explicit operator authorization** — confirm first, then run. After cycle, reconnect target speakers with `blueutil --connect <MAC>` and rebuild the aggregate.
10. **Operator-gated: degraded mode** — wired aux (3.5mm) to one speaker + BT to the other, with the wired speaker as aggregate clock master and drift correction ON. Use when dual-BT is unfixable in the current RF environment.
11. **Operator-terminal CoreAudio restart** — for rare "audio stack is completely stuck" states where toggling the output device (`SwitchAudioSource -s "MacBook Pro Speakers"` then back to the aggregate) does not recover, the operator runs `sudo killall coreaudiod` in their terminal. This is the single op that requires elevation; Mythos does not automate it, and does not install a persistent root process to avoid it. After restart, rebuild the aggregate.
12. **Hardware truth** — macOS has one BT radio time-multiplexing streams. Some pairs will never stream cleanly, and per the `speaker-bridge-boom2-rave-clicky` convene, some speakers exhibit clicky playback even on a SOLO A2DP link — a transport-layer problem that no aggregation, drift correction, or sample-rate fix can address from the macOS side. When the ladder is exhausted, the honest answer is: tell the operator. Don't keep rebuilding the aggregate.
</bluetooth_contention>

<quick_start>
1. Enumerate: `./tools/voice/bin/create-aggregate-device --list` — get the current names of every output-capable device. The sidebar in Audio MIDI Setup sometimes shows the same physical Bluetooth speaker twice (one for the HFP mic profile, one for the A2DP output); only the output-profile entry is usable here.
2. Pick the shape. For "play through all of these at once" → stacked. For anything else, ask.
3. Pick the master per `<master_clock>`.
4. Create:
   ```
   ./tools/voice/bin/create-aggregate-device \
     --name "SM Aggregate" \
     --sub-devices "<name1>,<name2>" \
     --master "<name>" \
     --drift-correction true \
     --stacked true
   ```
5. Switch system output: `SwitchAudioSource -s "SM Aggregate"`. Verify: `SwitchAudioSource -c`.
6. If the operator's music app was already running, they need to toggle pause/play or restart the app — audio apps cache the output device handle.
7. If playback is intermittent, apply `<bluetooth_contention>` diagnostic ladder.
</quick_start>

<safety_rules>
- Never modify audio routing without an operator intent signal. Listening state is personal.
- Never destroy an aggregate named by the operator without confirming first. The CLI's idempotent recreate is safe only for aggregates this skill created.
- If only one of the requested sub-devices is connected, the CLI creates the aggregate with what's available and prints a warning. Surface that warning to the operator rather than pretending both made it in.
- Do not assume `SwitchAudioSource` is installed. Check with `which SwitchAudioSource` first.
</safety_rules>

<evidence_contract>
Before declaring "done" to the operator, produce:
- The `--list` output showing the aggregate exists.
- The current system output (`SwitchAudioSource -c`) showing it's the aggregate.
- A test chime (`afplay /System/Library/Sounds/Glass.aiff`) — ask the operator to confirm they heard it from all intended speakers simultaneously. The CLI succeeding is necessary but not sufficient; the operator's ears are the final check.
</evidence_contract>

<failure_modes>
- "I only hear one speaker" — almost always standard-aggregate-instead-of-stacked. Rebuild with `--stacked true`.
- "One speaker is intermittent" — see `<bluetooth_contention>`.
- "The aggregate exists but no audio at all" — the music app has the previous device cached. Restart the app.
- "Both speakers are the same brand and I can't get both in the list" — check for Auracast / PartyCast / vendor broadcast grouping; they collapse to one macOS endpoint.
- "The command exits with code 3" — none of the requested sub-devices were connected. Check Bluetooth pairing.
</failure_modes>

<boundaries>
- This skill does NOT modify the voice-assistant calm-room pipeline, even though it uses the same binary. The voice pipeline has its own setup flow; don't step on it.
- This skill does NOT install `SwitchAudioSource` or any other dependency. If missing, tell the operator how to install (`brew install switchaudio-osx`) and let them decide.
- This skill does NOT persist the system output across reboots — macOS handles that itself based on last-connected Bluetooth state.
</boundaries>

</skill>
