---
description: Bridge multiple audio output devices (typically Bluetooth speakers) into a single system output so they play simultaneously
mode: RUN_ONLY
---

<objective>
Aggregating multiple audio output devices into a single stacked aggregate device and switching system output to it.
</objective>

<process>
- 1. Run ./tools/voice/bin/create-aggregate-device --list and read current output devices.
- 2. Propose bridging connected non-built-in devices (typically Bluetooth speakers).
- 3. Use stacked aggregation shape (--stacked true).
- 4. Enable drift correction whenever a sub-device is Bluetooth.
- 5. Switch system output to the new aggregate via SwitchAudioSource.
- 6. Verify with SwitchAudioSource -c and a test chime.
- 7. Ask operator to confirm audio from all speakers.
- 8. If issues arise, follow the <bluetooth_contention> diagnostic ladder in the skill.
</process>

<success_criteria>
- Aggregate device created successfully
- System output switched to the aggregate
- Test chime verified on all speakers
- Drift correction enabled for Bluetooth devices
</success_criteria>
