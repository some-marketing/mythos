---
description: Site — advisory router that maps normal operator wording to the native command that should own the work
argument-hint: <intent phrase>
allowed-tools: [Read, Glob, Grep]
---

> Authority: `route` — this mythic name is an alias; state and errors belong to the resolved command.

<objective>
Sight the path (route): map normal operator language to the existing native command that should own the work, without executing it and without creating a parallel authority system. In plain terms: this is an advisory, dry-run router — it recommends a command, it never runs one.
</objective>

<process>
1. Read the operator intent string.
2. When a conservative rule matches, return one recommended native command with a short rationale.
3. Validate the recommended target against the known command set (including alias resolution).
4. Never execute the recommended route.
5. If no conservative match exists, report no match and point the operator to `/plan-quest`.
</process>

<success_criteria>
- Output is advisory and dry-run only
- Every route target resolves through an existing command or alias
- Framework-lifecycle intents point to native lifecycle commands rather than re-encoding lifecycle authority
- No parallel routing authority is introduced
</success_criteria>

<handoff>
matched: the operator may run the returned native command after reading the rationale
unmatched: /plan-quest "<task>"
</handoff>
