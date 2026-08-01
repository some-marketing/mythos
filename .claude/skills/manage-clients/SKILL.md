---
name: manage-clients
description: >
  Manages agency clients and projects. Use when registering new agency clients, scaffolding
  client projects, or managing the client registry. Client registry lives in Mythos under
  `clients/`. Client work lives in `clients/{CODE}/` for private operations, or in external
  workspace repos for public distribution.
version: 1.0.0
---

<skill>
<objective>
Manage agency clients and their projects:
- Register new clients in the Mythos registry (`clients/{CODE}/client.json`)
- Scaffold project directories linked to specific frameworks (inside `clients/{CODE}/` for private operations, or in external workspace repos)
- Check project status
</objective>

<quick_start>
1. To register a client: `/new-client CLIENTC "Client C"`
2. To create a project: `/new-project CLIENTC wordpress/qa contact-form`
Steps 3-4 apply to external workspace repos only (not private clients/ ops):
3. For external workspaces: `npm run workspace:scaffold` then `npm run workspace:project`
4. To check status: `/project-status CLIENTC/wordpress__qa__contact-form`
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
- External workspace project directory follows `{service}__{framework}__{slug}` naming convention when applicable
</success_criteria>
</skill>
