# Gmail Inbox Agent

This is a repo-local preview slice for day-job email triage. It does not read Gmail, mutate Gmail labels, archive messages, create Dart tasks, read credentials, or use browser automation.

Privacy note: preview output, learned rules, and local rules can contain sender addresses if real mailbox exports are used. Do not commit real mailbox exports, preview outputs, or learned rule files. This slice still performs no live calls.

## Model

- Gmail is treated as the mailbox/archive surface.
- Dart is treated as the future control plane and durable rule memory.
- This slice emits proposed decisions only.

## Outcomes

- `keep`: leave visible; no Dart action.
- `task`: label for task creation; proposed Dart action is `create_task`.
- `digest`: label and archive; proposed Dart action is `append_digest`.
- `noise`: label and archive; no Dart action.
- `watch`: label for human review; proposed Dart action is `create_review`.

## Rule Precedence

1. Human correction sender rule.
2. Human correction domain rule.
3. Seed sender rule.
4. Seed domain rule.
5. Deterministic classifier.
6. Conservative fallback `keep`.

Correction labels on a message are also treated as immediate human corrections:

- `Mythos/Correct/Keep`
- `Mythos/Correct/Task`
- `Mythos/Correct/Digest`
- `Mythos/Correct/Noise`
- `Mythos/Correct/Watch`

The rules library can learn sender rules by default, or sender plus domain rules when requested, from correction-labeled local JSON.

## Preview

```bash
node tools/gmail-inbox-agent/preview.js tools/gmail-inbox-agent/fixtures/sample-emails.json
```

Input may be an array of email objects or an object with `emails` and optional `rules`. The CLI prints JSON decisions and performs no network or live-system calls.
