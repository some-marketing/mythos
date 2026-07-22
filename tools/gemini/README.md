# Gemini API glue

Two small, self-contained scripts against `@google/genai`, bring-your-own API key.

- `list-models.mjs` -- lists models available to your key.
- `nano-banana-generate.mjs <prompt-file> <out-dir> [ref-image...]` -- generates image(s) from a text prompt plus optional reference images, via `GEMINI_IMAGE_MODEL` (default `gemini-3.1-flash-image-preview`).

## Setup

Copy `env.example` to `.env` (or export the vars directly) and set `GEMINI_API_KEY`. See `creds.config.json` for the documented credential-resolution shape this repo's tools follow (env var / macOS Keychain / 1Password / `.env` file).

```bash
node list-models.mjs
node nano-banana-generate.mjs prompt.txt ./out ref1.png
```
