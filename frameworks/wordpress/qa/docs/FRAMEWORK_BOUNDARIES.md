# Framework Boundaries

This document defines the clear separation between **framework code** (reusable infrastructure) and **project content** (test definitions and artifacts specific to a site/client).

---

## What Belongs in `/framework/`

The framework directory contains **reusable, project-agnostic code**:

| Directory | Purpose |
|-----------|---------|
| `/framework/runner/` | Core test execution engine, CLI, and utilities |
| `/framework/runner/engine/` | Modular runner components (steps, collectors, I/O) |
| `/framework/runner/lib/` | Shared utilities (project layout resolver, file helpers) |
| `/framework/runner/commands/` | CLI command implementations |
| `/framework/runner/adapters/` | Compatibility adapters for different testcase formats |
| `/framework/schemas/` | JSON schemas for testcases, run metadata, etc. |
| `/framework/prompts/` | Canonical LLM prompts for analysis workflows |
| `/framework/docs/` | Framework documentation |
| `/framework/examples/` | Minimal examples (no real client data) |

### Framework Code Characteristics
- **No hardcoded URLs, credentials, or client names**
- **Site-agnostic**: Works with any target site via configuration
- **Testcase-agnostic**: Doesn't assume specific form fields or flows
- **Version-controlled**: Framework releases should be tagged

---

## What Belongs in a Project Repository

A project repository uses the framework to test a specific site. Projects contain:

| Directory | Purpose |
|-----------|---------|
| `/playwright_phased_runner/testcases/` | Test definitions (testcase.json, identity.json, locator_map.json) |
| `/config/` | Project-specific configuration (site URLs, timeouts, etc.) |
| `/auth_states/` | Browser storage states for authenticated flows |
| `/artifacts/` | **Generated** - run outputs, reports, derived data |
| `/exports/` | Backend exports for comparison (CRM dumps, form exports) |

### Project Content Characteristics
- **Site-specific**: URLs, selectors, expected values for one site
- **May contain sensitive data**: Auth states, test credentials, PII
- **Testcase definitions are immutable** once created (create new versions instead)

---

## What is "Generated Output"

Generated output should **never be committed** (add to `.gitignore`):

| Output Type | Location | Description |
|-------------|----------|-------------|
| Run artifacts | `**/runs/` | Per-environment evidence (screenshots, cookies, network, DOM) |
| Derived data | `**/derived/` | Extracted signals, compiled summaries |
| Reports | `**/reports/` | Generated analysis reports |
| Artifacts | `**/artifacts/` | All generated outputs in template_project layout |
| Dev handoffs | `**/dev_handoff/`, `**/HANDOFF_*/` | Packaged bundles for developers |
| Failure reports | `**/failure_reports/` | Failure analysis outputs |

### Why Not Commit Generated Output?
1. **Size**: Screenshots, HAR files, traces can be gigabytes
2. **Reproducibility**: Should be regenerable from testcase + framework
3. **Sensitivity**: May contain PII from form submissions
4. **Noise**: Pollutes git history with binary changes

---

## Project Layout Styles

The framework supports two project layouts:

### Legacy Layout (Current Repo Structure)
```
project_root/
├── framework/                # Canonical prompts + docs
├── playwright_phased_runner/
│   ├── runner/           # Framework code (legacy location)
│   ├── testcases/        # Test definitions
│   ├── auth_states/      # Auth storage
│   └── reports/          # Generated
└── docs/                 # Deprecated stubs
```

### Template Project Layout (Recommended)
```
project_root/
├── testcases/            # Test definitions only (template layout)
│   └── my_test/
│       ├── testcase.json
│       ├── identity.json
│       ├── locator_map.json
│       └── EXPECTED_OUTCOMES.md
├── config/
│   └── project.json      # Site URLs, timeouts, defaults
├── auth_states/          # Browser storage for auth
├── exports/              # Backend exports for comparison
└── artifacts/            # All generated outputs (gitignored)
    ├── runs/
    ├── reports/
    └── derived/
```

The framework auto-detects which layout is in use via `/framework/runner/lib/project-layout.js`.

---

## How to Upgrade Framework Versions

### If Framework is a Submodule
```bash
cd framework
git fetch origin
git checkout v2.0.0
cd ..
git add framework
git commit -m "Upgrade framework to v2.0.0"
```

### If Framework is Copied
1. Download new framework release
2. Replace `/framework/` directory entirely
3. Run `node framework/runner/cli.js validate --project-root .` to check compatibility
4. Update project configs if schema changed

### Breaking Changes Policy
- Major versions (v2.x) may require testcase schema updates
- Minor versions (v1.x) maintain backward compatibility
- The `legacy-phased` adapter ensures old testcases continue working

---

## Migration Checklist: Legacy → Template Project

1. **Create new project structure**
   ```bash
   mkdir -p my_project/{testcases,config,auth_states,exports,artifacts}
   ```

2. **Copy testcases** (preserve exactly)
   ```bash
   cp -r old_project/playwright_phased_runner/testcases/* my_project/testcases/
   ```

3. **Create project config** from legacy defaults
   ```bash
   # Extract site-specific config from runner/config/defaults.json
   ```

4. **Copy auth states** if needed
   ```bash
   cp -r old_project/playwright_phased_runner/auth_states/* my_project/auth_states/
   ```

5. **Update .gitignore** using framework template

6. **Test with framework CLI**
   ```bash
   node /path/to/framework/runner/cli.js validate --project-root my_project
   node /path/to/framework/runner/cli.js run --project-root my_project --testcase my_test
   ```

---

## Summary Table

| Item | Framework | Project | Generated |
|------|-----------|---------|-----------|
| Runner code | ✓ | | |
| CLI tools | ✓ | | |
| JSON schemas | ✓ | | |
| Canonical prompts | ✓ | | |
| Testcase definitions | | ✓ | |
| Locator maps | | ✓ | |
| Identity files | | ✓ | |
| Site config | | ✓ | |
| Auth states | | ✓ | |
| Backend exports | | ✓ | |
| Run artifacts | | | ✓ |
| Reports | | | ✓ |
| Derived data | | | ✓ |
