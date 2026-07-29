# 05 — Schedule Periodic Rebuild

**Stage:** build
**Mode:** PATCH_ALLOWED
**Risk:** low

## Objective

Create a scheduled job that periodically rebuilds the dream database so associations stay fresh even during long-running sessions where boot hooks don't fire regularly.

## Process

1. Choose the scheduling mechanism:
   - macOS: launchd plist with `StartCalendarInterval`
   - Linux: systemd timer or cron job
   - Cross-platform: a simple polling script with sleep interval

2. Use the `templates/launchd.plist.template` as a starting point for the platform-appropriate format.

3. Configure scheduling:
   - Run at a low-load time (e.g., 3:00 AM daily)
   - Verify no conflicts with other scheduled jobs
   - Log stdout and stderr to a known location

4. Install the scheduled job:
   - macOS: `launchctl bootstrap gui/$(id -u) <path-to-plist>`
   - Linux: `systemctl enable --now <service>`
   - Cross-platform: add to crontab or session startup

5. Verify:
   - Job appears in the scheduler's list
   - Manual trigger works (`launchctl start` or equivalent)
   - Logs are written to the expected path

## Expected Output

- Platform-appropriate scheduled job configuration
- Job installed and verified loadable

## Gates

- Must not overlap with other scheduled maintenance jobs
- Must log output to a known, inspectable path
- Manual trigger must produce a fresh dream report
