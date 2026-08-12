# `@terminay/extension-api`

This dependency-free package is the public contract for server-side Terminay
project-environment extensions. It contains the closed v1 manifest validator,
bounded declarative presentation types, provider authoring types, and fixed
application-protocol DTOs. It does not grant privileged server access.

An extension exports `defineExtension({ activate, deactivate })`. Its
`package.json` contains a `terminay` manifest matching
`TerminayExtensionManifest`. Run `terminay-extension-conformance package.json`
before publishing to validate that manifest and its exported entrypoint.

Extensions are trusted code running with the selected Terminay Server account's
authority. The extension host provides lifecycle and crash isolation, not an OS
security sandbox.

Provider callbacks receive host-owned brokers through `ProviderCallContext`.
`profiles.get(profileId)` returns only non-secret values after provider
ownership checks. `secrets.withValue(binding, use)` resolves that provider's
exact profile/field binding in the parent, makes bytes available only inside
the child-side callback, and zeroizes the child copy afterward. Secret bytes
must never be returned or included in provider state, UI DTOs, logs, or errors.

`sshAgent.listIdentities` and `sshAgent.sign` are the only agent surface. Calls
are bound to an own-provider profile and the fixed `ssh-user-authentication`
purpose. They expose bounded public-key metadata and challenge signatures, not
an agent socket, private key, forwarding primitive, ambient environment, or UI
DTO. The host authorizes every list/sign request independently.
