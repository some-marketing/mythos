# familiar

A tiny launcher for a personal AI-companion CLI. It doesn't contain the
companion itself — it just resolves a path to your companion CLI's entrypoint
and execs it with Node, forwarding all arguments.

## Usage

```
./familiar [args...]
```

## Configuring the companion CLI

Set `FAMILIAR_CLI_PATH` to the absolute path of your companion CLI's JS
entrypoint:

```
export FAMILIAR_CLI_PATH="/path/to/your/companion-cli/bin/familiar.js"
```

If unset, the launcher falls back to `~/.mythos/familiar-cli/bin/familiar.js`.
If neither exists, it exits with an error explaining how to configure one.

This launcher is intentionally bring-your-own: the actual companion CLI
(conversation handling, memory, personality, etc.) is a separate project you
supply.
