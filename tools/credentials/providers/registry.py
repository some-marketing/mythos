"""
Provider registry.

Add a new provider by importing it here and adding to ALL_PROVIDERS. The
resolver then auto-detects availability and uses the operator's configured
order from ~/.Mythos/credentials.config.yaml (or auto-detection if no config).

Stubs documented at the bottom for providers not yet implemented:
  - bitwarden (bw CLI)
  - vaultwarden (compatible with bw CLI)
  - keepassxc (keepassxc-cli)
  - pass (GNU pass / unix password store)
  - apple_passwords (newer Apple Passwords app, via security CLI subset)
  - lastpass (lpass CLI — deprecated but extant)
  - dashlane (dcli)
  - aws_secrets_manager (aws CLI)
  - gcp_secret_manager (gcloud CLI)
"""

from .base import CredentialProvider
from .onepassword import OnePasswordProvider
from .keychain import KeychainProvider
from .env_file import EnvFileProvider

# Order here is the default fallback when operator config doesn't specify.
# Operator config in ~/.Mythos/credentials.config.yaml overrides.
ALL_PROVIDERS: list[type[CredentialProvider]] = [
    OnePasswordProvider,
    KeychainProvider,
    EnvFileProvider,
]


def instantiate_all() -> list[CredentialProvider]:
    return [P() for P in ALL_PROVIDERS]
