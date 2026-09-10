# Example Agent provider

This package is the reference for authoring a Terminay agent extension. Copy
its shape; do not import Server Core, Electron, or any other private Terminay
module.

## Package shape

1. A `terminay` manifest in `package.json` declaring the extension id, the
   `agent-observation` permission, and its contributed provider ids. The
   manifest is data only.
2. A default export from `defineExtension({ activate(context) { ... } })`.
   There is no global Terminay singleton. Every grant arrives on `context` or
   a callback argument.
3. `context.agents.registerProvider` under an id the manifest declared, added
   to `context.subscriptions` so disable, update, shutdown, and host failure
   dispose it.
4. `defineAgentProvider` with `matchesForeground` and `observe`. A match only
   starts a bounded observation attempt. Binding happens from evidence on the
   issued terminal context.
5. Canonical lifecycle events published through named methods on
   `session.publish`. There is no unrestricted `emit`/`publish(event)` path.
6. Tests through `@terminay/extension-api/testing`.

## Node APIs versus observation

Node filesystem and process APIs reach the Terminay Server account only. Use
them for ordinary package work (preferences, caches). Terminal identity
evidence — descendants, open files, journals, canonical paths, JSON/JSONL
reads, follow — must go through `terminal.observation`. That broker is scoped
to the exact terminal, so a handle from one terminal is never valid in another.
A provider that reads journals with `node:fs` reads whatever the server account
happens to see rather than what the terminal proved.

## Honest fallback

When the evidence does not identify a session, return a typed outcome —
`{ state: "not-bound" }`, or `{ state: "unavailable", reason }` with one of the
public reasons. Do not throw a raw filesystem or provider error. Terminay keeps
generic terminal activity for that session.

## Tests

```js
import { createAgentExtensionHarness, fixtureTerminal } from "@terminay/extension-api/testing";
import extension from "./extension.js";
```

The harness checks manifest/registration agreement, bounds, cancellation,
session scope, lifecycle validity, and privacy exclusions.
