## 1. SDK entry and registration

- [x] 1.1 Add the extension definition helper and the `activate(context)` entry contract to `@terminay/extension-api`; verify a package that default-exports a definition activates and one that reaches for a global fails to compile
- [x] 1.2 Reject provider registration under an id the registering package's manifest does not declare; verify with a package registering a declared id and one registering an undeclared id
- [x] 1.3 Return a disposable registration and dispose the context subscription set on disable, update, shutdown, and extension-host failure; verify each of the four paths releases the registration

## 2. Agent provider callbacks

- [x] 2.1 Add the agent provider definition helper with a foreground-match callback taking bounded safe process metadata and an observation callback taking a terminal context; verify a match starts a bounded observation attempt and establishes no binding by itself
- [x] 2.2 Scope each observation context to one terminal and one process incarnation, with a cancellation signal firing on process exit, terminal close, environment change, and extension disable; verify each trigger cancels an in-flight call
- [x] 2.3 Return typed outcomes from observation, including not-bound and unavailable with a safe reason; verify a missing environment capability produces the typed outcome and no raw provider error reaches the UI

## 3. Terminal observation surface

- [x] 3.1 Issue opaque file and process handles from the terminal observation context and validate handle provenance on every call; verify a handle from one terminal context is refused by another
- [x] 3.2 Implement descendants, open-file, canonicalisation, bounded JSON and JSONL reads, and follow through the environment-routed broker; verify each is backed by the server host on **This server** and the advertised capability on SSH
- [x] 3.3 Make watchers asynchronously disposable and idempotent to close; verify a double close raises nothing and a cancelled signal stops the iteration

## 4. Canonical publisher

- [x] 4.1 Replace unrestricted emission with named publisher methods for session start, turn start, tool start, wait start, completion, metadata change, and subagent start and completion; verify no unrestricted emit path exists
- [x] 4.2 Validate required ids, bounds, allowed states, and metadata at the publisher before IPC; verify each rejection happens in the extension host rather than at the canonical store
- [x] 4.3 Make metadata changes preserve working, waiting, done, and active-tool state and create no session or turn; verify with a metadata change published mid-turn with an active tool
- [x] 4.4 Require a stable native child identity for subagent publication and authoritative evidence for subagent completion; verify a child with no stable id is not published

## 5. Authoring boundary

- [x] 5.1 Document and enforce that Node APIs serve ordinary Terminay Server work while environment-routed evidence uses the observation API; verify a fixture with a non-local environment fails a provider that used Node filesystem access for evidence
- [x] 5.2 Confirm the API exposes no means of implementing host-owned behaviour — sidebar rendering, navigation, client subscriptions, transport, acknowledgement, canonical ordering, enable and disable surfaces, process lifetime, or packaging; verify by type surface review

## 6. Public conformance harness

- [x] 6.1 Publish the `@terminay/extension-api/testing` entry point with an extension harness and terminal fixtures; verify a package can drive its mapping and assert canonical events with no private Terminay module on the test path
- [x] 6.2 Have the harness check manifest and registration agreement, bounds, cancellation, session scope, lifecycle validity, and privacy exclusions; verify a deliberately non-conforming fixture package fails each check

## 7. Worked example package

- [x] 7.1 Publish the example provider package — manifest, activation entry, provider, discovery, mapping, and tests — as the reference authoring documentation; verify it builds and its tests pass against the published SDK with no private imports
- [x] 7.2 Resolve whether the harness asserts a package produces no events for a fixture missing each declared required capability; verify the decision is recorded and, if adopted, covered by the example package's tests
