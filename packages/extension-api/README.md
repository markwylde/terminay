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
