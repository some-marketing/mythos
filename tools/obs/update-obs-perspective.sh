#!/usr/bin/env bash
# update-obs-perspective.sh — replace the OBS "myperspective" image on Rupert with a photo from this Mac.
#
# Proven flow (first run 2026-06-01): newest Photos-library photo -> JPEG (sips) -> back up the
# current image (on Rupert + a timestamped copy on the Mac) -> scp up -> overwrite the live OBS
# image file -> verify. OBS image sources auto-reload on file change.
#
# Usage:
#   tools/obs/update-obs-perspective.sh                 # use the NEWEST photo in the Mac Photos library
#   tools/obs/update-obs-perspective.sh --photo FILE    # use a specific image (heic/jpg/png)
#   tools/obs/update-obs-perspective.sh --dry-run       # show what it WOULD do (fully local, no remote writes)
#   tools/obs/update-obs-perspective.sh --restore       # put the previous image back
#
# Config (override via env): RUPERT_HOST, OBS_IMAGE, PHOTOS_ORIG
set -uo pipefail

RUPERT_HOST="${RUPERT_HOST:-taylo@rupert}"
OBS_IMAGE="${OBS_IMAGE:-H:\\My Drive\\myperspective.jpeg}"   # Windows (cmd) path on Rupert
PHOTOS_ORIG="${PHOTOS_ORIG:-$HOME/Pictures/Photos Library.photoslibrary/originals}"
WORK="${TMPDIR:-/tmp}/obs-swap"; mkdir -p "$WORK"
SSHO=(-o BatchMode=yes -o ConnectTimeout=12)
clean(){ grep -viE "post-quantum|store now|may need|openssh" || true; }
say(){ printf '%s\n' "$*" >&2; }
die(){ say "ERROR: $*"; exit 1; }

PHOTO=""; DRYRUN=0; RESTORE=0
while [ $# -gt 0 ]; do case "$1" in
  --photo)   PHOTO="${2:-}"; shift 2;;
  --dry-run) DRYRUN=1; shift;;
  --restore) RESTORE=1; shift;;
  -h|--help) sed -n '2,16p' "$0"; exit 0;;
  *) die "unknown arg: $1 (try --help)";;
esac; done

if [ "$RESTORE" = 1 ]; then
  say "[restore] copying previous image back over the live OBS image on $RUPERT_HOST ..."
  ssh "${SSHO[@]}" "$RUPERT_HOST" "copy /Y \"%USERPROFILE%\\myperspective.prev.jpeg\" \"$OBS_IMAGE\"" 2>&1 | clean
  ssh "${SSHO[@]}" "$RUPERT_HOST" "dir \"$OBS_IMAGE\"" 2>&1 | clean | grep -iE "myperspective|File\(s\)" || true
  exit 0
fi

# 1. Pick the source photo (newest in Photos library if not given)
if [ -z "$PHOTO" ]; then
  PHOTO="$(find "$PHOTOS_ORIG" -type f \( -iname '*.heic' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \) -print0 2>/dev/null \
           | xargs -0 stat -f '%m %N' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)"
fi
[ -n "$PHOTO" ] && [ -f "$PHOTO" ] || die "no source photo found (pass --photo FILE)"

# 2. Convert to JPEG (OBS reads jpeg; keeps native dimensions so the OBS transform stays valid)
JPG="$WORK/obs-new.jpg"
sips -s format jpeg "$PHOTO" --out "$JPG" >/dev/null 2>&1 || die "sips conversion failed for: $PHOTO"
NEWDIMS="$(sips -g pixelWidth -g pixelHeight "$JPG" 2>/dev/null | awk '/pixelWidth/{w=$2}/pixelHeight/{h=$2}END{print w"x"h}')"
say "[photo]  $PHOTO"
say "[jpeg]   $JPG  ($NEWDIMS, $(wc -c < "$JPG") bytes)"
say "[target] $RUPERT_HOST :: $OBS_IMAGE"

if [ "$DRYRUN" = 1 ]; then say "[dry-run] not pushing. (re-run without --dry-run to apply)"; exit 0; fi

# 3. Back up the current image: fixed-name on Rupert (for --restore) + timestamped on the Mac
ts="$(date +%Y%m%dT%H%M%S)"
ssh "${SSHO[@]}" "$RUPERT_HOST" "copy /Y \"$OBS_IMAGE\" \"%USERPROFILE%\\myperspective.prev.jpeg\"" 2>&1 | clean
scp "${SSHO[@]}" "$RUPERT_HOST:myperspective.prev.jpeg" "$WORK/myperspective.backup.$ts.jpeg" 2>&1 | clean
[ -f "$WORK/myperspective.backup.$ts.jpeg" ] && say "[backup] $WORK/myperspective.backup.$ts.jpeg" || say "[backup] (rupert copy made; mac pull skipped)"
OLDDIMS="$(sips -g pixelWidth -g pixelHeight "$WORK/myperspective.backup.$ts.jpeg" 2>/dev/null | awk '/pixelWidth/{w=$2}/pixelHeight/{h=$2}END{print w"x"h}')"
[ -n "${OLDDIMS:-}" ] && [ "$OLDDIMS" != "$NEWDIMS" ] && say "[note] dimensions changed ($OLDDIMS -> $NEWDIMS) — you may need to nudge the OBS source transform (right-click → Transform → Fit to screen)."

# 4. Push + overwrite the live OBS image
scp "${SSHO[@]}" "$JPG" "$RUPERT_HOST:obs-new.jpg" 2>&1 | clean
ssh "${SSHO[@]}" "$RUPERT_HOST" "copy /Y \"%USERPROFILE%\\obs-new.jpg\" \"$OBS_IMAGE\"" 2>&1 | clean

# 5. Verify
say "[verify]"
ssh "${SSHO[@]}" "$RUPERT_HOST" "dir \"$OBS_IMAGE\"" 2>&1 | clean | grep -iE "myperspective|File\(s\)" || true
say "[done] OBS should auto-reload. If not, toggle the source's visibility. Restore: $0 --restore"
