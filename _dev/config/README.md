# `config/`

Schemas for configuration this workshop expects you to populate yourself. Plain gloss:
this directory ships empty of real values on purpose — it's the shape of a config file,
not a config file with your hosts, keys, or credentials already in it.

- `remote-hosts.schema.json` — validates a `remote-hosts.json` you create alongside it,
  describing SSH-accessible remote inference hosts for a remote-ssh dispatch target.
  Nothing here is pre-filled; copy the schema's shape into your own populated file and
  keep that file out of anything you commit publicly if it names real hosts.
