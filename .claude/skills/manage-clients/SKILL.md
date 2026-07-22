---
name: manage-clients
description: >
  Manages agency clients and projects. Client registry lives in Mythos under `clients/`.
  Client work is recommended to live in external per-client workspace repos.
version: 1.0.0
---

<skill>
<objective>
Manage agency clients and their projects:
- Register new clients in the Mythos registry (`clients/{CODE}/client.json`)
- Scaffold project directories linked to specific frameworks (legacy Mythos projects or external workspaces)
- Check project status
</objective>

<quick_start>
1. To register a client: `/new-client CLIENTC "Client C"`
2. Recommended: create a workspace repo via `npm run workspace:scaffold` (from the learning-language-models repo)
3. To create a project (legacy Mythos): `/new-project CLIENTC wordpress/qa contact-form`
4. To check status (legacy Mythos): `/project-status CLIENTC/wordpress__qa__contact-form`
</quick_start>

<commands>
| Command | Workflow | Description |
|---------|----------|-------------|
| `/new-client` | create-client | Register a new agency client |
| `/new-project` | create-project | Create a project for a client under a framework |
| `/project-status` | check-status | Check status of a client project |
</commands>

<workflows>
- `workflows/create-client.md` — Scaffold client directory with metadata
- `workflows/create-project.md` — Create project directory linked to framework
- `workflows/check-status.md` — Check status of a client project
</workflows>

<success_criteria>
- Client directory exists at `clients/{CODE}/` with valid client.json
- client.json contains required fields: code, name, industry
- Project directory follows naming convention: `{service}__{framework}__{slug}`
- Project directory contains project.json linked to the correct framework
- Client code is unique and does not conflict with existing clients
</success_criteria>
</skill>
