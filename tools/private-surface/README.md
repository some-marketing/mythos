# tools/private-surface

On-device, privacy-preserving ingestion of private audio (call recordings, voice
notes) into **redacted, task-relevant findings**. If operator-captured
recordings are a recurring source of task signal for your own workflow, this
is the reusable ingestion mechanism — built as permanent tooling rather than
one-off scripts.

All processing here runs **fully on the local device**. No audio and no
transcript text ever leaves the machine. Only redacted, task-relevant findings
plus a search receipt are surfaced upward.

## The two tools

### `wait-for-airdropped-audio.sh`
Bounded, interruptible watcher that blocks until new audio/video files land in a
drop directory, then lists them. Used to catch AirDropped call recordings
hands-free.

- **Usage:** `wait-for-airdropped-audio.sh [watch_dir] [timeout_s] [settle_s]`
- **Defaults:** `~/Downloads`, `1200`s timeout, `25`s settle (waits for the rest
  of a batch to finish copying after the first hit). A 3-minute grace window
  catches an AirDrop that completed just before the watcher was armed.
- **Inputs:** watch dir on the local filesystem.
- **Outputs:** `NEWFILE: <path>` lines on detection, or `TIMEOUT: ...` if nothing
  arrives in the window. Detects extensions: `mov m4a mp4 wav mp3 caf aac`.
- Detection only — it never opens or reads file contents. Interruptible at any
  time (Ctrl-C / kill).

### `notes-audio-transcribe.sh`
On-device transcription of audio files (call recordings, voice notes) via
`ffmpeg` (decode) → `whisper.cpp` (speech-to-text).

- **Usage:** `notes-audio-transcribe.sh <audio-file> [<audio-file> ...]`
- **Env:** `TRANSCRIBE_OUTDIR` (override the ephemeral output dir);
  `WHISPER_MODEL` (override the model path).
- **Inputs:** one or more local audio files.
- **Outputs:** one `TRANSCRIPT: <path>.txt` line per input, plus an
  `OUTDIR: <dir> (ephemeral — do not commit)` footer. The default output dir is
  under `$TMPDIR` (`$TMPDIR/smos-private-transcripts`). The intermediate 16 kHz
  WAV is deleted after transcription.
- Runs fully on-device. No audio or transcript egress. Redaction before any
  frontier-model surfacing is the **caller's** responsibility.

## The privacy contract

Audio surfaces (voice memos, microphone captures) are private substrates,
not default frontier-model context. Whatever your own guild's private-surface
policy looks like, these are the obligations this pattern was built to honor
— adapt them to your own doctrine file if you have one:

- **Ephemeral transcripts.** Derived transcripts default to `$TMPDIR` and are
  ephemeral (`ephemeral-derived-artifacts`). They must declare retention and be
  cleaned up at session end unless retention is explicitly ratified.
- **No repo commit of private output** (`no-repo-commit-of-private-output`).
  Transcripts, filenames, note titles, contact identifiers, and message snippets
  must never be committed to the repo. Only a **redacted, task-relevant findings**
  artifact plus a **search receipt** may be surfaced.
- **Per-task ratification** (`per-task-ratification`). Reading the private audio
  substrate requires a named standing allowance or task-specific operator
  ratification. A standing `voice-memos-local-capture-index` allowance covers
  local transcription/indexing, but quoting transcript content, sending it to a
  frontier model, or surfacing non-allowlisted names / third-party speech each
  **still requires a per-task prompt**.
- **Cross-surface sweeps need explicit opt-in**
  (`cross-surface-sweeps-explicit-only`). Correlating audio findings against
  notes, messages, mail, calendar, browser, photos, keychain, or 1Password
  requires an explicit operator phrase — a broad task goal is not authorization.
- **Search receipt required** (`search-receipt-required`). Every permitted answer
  carries a receipt: substrate, wrapper, ratification id, query bounds, fields
  read, incidental count, redaction applied, retained artifacts, cleanup status.

## Typical flow

1. Operator AirDrops / saves a recording into the drop dir (e.g. `~/Downloads`).
2. `wait-for-airdropped-audio.sh` detects it and emits `NEWFILE:` paths.
3. `notes-audio-transcribe.sh` transcribes each file **on-device** to an
   ephemeral `$TMPDIR` transcript.
4. The coordinator scans the transcript, extracts only **redacted,
   task-relevant findings** (linked back to source recording date/participant),
   and writes a **search receipt**.
5. The raw transcript is discarded (cleanup); nothing private is committed.

## Dependencies

- `ffmpeg` — audio decode / resample to 16 kHz mono WAV.
- `whisper-cli` (whisper.cpp) — on-device speech-to-text.
- A local model at `tools/voice/models/ggml-base.en.bin` (override via
  `WHISPER_MODEL`).

Both scripts preflight these and fail fast with a clear `ERROR:` if a binary or
the model is missing.

## Discipline notes

Always record *how* information was obtained — here, the search receipt is
that provenance record. And if pulling recordings is a recurring ask in your
own workflow, capture it as permanent, reusable tooling the first time it
comes up rather than re-improvising a one-off script each time.
