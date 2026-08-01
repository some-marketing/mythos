# Portable launchd jobs

`services.json` is the secret-free catalog. `render-plist.cjs` resolves the
current repository root at render time, so no machine path or private service
label is tracked.

Preview a job without changing host state:

```sh
tools/launchd/install.sh framework-flywheel --dry-run
```

Installation is an operator-gated host-activation action. The installer backs
up an existing plist and writes an ignored receipt before a service can be
reported as active.
