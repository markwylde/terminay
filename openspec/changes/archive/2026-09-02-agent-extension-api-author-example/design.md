# Design

## Context

Terminay already owns the canonical agent projection, the Agents sidebar, the extension host, and the terminal observation broker. What it does not have is an author-facing surface a third party can build against. This change specifies that surface by working through one complete example package — manifest, activation, provider, discovery, mapping, and tests — and treating the resulting API as the contract.

An agent extension is an ordinary Node.js npm package. Terminay starts its entrypoint in an extension-host child process and supplies an extension context; the package registers an agent provider with that context. Terminay calls the provider when a terminal's foreground process changes. The provider may inspect that exact terminal, discover a native agent session, and publish provider-neutral lifecycle events. Terminay validates and orders those events, stores the canonical state, and renders the sidebar. The flow is: a terminal starts an agent, Terminay issues one terminal-scoped context, the extension recognises and binds the provider session, the extension publishes canonical lifecycle events, and Terminay validates, stores, sends a snapshot, and renders.

The API names in the worked example are the specification of the developer experience rather than a description of an SDK that already exists.

## Goals / Non-Goals

Goals:

- An author can write, test, and publish a provider package using only public npm dependencies and the published SDK.
- Every grant is explicit, scoped, revocable, and traceable to a manifest declaration.
- A mapping can be tested end to end without any private Terminay module on the test path.

Non-Goals:

- Changing which providers Terminay bundles, or their mappings.
- Sidebar presentation, navigation, acknowledgement, or transport, all of which stay host-owned.
- A sandbox. An extension is a trusted Node program; the boundary here is API surface and scope, not confinement.

## Decisions

**A manifest of data, and callbacks registered at activation.** The manifest declares the package's identity, engine and API ranges, platforms, permissions, and contributed provider ids with their required environment capabilities. It carries no executable value. The package default-exports an extension definition whose `activate(context)` registers the callbacks. The alternative — callbacks referenced from the manifest — was rejected because it forces the host to load and evaluate arbitrary module graphs to read a contribution list, and it makes the declared contract and the running one two different things.

**No global singleton.** Everything an extension gets arrives on the context or on a callback argument. This is what makes a grant revocable and attributable: there is nothing ambient to capture and no path by which one extension's handle becomes another's.

**Registration is checked against the manifest.** `registerProvider` accepts only an id the registering package declared. Combined with the existing namespacing rule, this means a provider id is a claim the package made publicly before it ran, not one it invented at runtime.

**Disposables plus a context subscription set.** Every registration is disposable, and adding it to the context's subscription set delegates teardown to the host for disable, update, shutdown, and host failure. Authors do not write reconnection or disablement handling, which is where hand-rolled teardown gets it wrong.

**Terminal-scoped opaque handles.** The observation context is already scoped to one terminal; making its file and process handles opaque and validating their provenance closes the remaining hole, which is an extension carrying a handle from a terminal it was legitimately given into one it was not. Canonicalisation applies the environment's path rules, so the same provider code is backed by Node filesystem operations on **This server** and by the environment's agent-journal capability over SSH.

**A semantic publisher rather than an emit call.** Named methods give authors autocomplete and give the SDK a place to validate required ids, bounds, allowed states, and metadata before anything crosses IPC. An unrestricted `emit(object)` would push all validation to the host boundary, where a rejection is far less useful to the author and the failure is a runtime one rather than a type error.

**Metadata changes are their own operation.** Title and model move independently of lifecycle state, so publishing them must not be expressible as a state transition. Making that a distinct method is what prevents a renamed session from being projected as a restarted one.

**Typed unavailability instead of thrown provider errors.** A provider that finds a missing environment capability returns a typed reason. This keeps raw SSH, filesystem, and provider errors out of the UI and lets Terminay fall back to generic terminal activity, which is the honest behaviour when authoritative observation is not possible.

**A public testing entry point.** Shipping the harness and fixtures in the same package as the types is what makes "do not import Server Core" a rule an author can actually follow, because the alternative to a public harness is reaching for internals.

### Security and architectural boundaries crossed

- The extension host boundary: extensions execute only on the selected server, never in a client host, and never import Server Core, the workspace repository, authentication contexts, client transports, Electron, or host bridges.
- The terminal-session boundary, which is a security boundary for remote access, MCP, recordings, and agent status. Handle provenance validation is what keeps that boundary intact when an extension holds contexts for several terminals at once.
- The project-environment routing boundary: Node filesystem access reaches the Terminay Server account only, and never a non-local project's machine. Making that explicit in the authoring rules prevents a provider that silently works on **This server** and silently reads the wrong host's files under SSH.
- The privacy boundary: raw provider records stay inside the extension host, and only validated canonical lifecycle facts are published. Prompt and title values are bounded at the publisher.

## Risks / Trade-offs

- A semantic publisher must grow a method for each new canonical concept, so the API version becomes a real compatibility axis → the manifest already declares an exact API range, and mapping versions are selected independently of the SDK version.
- Opaque handles mean an author cannot inspect or log a path directly from a handle → canonicalisation and bounded read helpers cover the legitimate uses, and losing ad-hoc path logging is the intended privacy outcome.
- Publishing an authoring surface makes it hard to change later → the worked example is written against a declared API range so a breaking surface change is expressed as a new major with an explicit compatibility range, not a silent shift.
- Node APIs remain available beside the observation API, so an author can still write a provider that only works on **This server** → the rule is stated in the authoring contract and the harness fixtures exercise a non-local environment, so the mistake shows up in the package's own tests.

## Open Questions

- ~~Whether the harness should also assert that a package's mapping produces no events for a fixture whose environment lacks each declared required capability, or whether that stays the author's own test.~~ **Adopted:** the public harness asserts that a mapping produces no events when a fixture is missing any declared required environment capability. A provider that still publishes is a harness failure. The example package covers the adopted check.
