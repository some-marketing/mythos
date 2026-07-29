# Workspace Tooling

These scripts scaffold and validate **client workspaces** for both deployment models. For private operations, workspace commands create directories inside `clients/{CODE}/`. For public distribution, workspace commands scaffold and manage external repos so Mythos remains a clean framework library.

## Commands

- `npm run workspace:scaffold -- --internal --client-code <CODE>`
  - Creates a private-operations workspace inside `clients/{CODE}/`. Reads client name from `client.json`. Skips `.gitignore` and `.env.example` (parent Mythos repo handles these).

- `npm run workspace:scaffold -- --out <path> --client-code <CODE> --client-name "<Name>"`
  - Creates a new external client workspace repository skeleton.

- `npm run workspace:project -- --workspace <path> --framework wordpress/qa --slug <slug>`
  - Creates a new project directory inside an existing workspace and installs the framework runtime pack + intake templates.

- `npm run workspace:validate -- --workspace <path>` or `npm run workspace:validate -- --client-code <CODE>`
  - Checks workspace shape, secret safety, and required framework runtime paths. Use `--client-code` for private-operations workspaces inside `clients/{CODE}/`.

- `npm run workspace:capture -- --into <project-root> --task-type <name> --from <path>`
  - Imports successful work from anywhere on disk into a capture bundle under a workspace project.

- `npm run workspace:capture:normalize -- --capture <capture-root>`
  - Marks a capture bundle ready for scaffolding only when it contains enough structured evidence.

- `npm run workspace:capture:status -- --capture <capture-root>`
  - Reports missing fields, normalization status, and capture readiness.

- `npm run workspace:candidate:scaffold -- --project <project-root> --captures <id,id,...> --service <service> --name <framework-name>`
  - Scaffolds a framework candidate and a draft `proposed_framework/` from normalized captures.

- `npm run workspace:candidate:status -- --candidate <candidate-root>`
  - Reports replay counts, sanitization blockers, and promotion readiness.

- `npm run workspace:candidate:replay -- --candidate <candidate-root> --case all`
  - Runs replay-readiness checks for one or more replay cases.

- `npm run workspace:candidate:promote -- --candidate <candidate-root>`
  - Promotes a validated candidate into `Mythos/frameworks/` and regenerates instructions.

## Safety notes

- Secrets are **never** committed to git in either deployment model.
- In **external workspaces**, `secrets/` is created with a `.gitignore` rule so secrets are not accidentally committed.
- In **private operations**, `clients/{CODE}/secrets/` exists inside the Mythos repo but is gitignored. Auth states, `.env` files, and network captures are also excluded by default.
- Successful work captured from outside Mythos must be normalized into a workspace capture bundle before candidate scaffolding or promotion.
