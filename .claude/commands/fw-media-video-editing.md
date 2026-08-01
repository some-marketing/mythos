---
description: Run Video Editing — Conversation-driven video editing: transcribe, cut, color grade, burn subtitles, self-evaluate
mode: COORDINATOR
---

<objective>
Execute the Video Editing framework against a client project. Routes into the per-framework harness at frameworks/media/video-editing/.claude/.
</objective>

<process>
- Read authoritative process from .claude/commands/fw-media-video-editing.md and frameworks/media/video-editing/manifest.json.
- Verify project path and framework link.
- Verify MCP availability per framework manifest.
- Execute via /run-framework media/video-editing <project-path>.
- Validate outputs against manifest output contract.
</process>

<success_criteria>
- Framework prompt chain executed in correct order
- Output artifacts match manifest output contract
</success_criteria>
