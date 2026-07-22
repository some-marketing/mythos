# Operator Guidance

A self-contained schema + validator + renderer for "what should I do next"
payloads — the structured guidance a command produces when it needs to tell
the operator what to run next, why, and what the alternatives are.

Ported near-verbatim: this was already clean and self-contained in source
(no client data, no operator-specific paths, no dependency on any other
private module).

## What's here

- **`schema.js`** — the JSON Schema every guidance payload must satisfy:
  `command_source` (which command produced this), an optional
  `primary_action` (command / why / canonical accept token), and one or more
  `next_steps` (condition / command / why). Also exports `PHASE_1_COMMANDS`
  (an example command-name list — swap for your own) and
  `ACCEPTANCE_ALIASES` (canonical yes/no-style acceptance tokens).
- **`validator.js`** — validates a payload against the schema and flags
  generic, unhelpful asks (`GENERIC_ASK_PATTERNS`) so a command can't get
  away with vague guidance like "let me know what you'd like to do."
- **`renderer.js`** — turns a validated payload into operator-facing text:
  `renderGuidance` (the primary action + why), `renderAlternatives` (the
  next-steps list), `renderImprovementRequest` (when a payload fails
  validation, a request back to the producing command to improve it).
- **`acceptance-controller.js`** — resolves free-form operator input
  ("yes", "y", "do it", ...) against the canonical acceptance aliases.
- **`index.js`** — re-exports everything from one entry point:
  `require('tools/operator-guidance')`.

## Usage

```js
const guidance = require('tools/operator-guidance');

const payload = {
  command_source: 'my-command',
  primary_action: { command: '/next-command', why: 'because X', canonical_accept: 'yes' },
  next_steps: [{ condition: 'if Y instead', command: '/other-command', why: 'because Y' }],
  improvement_request: null
};

const { valid, errors } = guidance.validateGuidance(payload);
if (valid) console.log(guidance.renderGuidance(payload));
```
