# Bot agent author example

This is a description-only example for API 3.6. This describes a native Codex driver; no package is installed and no agent is started by these files.

Declare pinned public CLI packages, `runtimeProtocol: "native-cli-v1"`, a supported `nativeDriver`, its exact `runtimeVersion`, credential
metadata, fixed config files and non-secret launch environment in `package.json`.
An optional `deviceSignIn` declares both `command` and `signOutCommand`, a label,
help, and optional `configFiles` that override defaults at matching paths.
Config paths are relative to `/home/bot`, contain no `..`, and cannot use
`memories` or the reserved `.terminay` directory. Terminay writes device config
before sign-in and each device session; token sessions use the defaults.

Register the declared id with `context.agents.registerBotAgent`. Models are
cached per activation (64 maximum). Status is `ready` or `not_signed_in` with
bounded detail. Launch receives only `{ modelId }`, where `null` means Default,
and returns an empty argument list and bounded non-secret environment; the host assembles native CLI/model arguments.
Observe each signal and dispose the registration during deactivation.

Terminay owns image builds, containers, processes, native protocols, permissions, sessions,
transcripts, UI, and credential injection. An extension receives no bot record,
container handle, prompt, transcript or bot credential. `agent-bots` grants no
vault access. The host injects credentials only into its private container-exec environment, never process arguments; that exception grants no extension access.

Run the SDK's `test/bot-agent-example.test.mjs` for manifest and runtime
conformance with no engine, network or credentials.
