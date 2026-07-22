# How to Launch Browsers (Phased Runner)

## Quick Reference

```bash
# Allocate a runset first (provides RUNSET_ID for all env runs)
node framework/runner/cli.js new-runset --testcase <TESTCASE_ID> --tags "smoke"

# Default (headless Chromium — most reliable)
node framework/runner/cli.js run --testcase <TESTCASE_ID> --runset run_0001 --env A-logged_out

# Headed (watch in real-time)
node framework/runner/cli.js run --testcase <TESTCASE_ID> --runset run_0001 --env A-logged_out --headed

# With slowmo for debugging
node framework/runner/cli.js run --testcase <TESTCASE_ID> --runset run_0001 --env A-logged_out --headed --slowmo 500
```

## Headed vs Headless

**Headless (default)** is for all actual runs. The runner captures identical evidence either way — screenshots, cookies, dataLayer events, console logs, network requests.

**Headed** is only for initial setup and debugging:
- Verifying selectors match the live page
- Watching the form fill to confirm field mapping
- Diagnosing navigation or timing issues

Once you've confirmed the setup works with a headed run, switch back to headless for all subsequent runs. Headed mode requires a Terminal session with WindowServer access and working DNS — headless works from anywhere (Codex default sandbox, CI, SSH, etc.).

## DNS Prerequisite

Playwright's browser uses the system DNS resolver (not browser-level DoH). If your router's DNS is unreliable, set public resolvers:

```bash
networksetup -setdnsservers Wi-Fi 8.8.8.8 8.8.4.4 1.1.1.1
```

Without working system DNS, the browser will launch but all navigations will fail with `ERR_NAME_NOT_RESOLVED`.

## Running from Codex

### Setup (global install)

Codex is installed globally at `~/.npm-global/bin/codex` but may not be in PATH. Add to `~/.zshrc`:
```bash
export PATH="$HOME/.npm-global/bin:$PATH"
```

Then reload (`source ~/.zshrc`) and run directly:
```bash
codex --sandbox danger-full-access
```

Using `npx codex` vs the global `codex` binary makes no difference to sandbox behavior — the `--sandbox` flag is what matters.

### Sandbox levels and browser compatibility

| Sandbox flag | Mach IPC allowed? | Browser launch? |
|--------------|-------------------|-----------------|
| `--sandbox read-only` (default) | No | Headless only |
| `--sandbox workspace-write` | No | Headless only |
| `--sandbox danger-full-access` | Yes | All browsers |
| `--yolo` | Yes | All browsers |

To launch browsers (including headed) from Codex, use:
```bash
codex --sandbox danger-full-access
```

### Why the default sandbox blocks browsers

Codex's default sandbox (macOS Seatbelt) restricts:

- **Mach IPC / bootstrap services** — Chrome, Firefox, and WebKit all attempt `bootstrap_check_in` to register a Mach port rendezvous server. The sandbox denies this, producing "Permission denied (1100)".
- **WindowServer access** — GUI app registration via `HIServices` / `_RegisterApplication` requires WindowServer. Without it, Chrome calls `abort()` during `+[NSApplication sharedApplication]`.
- **CPU model info** — `os.cpus()` may return an empty array, causing Playwright to resolve `mac-x64` browser paths on an `arm64` machine.
- **Temp space** — The sandbox's `/var/folders` tmpdir may be size-limited.

**Bottom line:** With the default sandbox, only `chrome-headless-shell` (headless) can launch. Use `--sandbox danger-full-access` to remove restrictions and allow all browsers. Re-signing the binary does NOT help under the default sandbox — the Seatbelt policy itself denies the IPC call regardless of signature.

### What works inside Codex

| Mode | Binary | Works? | Why |
|------|--------|--------|-----|
| `headless: true` (default) | `chrome-headless-shell` | Yes | No GUI registration needed |
| `headless: false` (headed) | `Google Chrome for Testing.app` | No | Needs WindowServer |
| `--browser firefox` | Firefox | No | Needs Mach port registration |
| `--browser webkit` | WebKit | No | Needs Mach port registration |
| `--browser_channel chrome` | System Chrome | No | Needs WindowServer |

### Ensuring headless works from Codex

1. Always use `node framework/runner/cli.js run` (not with `--headed`) — the wrapper handles the platform override.
2. Never pass `--headed`.
3. If `os.cpus()` is empty, the wrapper auto-sets `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac15-arm64`.
4. If TMPDIR is restricted, set `PW_TMPDIR=./.tmp` (wrapper does this by default).

