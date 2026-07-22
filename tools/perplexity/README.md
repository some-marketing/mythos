# Perplexity research CLI

A small, self-contained wrapper over the [Perplexity](https://www.perplexity.ai)
Chat Completions API. Frameworks use it as an optional web-research leg; it has
no dependencies beyond Node's built-in `fetch` (Node 18+).

## Setup

1. Get an API key at https://www.perplexity.ai → Settings → API.
2. Add it to your `.env` at the repo root:

   ```
   PERPLEXITY_API_KEY=pplx-xxxxxxxxxxxxxxxx
   ```

   The CLI reads the key **only** from the environment (or `.env`); it is never
   passed on the command line.

## Usage

```bash
# Argument form
node tools/perplexity/cli.js "what are 2025 best practices for X?"

# npm script
npm run research:perplexity -- "what are 2025 best practices for X?"

# Piped
echo "summarize the leading approaches to Y" | node tools/perplexity/cli.js

# Structured output (answer + citations) to a file
node tools/perplexity/cli.js --json --output research/out.json "your question"
```

### Options

| Flag | Meaning |
|------|---------|
| `--model <name>` | `sonar`, `sonar-pro` (default), `sonar-reasoning-pro`, `sonar-deep-research` |
| `--json` | Print the full payload (answer + citations) as JSON |
| `--output <path>` | Also write the full JSON payload to a file |
| `--help` | Show help |

### Exit codes

- `0` success
- `1` no query provided
- `2` `PERPLEXITY_API_KEY` not set
- `3` API call failed (network, auth, or non-2xx)

## Optional by design

Frameworks that reference Perplexity degrade gracefully without a key — the
research leg is skipped with a note rather than failing the run. Set the key to
enable it.
