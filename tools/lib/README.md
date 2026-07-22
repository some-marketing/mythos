# tools/lib — shared BYO-credential resolver (S1)

`resolve-credential.cjs` is the canonical bring-your-own-credential resolver
every tool in this tree should use instead of inventing its own. It is
distilled from `tools/dart-integration/lib/dart-api.js`'s 4-source token chain
(env → macOS Keychain → 1Password → env-file) and refined with
`tools/google-drive/config.js`'s per-field, env-overridable
`{envVar, keychainService, keychainAccount, opVault, opItem, opField}` shape,
generalized so any tool can declare its own set of fields instead of one
hardcoded secret name.

## API

```js
const {
  CredentialError,
  resolveField,
  resolveCredentials,
  resolveCredentialsFromFile
} = require('tools/lib/resolve-credential.cjs');
```

### `resolveField(field, fieldConfig, options?) -> { value, source } | null`

Resolves one credential field through the 4-source chain. `field` is the
logical name used to build error codes (`<FIELD>_MISSING` / `<FIELD>_UNRESOLVED`)
and the default environment variable name. `fieldConfig` is:

```js
{
  envVar,           // default: field
  keychainService,  // macOS Keychain -s value
  keychainAccount,  // macOS Keychain -a value
  opVault,          // 1Password vault name
  opItem,           // 1Password item title
  opField,          // 1Password field label, or an array of candidate labels
  envFileKey,       // key to look for in an env file (default: envVar)
  required          // default true; false makes a miss return null instead of throwing
}
```

`options` accepts `env`, `required`, `runSecurity` / `runCommand` (injectable
for tests), and `envFiles` (override the default candidate list). `source` on
a successful resolve is one of `'environment'`, `'macos-keychain'`,
`'onepassword'`, or `'env-file'`.

Throws a `CredentialError` (fields: `field`, `code`, `details`) when
`required` is true (the default) and every source misses. The message
includes the exact `tools/boot/keychain-store.sh <service> <account>` seed
command when Keychain fields were declared.

### `resolveCredentials(config, options?) -> { [field]: value }`

Batch form. `config` is either the on-disk `creds.config.json` shape
(`{ fields: { <field>: fieldConfig, ... } }`) or a bare field map. Fields
declared `required: false` (or named in `options.optional`) are omitted from
the result rather than throwing when unresolved.

### `resolveCredentialsFromFile(configPath, options?) -> { [field]: value }`

Reads a `creds.config.json` off disk and resolves it in one call — the form
most tools actually use:

```js
const creds = resolveCredentialsFromFile(path.join(__dirname, 'creds.config.json'));
```

## Per-tool contract

Every credential-needing tool should ship, in its own directory:

- **`creds.config.json`** — the field list, matching `creds.config.schema.json`
  in this directory.
- **`env.example`** — generated via
  `node tools/lib/generate-env-example.cjs <tool>/creds.config.json --out <tool>/env.example`.
- **`SETUP.md`** — copy `SETUP.md.template` (this directory) and fill in the
  tool name and its verify command.

## Seeding

`tools/boot/keychain-store.sh <service> <account>` is the seeding primitive
every SETUP.md points at for the Keychain source. It reads the secret with
`read -s` (never echoed to stdout/stderr/shell history), stores it via
`security add-generic-password`, then verifies by re-reading and
length-checking.

## Files

- `resolve-credential.cjs` — the resolver.
- `creds.config.schema.json` — JSON Schema for a tool's `creds.config.json`.
- `generate-env-example.cjs` — renders `env.example` from a `creds.config.json`.
- `SETUP.md.template` — copy into a tool directory and fill in.
- `__tests__/resolve-credential.test.cjs` — 12 tests covering all four sources,
  fallthrough order, multi-candidate 1Password fields, required vs. optional,
  and the CredentialError shape.
