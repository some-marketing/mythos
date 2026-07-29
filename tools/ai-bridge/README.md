# AI Bridge — Gemini Browser + API

Tooling for Claude Code to interact with Gemini via browser automation and the Gemini API.

## Status

Browser mode works end-to-end.

API mode now exists for text/image prompts via `tools/ai-bridge/adapters/gemini-api.js`, including inline image output saving for image-capable Gemini models.

The current reliable operational split is:
- browser mode for Gemini web interaction
- API mode for direct prompt/image calls
- local reference artifacts for command-dense infographic work when Gemini image models fail to produce a valid candidate

## Scripts

| npm script | File | Description |
|------------|------|-------------|
| `ai:gemini:auth` | `gemini-auth.js` | One-time interactive login. Saves session to `~/.Mythos/browser_profiles/gemini/storage_state.json` |
| `ai:gemini:session-check` | `gemini-session-check.js` | Headless verification that the saved session is still active |
| `ai:gemini:browser` | `gemini-browser.js` | Send prompt + optional images to Gemini, read structured response |
| `ai:gemini:api` | `adapters/gemini-api.js` | Send prompt + optional images to Gemini REST API, optionally save generated inline image outputs |

## Usage

```bash
# First time: log in and save session
npm run ai:gemini:auth

# Verify session is active
npm run ai:gemini:session-check

# Send a prompt to Gemini
npm run ai:gemini:browser -- \
  --prompt path/to/prompt.md \
  --output path/to/response.json \
  [--images path/to/img1.png,path/to/img2.png]

# Send a prompt through the Gemini REST API
env -u GEMINI_API_KEY npm run ai:gemini:api -- \
  --prompt path/to/prompt.md \
  --output path/to/response.json \
  [--images path/to/img1.png,path/to/img2.png] \
  [--model gemini-2.5-flash]

# Generate or edit an image via Nano Banana Pro
env -u GEMINI_API_KEY npm run ai:gemini:api -- \
  --prompt path/to/prompt.md \
  --images path/to/reference.png \
  --output path/to/response.json \
  --model gemini-3-pro-image-preview \
  --aspect-ratio 16:9 \
  --image-size 4K \
  --max-tokens 512
```

### API key precedence

`gemini-api.js` resolves credentials in this order:

1. `process.env.GEMINI_API_KEY`
2. `~/.Mythos/.env`

Operational recommendation:
- keep the paid Gemini key in `~/.Mythos/.env`
- avoid a global `GEMINI_API_KEY` export in `.bashrc` unless you explicitly want every shell to override the file-backed key
- when debugging key-source issues, run API calls with `env -u GEMINI_API_KEY ...` to force use of `~/.Mythos/.env`

### Current model notes

- Default text model in `gemini-api.js` is `gemini-2.5-flash`
- `gemini-2.0-flash` is retired for new users and should not be the default
- Nano Banana: `gemini-2.5-flash-image`
- Nano Banana Pro: `gemini-3-pro-image-preview`

### Current image-generation caveat

Simple image-generation prompts work through `gemini-3-pro-image-preview` and return inline image data correctly.

For dense command-heavy infographic prompts, the current `generateContent` path can return:
- `finishReason: "MALFORMED_FUNCTION_CALL"`
- empty `candidate.content`
- a `finishMessage` showing an internal `call:google:image_gen{...}` invocation

This was observed on both text-to-image and image-to-image infographic attempts.

Current workaround:
- build a local reference artifact first
- keep a local fallback deliverable (for example Mermaid or HTML/PNG board)
- prefer shorter refinement prompts over one-shot dense poster prompts

Relevant artifacts from the Mythos command-flow infographic attempt:
- `_dev/reports/analysis/mythos-command-flowchart__2026-04-02.md`
- `_dev/reports/analysis/mythos-command-reference-board__2026-04-02.html`
- `_dev/reports/analysis/mythos-command-reference-board__2026-04-02.png`

## Libraries

| File | Purpose |
|------|---------|
| `lib/response-parser.js` | Extracts fenced code blocks (html, css) from Gemini response text |
| `lib/chrome-profile.js` | Resolves macOS Chrome profile directories by name or path |
| `adapters/gemini-api.js` | Gemini REST adapter for text/image prompts, inline image saving, and model selection |

## Session Storage

Sessions are saved outside the repo at `~/.Mythos/browser_profiles/gemini/storage_state.json` (Playwright storage state format). Re-run `ai:gemini:auth` when the session expires.

API credentials should also live outside the repo, preferably in `~/.Mythos/.env`.

## Planned Additions (Stage 3+)

- `evidence-gather.js` — Capture element evidence from a live site via Playwright
- `prompt-builder.js` — Construct Trifecta prompts from evidence
- `validate-response.js` — Validate Gemini HTML output against rules
- `pipeline.js` — Orchestrate the full workflow with human approval gate

See `_dev/whats-next-gemini-pipeline.md` for the full build plan.
