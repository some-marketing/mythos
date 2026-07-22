# Runtime Packs

This directory contains **runnable project assets** that the `wordpress/qa` framework expects to exist in a client project workspace.

## workspace_pack/

Provides a minimal `framework/runner/` CLI that delegates to the legacy Playwright runner tools under:

- `playwright_phased_runner/runner/tools/*`

The Playwright runner itself is sourced from `frameworks/wordpress/qa/runner/` and installed into projects by `tools/workspace/scaffold-project.js`.

