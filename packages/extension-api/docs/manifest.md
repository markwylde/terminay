# Manifest reference (v1)

`package.json.terminay` is closed: unknown fields fail installation. One npm
package owns one immutable extension id.

| Field | Contract |
| --- | --- |
| `manifestVersion` | Integer `1`. |
| `id` | Globally unique reverse-DNS identity; never change it after release. |
| `displayName`, `description` | Bounded plain text. |
| `api` | supported Terminay Extension API SemVer range. |
| `engines.terminay`, `engines.node` | supported product and bundled Node ranges. |
| `entrypoint` | Relative regular ESM file inside the packed package. No traversal or symlink. |
| `platforms` | Optional subset of `darwin`, `linux`, `win32`. Omit for portable packages. |
| `permissions` | Exact visible capabilities requested from the host. |
| `extensionDependencies` | Other Terminay extension ids and compatible API ranges, not npm libraries. |
| `contributes.projectEnvironments` | Optional array of namespaced project-environment provider identities, plain metadata, icons, capabilities, and optional profile-save behaviour. |
| `contributes.agentProviders` | Optional array of namespaced agent provider identities, plain metadata, icons, and required environment observation capabilities. |

At least one of `projectEnvironments` or `agentProviders` must contain a
contribution. Provider ids use `<extension-id>/<local-id>`. Action, form, field,
option-source, and operation ids follow the same ownership rule where
applicable. Package name and extension id are deliberately independent.

## Profile-save behaviour

Saving a provider profile has no environment-creation side effect unless its
project-environment contribution explicitly contains
`"profileSave": { "createEnvironment": true }`. The literal `true` is
required; omitted, false, malformed, or unknown settings fail closed to the
no-side-effect default. The server honours this only for the matching provider
that registered in the current activation. Providers that need create-form
values must omit it and wait for an explicit create-environment action.

An agent provider contribution uses this shape:

```json
{
  "id": "com.example.agent/cli",
  "displayName": "Example Agent",
  "icon": "terminal",
  "requiredEnvironmentCapabilities": [
    "process-observation",
    "agent-journal"
  ]
}
```

Every agent-provider extension must request `agent-observation`. Required
environment capabilities are an admission requirement, not an extra grant: if
the selected terminal environment cannot provide them, Terminay does not start
that provider's observation attempt. The contribution is declarative; runtime
callbacks are registered only by the package entrypoint.

## Provider dependency targets

A project-environment provider can expose an explicit public allowlist for
compatible extension dependencies. Add `dependencyOperations` to its manifest
contribution; each entry contains one bounded, dot-separated provider-owned
name. These names are API operations, not shell commands or module paths.

```json
{
  "id": "com.example.storage/cache",
  "displayName": "Example Cache",
  "capabilities": ["filesystem"],
  "dependencyOperations": [
    { "name": "resource.read" },
    { "name": "resource.update" }
  ]
}
```

The list must be non-empty when present, contain unique names, and has a maximum
of 32 operations. It does not grant access on its own: the calling extension
also declares the compatible extension dependency and requests
`provider:depend`. The host authenticates the caller and authorizes the target
provider and operation before it invokes extension code.

The three version axes are independent: npm package SemVer describes that
package release, `manifestVersion` describes this JSON schema, and `api`
describes the host contract. API majors may break; minors are additive. The
server fails closed when ranges do not overlap and leaves dependent projects
visible but unavailable.

The package must contain an exact dependency lock and a production closure that
needs no lifecycle scripts, compiler, native `.node` module, `binding.gyp`, Git,
file, link, alias, or remote URL dependency. The public npmjs registry is the
only v1 installation source.
