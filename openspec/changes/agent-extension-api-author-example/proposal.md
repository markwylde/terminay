## Why

A developer who wants Terminay to show their coding agent's sessions has no worked example of what the package they must write looks like, and the pieces that do exist are described only as host-side guarantees. Without a concrete author-facing surface, third-party providers either cannot be written at all or are written against private Terminay modules, which is exactly what the extension boundary exists to prevent.

## What Changes

- Publish the agent-provider authoring surface of `@terminay/extension-api` as a worked example package: manifest, activation entry, provider definition, session discovery, record mapping, and tests.
- Define the SDK entry shape: a default-exported extension definition with an `activate(context)` callback, where everything Terminay grants arrives through `context` or a callback argument and there is no global Terminay singleton.
- Bind runtime registration to the manifest: an agent provider may be registered only under an id the package's manifest declares, and every registration is disposable and disposed automatically through the extension's subscription set on disable, update, shutdown, or extension-host failure.
- Define the provider callbacks: a foreground-process match that starts a bounded observation attempt without itself proving ownership, and an observation callback scoped to one exact terminal and one process incarnation.
- Make terminal-scoped handles opaque and non-transferable, so a file or process handle issued for one terminal context cannot be used with another and the host validates the provenance of every referenced handle.
- Replace an unrestricted event emitter with a semantic publisher whose methods validate required ids, bounds, allowed states, and metadata before crossing IPC.
- Define metadata-only updates that change title and model without synthesising a new session or turn or disturbing working, waiting, done, or active-tool state.
- Define a typed unavailable outcome for an environment missing a required observation capability, so a provider returns a safe reason instead of throwing a raw SSH, filesystem, or provider error into the UI.
- Ship a public conformance test harness at `@terminay/extension-api/testing` so a package can test its complete mapping without importing Server Core.
- Draw the authoring boundary between Node APIs used for ordinary work on the Terminay Server account and the observation API required for terminal-scoped, environment-routed evidence.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `extension-platform`: adds the author-facing SDK entry, manifest-bound disposable registration, opaque terminal-scoped handles, the Node-versus-observation authoring boundary, cancellation and disposal guarantees, and the public conformance harness.
- `agent-status-and-sidebar`: adds the semantic lifecycle publisher, metadata-only updates, subagent identity requirements, and the typed unavailable outcome for agent providers.

## Impact

- The `@terminay/extension-api` package: the agent-provider types, runtime schemas, definition helpers, and the `testing` entry point.
- The extension host's provider registry and subscription disposal.
- The terminal observation broker's handle issuance and validation.
- The canonical agent projection's event validation at the IPC boundary.
- Author documentation, which the example package doubles as.