### If you need headed mode

You must run the phased runner from a real Terminal session (not from Codex). Codex cannot launch GUI browsers.

---

## Known Issues on macOS Apple Silicon (outside Codex)

### 1. Wrong architecture binary (x64 vs arm64)

**Symptom:** `executable doesn't exist at .../chrome-headless-shell-mac-x64/...`

**Cause:** `os.cpus()` returns empty/undefined in some sandboxed environments, making Playwright think it's on x64.

**Fix:** The wrapper scripts automatically set `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE` when CPU model detection fails. Always use the CLI commands, not the runner scripts directly.

**Manual override:**
```bash
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac15-arm64 node framework/runner/cli.js run --testcase <TESTCASE_ID> --runset run_0001 --env A-logged_out
```

The value format is `mac<version>-arm64` where version = `os.release() major - 9` (capped at 15). For macOS 26.x (Darwin 25.x): `mac15-arm64`.

### 2. Chrome crashes on launch with SIGABRT / Permission denied (1100)

**Symptom:** Crash in `HIServices` → `_RegisterApplication` → `abort()`. Console shows:
```
bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer...: Permission denied (1100)
```

**Cause:** Playwright's downloaded "Chrome for Testing" has an invalid adhoc code signature. On macOS 26 with SIP enabled, the system rejects it when it tries to register as a GUI application.

**Fix — re-sign the app bundle:**
```bash
codesign --force --deep --sign - \
  "$HOME/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app"
```

**Why headless still works:** Headless mode uses `chrome-headless-shell` (a standalone binary, not a `.app` bundle), which doesn't attempt GUI/WindowServer registration.

### 3. System Chrome (`--browser_channel chrome`) also SIGABRTs

**Cause:** Same HIServices registration issue, but for system Chrome it can also happen when launched from a non-interactive session (SSH, cron, some CI environments) that lacks WindowServer access.

**Fix:** Ensure you're running from a real Terminal session (not SSH). If that's not possible, use headless mode only.

### 4. Firefox / WebKit abort

**Cause:** Similar macOS sandboxing restrictions. Firefox and WebKit also need WindowServer registration for headed mode.

**Fix:** Use headless mode, or run from a real Terminal session with display access.

### 5. Disk space (ENOSPC)

**Symptom:** `ENOSPC: no space left on device, mkdtemp .../playwright-artifacts-...`

**Cause:** `/var/folders/.../T` (default TMPDIR) is full.

**Fix:** The wrapper already sets `TMPDIR=./.tmp`. Override with:
```bash
PW_TMPDIR=/path/with/space node framework/runner/cli.js run --testcase <TESTCASE_ID> --runset run_0001 --env A-logged_out
```

## Browser Paths (for reference)

Playwright stores browsers in `~/Library/Caches/ms-playwright/`:

| Browser | Path |
|---------|------|
| Chromium (headed) | `chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app` |
| Chromium (headless) | `chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell` |
| Firefox | `firefox-1509/` |
| WebKit | `webkit-2248/` |
| System Chrome | `/Applications/Google Chrome.app/` |

## Recommended Launch Strategy

### From Codex (`npx codex`)

1. **Only headless Chromium works.** Use `node framework/runner/cli.js run` (no `--headed` flag).
2. The wrapper handles `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE` and `TMPDIR` automatically.
3. Firefox, WebKit, headed mode, and system Chrome are all blocked by the sandbox.

### From a real Terminal session

1. **Default:** Headless Chromium via `node framework/runner/cli.js run` — uses the headless shell binary, avoids GUI registration entirely.
2. **If you need headed:** Re-sign the Chrome for Testing app bundle first (see fix #2 above), then use `node framework/runner/cli.js run --testcase <TESTCASE_ID> --runset run_0001 --env A-logged_out --headed`.
3. **If Chromium keeps crashing:** Try Firefox after installing browsers.
4. **Debug launch issues:** Prefix with `DEBUG=pw:browser*` to see Playwright's browser launch logs:
   ```bash
   DEBUG=pw:browser* node framework/runner/cli.js run --testcase <TESTCASE_ID> --runset run_0001 --env A-logged_out
   ```

## Re-installing Browsers

```bash
npm run install:browsers
```

This runs through the same wrapper that sets the platform override, so it downloads the correct arm64 binaries.

## Compile a runset summary (optional)

After running A/B/C under the same `--runset`:
```bash
node framework/runner/cli.js report --testcase <TESTCASE_ID> --runset run_0001
```
