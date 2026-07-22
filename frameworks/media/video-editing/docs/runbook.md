# Video Editing Framework — Runbook

## What This Framework Does

Conversation-driven video editing. Drop raw footage in a folder, run the framework, get `final.mp4` back. No presets, no menus. The framework handles:

- **Transcription**: ElevenLabs Scribe with word-level timestamps, speaker diarization, audio events
- **Editing**: Cut on word boundaries from silence gaps, not frame-by-frame scrubbing
- **Color grading**: Per-segment presets or custom ffmpeg filter chains
- **Subtitles**: 2-word UPPERCASE by default, fully customizable
- **Self-evaluation**: Inspects rendered output at every cut boundary before showing you

## Quick Start

```bash
# 1. Put your footage in a folder
mkdir ~/my-edit
cp ~/Desktop/take*.mp4 ~/my-edit/

# 2. Run the framework
# (from Claude Code, Codex, or any agent with shell access)
/fw-media-video-editing  # or framework-run media/video-editing

# 3. Follow the prompts — the framework will:
#    - Transcribe all sources
#    - Show you a packed transcript
#    - Ask what kind of video this is
#    - Propose a strategy → WAIT for your OK
#    - Execute the edit
#    - Self-evaluate → show you preview
#    - Iterate based on your feedback
```

## Prompt-by-Prompt Walkthrough

### 01: Inventory and Transcribe
- **What happens**: ffprobes all sources, transcribes via ElevenLabs Scribe, packs into `takes_packed.md`
- **What you do**: Nothing — wait for completion
- **Time**: ~30s per minute of source video for first transcription; cached on repeat

### 02: Pre-Scan and Converse
- **What happens**: Scans transcript for verbal slips, describes the material, asks you editorial questions
- **What you do**: Answer naturally — "this is a tutorial," "cut the part where I cough," "I want warm cinematic grade," "no subtitles"
- Do NOT use a fixed checklist — the questions are shaped by your actual footage

### 03: Strategy Proposal **[GATE]**
- **What happens**: Proposes a 4–8 sentence editing strategy
- **What you do**: Read the strategy and explicitly confirm or request changes
- **This is a hard gate** — no cuts happen until you say yes

### 04: Execute Edit
- **What happens**: Produces `edl.json`, applies grade, spawns animations (parallel), renders `preview.mp4`
- **What you do**: Nothing — wait for completion
- **Time**: Seconds to minutes depending on video length and animation complexity

### 05: Self-Eval and Render
- **What happens**: Inspects rendered output at every cut boundary for visual jumps, audio pops, hidden subtitles
- **What you do**: Nothing — the framework self-validates before showing you anything
- **3-pass cap**: If issues persist after 3 self-eval passes, the framework flags them to you rather than looping

### 06: Iterate and Persist
- **What happens**: Processes your feedback, re-renders, appends `project.md` for session memory
- **What you do**: Give natural-language feedback — "make it tighter," "the grade is too warm," "add subtitles"
- **project.md**: Session memory file — next week's session picks up where you left off

## Output Files

Everything lives in `<videos_dir>/edit/`:

```
<videos_dir>/
├── take1.mp4               # Your sources (untouched)
├── take2.mp4
└── edit/
    ├── project.md           # Session memory (appended each session)
    ├── takes_packed.md      # Phrase-level transcript (~12KB per hour)
    ├── edl.json             # Cut decisions
    ├── transcripts/         # Cached Scribe JSON (one per source)
    ├── animations/          # Per-animation source + render
    ├── clips_graded/        # Per-segment graded extracts
    ├── master.srt           # Output-timeline subtitles
    ├── verify/              # Debug frames from self-eval
    ├── preview.mp4          # 720p preview
    └── final.mp4            # Full-quality output
```

## Operator Gates

| Prompt | Gate | What it protects |
|---|---|---|
| 03 | Strategy confirmation | No cuts without your explicit OK |
| 05 | Self-eval cap | Won't loop forever — flags issues after 3 passes |
| 06 | Iteration feedback | You control when the edit is done |

## Tips

### For best transcription
- Use `--num-speakers N` if you know the speaker count (improves diarization)
- First transcription is slow (API call + upload) but cached forever
- Audio quality matters more than video quality for transcription accuracy

### For best edits
- Provide more context in Prompt 02 — the framework adapts to your direction
- Be specific about must-preserve moments ("keep the laugh at 1:23 in take2")
- The `project.md` file is your friend — it remembers preferences across sessions

### For troubleshooting
- If `preview.mp4` looks wrong, check `edit/verify/` for debug frames
- If transcription fails, verify your ElevenLabs key at https://elevenlabs.io/app/settings/api-keys
- If render is slow, animations are the bottleneck — they run in parallel but the slowest one sets total time

## What This Framework Is NOT

- **Not a timeline editor**: You talk to an agent, not a GUI
- **Not real-time**: Transcription + rendering take time
- **Not for live video**: Post-production from existing footage only
- **Not a publishing tool**: Output is `final.mp4` — upload it yourself
- **Not an MCP server**: Helpers are shell-invoked Python scripts, not API tools

## Framework Classification

This framework is a **creative toolkit** (framework component), not a client-deliverable service workflow. It can be composed into broader content-production frameworks. Editorial judgment is the operator's domain — the framework handles production correctness, not taste.

## Upstream brief / delivery standard (paid-social video)

When this framework executes a **paid-social video** order, the brief and the `delivery_spec` input come from the ratified standard — this framework does not define them:

- **Canonical creative reference (source of truth):** `frameworks/_shared/reference/meta-video-creative-2025-2026.md` — placement aspect ratios, durations, safe-zones, hook/caption craft, dated specs (`valid_through`).
- **Brief authoring:** `frameworks/paid-media/ad-creative` (prompt `05_META_VIDEO_BRIEF`) produces the brief intent.
- **Submit gate + tooling:** `tools/mcp/delesign/CHECKLIST.md` + `brief-checklist.js` for Delesign-executed orders.

Honor the supplied `delivery_spec` (AR / safe-zones / caption-style / encoding) and cite its source; the 12 hard production-correctness rules stay authoritative for the cut itself.