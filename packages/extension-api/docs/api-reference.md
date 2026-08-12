# Extension API v1 reference

Import only from `@terminay/extension-api`. The package's generated TypeScript
declarations are canonical; this page explains the callable surface and
lifecycle. JSON values are null, booleans, finite numbers, strings, arrays, or
plain string-keyed objects. Executable values and unknown DTO fields fail host
validation.

## Extension entrypoint

`defineExtension(TerminayExtension)` preserves types and returns the extension.
`activate(context)` registers contributions; optional `deactivate()` releases
resources. `ExtensionContext` exposes the immutable `extensionId`, negotiated
`apiVersion`, own configuration/data/cache paths, and
`registerProjectEnvironmentProvider`.

Registration contains a declarative `ProviderDefinition` and a `ProviderRuntime`.
The definition's id, display metadata, icon, capabilities, `profileForm`, and
`createForm` must agree with the manifest contribution.

## Runtime callbacks

| Method | Purpose | Result |
| --- | --- | --- |
| `testProfile` | Validate non-secret values and brokered connectivity. | `ValidationIssue[]` |
| `resolveOptions` | Bounded async options for a declared source. | `OptionSourceResult` |
| `createEnvironment` | Create/bind an environment id assigned by the host. | `ProvisioningResult` |
| `resumeOperation` | Resume/poll durable pending work. | `ProvisioningResult` |
| `getStatus` | Read current environment status. | `ProviderEnvironmentStatus` |
| `invokeAction` | Run one declared lifecycle action. | `EnvironmentActionResult` |
| `updateEnvironment` | Optional revision-aware update. | `EnvironmentActionResult` |
| `deleteEnvironment` | Optional explicit provider deletion. | `EnvironmentActionResult` |
| `invokeService` | Optional environment-bound capability operation. | Operation-specific JSON DTO |

Every call receives `ProviderCallContext`: absolute `deadlineAt`, cancellation
`signal`, optional mutation `idempotencyKey` and `expectedRevision`, and the
brokers below. Call `signal.throwIfAborted()` before and after awaited external
work; do not begin work that cannot finish before the deadline.

## Brokers

- `profiles.get(profileId)` returns an own-provider `ProviderProfileSnapshot`
  containing non-secret JSON values, secret field names, and revision.
- `secrets.withValue({profileId, fieldId, purpose}, callback)` resolves one
  exact own binding for the callback lifetime.
- `sshAgent.listIdentities` and `sshAgent.sign` expose bounded public identity
  metadata and one SSH user-authentication signature. They never expose a
  socket or private key.
- `dependencies.call` invokes one compatible manifest-declared provider with a
  bounded operation/payload/deadline. The host authorizes and routes it.

Broker availability is constrained by manifest permission. Calls do not confer
ownership of ids embedded in their payloads.

## Results and state

Creation/resume returns `ready` with provider state and status, or `pending`
with an operation id, stable progress stages, resumable provider state, and an
optional bounded poll delay. Actions similarly return `complete` or `pending`.
Status has an availability state, safe message/default root/card/progress, and
monotonic revision.

Provider state must contain only the minimum redacted restart information.
Profiles, environments, projects, operations, and secret references remain
host-owned records. A provider cannot retarget their identity.

## Declarative presentation

`DeclarativeForm` contains bounded sections and fields: text, URL, secret,
textarea, number, checkbox, switch, select, and preset cards. Conditions compare
one primitive field value. Option sources return plain options plus an opaque
cursor. Status cards contain safe facts/actions and optionally a credential-free
HTTPS link. Confirmations bind a kind, label, and expected revision. Progress
contains stable ordered stages and a resumable flag. Icons are selected from
the Terminay-owned `ExtensionIcon` union.

Use the exported runtime validators and fixtures in tests. The host applies the
same closed validators at manifest, activation, and callback IPC boundaries.
