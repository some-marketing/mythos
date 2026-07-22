# obs — remote OBS image-source swap

A small tool for one recurring chore: pushing a fresh photo onto a remote
Windows host running OBS (Open Broadcaster Software), where an image source
reads a live file from disk and auto-reloads on change.

```
OBS_HOST=youruser@yourhost tools/obs/update-obs-perspective.sh
```

Picks the newest photo in your Mac Photos library, converts it to JPEG,
backs up the current remote image (both on the remote host and a timestamped
local copy), pushes the new one over SSH/SCP, and verifies the write. `--dry-run`
does everything except the remote writes; `--restore` puts the previous image
back; `--photo FILE` lets you pick a specific image instead of the newest one.

Requires key-based SSH access to the remote host (batch mode, no interactive
prompts) and a Windows OBS instance whose image source points at a
`copy`-writable path — override the default (`H:\My Drive\myperspective.jpeg`)
via `OBS_IMAGE` if yours lives elsewhere.
