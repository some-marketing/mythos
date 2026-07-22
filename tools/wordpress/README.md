# tools/wordpress

Two independent, credential-agnostic WordPress automation scripts.

## `wpcodebox-dump-snippets.js`

Read-only WPCodeBox 2 snippet auditor. Logs into a WordPress admin (via 1Password-resolved credentials — the password never passes through argv or process output) and pulls the full snippet list through WPCodeBox's own local AJAX route. WPCodeBox stores snippet bodies server-side with no public REST namespace, so a string search inside a snippet is otherwise invisible to `grep` over a repo or an anonymous HTTP probe. This is the sanctioned authenticated read path for finding which snippet contains a given string (e.g. an attribution or tracking value) without exporting through the UI by hand.

**Read-only by construction** — the only endpoint it ever calls is the GET snippets-list route. It never POSTs/PUTs/DELETEs and never touches a write route.

```bash
# Ad-hoc site, no registration needed:
node tools/wordpress/wpcodebox-dump-snippets.js \
  --base-url https://your-site.example --op-item "Your Site WP Admin" --op-vault Personal --grep utm_source

# Or register a site once in the SITES map at the top of the file, then:
node tools/wordpress/wpcodebox-dump-snippets.js --site my-site --grep organic_paid
```

Requires the `op` 1Password CLI signed in (`op whoami`) with access to the named vault.

## `wpforms-entries-export.js`

Downloads WPForms entries via the WP REST API (`/wp-json/wpforms/v1/forms/<id>/entries`, WPForms Pro/Elite only) and writes them as CSV or a redacted JSON envelope. Built for QA/attribution-testing workflows: it **requires** a QA filter (`--email-exact`, `--test-event-code`, or `--identity-file`) so a run can never accidentally dump an entire form's live customer entries — it's scoped to entries matching a known test identity.

PII handling is opinionated and hard-coded: fields whose label/key match phone, address, postal, SIN, DOB, or free-text patterns are always dropped, even in `--include-evidence-mode`; cross-run correlation is done via a per-run ephemeral salt + SHA-256 hash that's never persisted.

```bash
node tools/wordpress/wpforms-entries-export.js \
  --site https://your-site.example \
  --user your-wp-username \
  --pass-file /path/to/app-password-file \
  --form-id 88775 \
  --run-id run_0014 \
  --email-exact qa+form61@example.com \
  --output-dir /path/to/runs/run_0014
```

Auth is a WordPress application password, loaded from a file path (never passed as an argv value) via `--pass-file`. Run `--help` for the full option list.
