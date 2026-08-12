# Permissions and trusted-code security

Extensions are trusted server-side code, not sandboxed applications. A child
process and broker permissions contain failures and make authority reviewable,
but code still has the operating-system authority of the Terminay Server
account. Install only publishers and source you trust.

| Permission | Intended use |
| --- | --- |
| `configuration:read`, `configuration:write` | Own namespaced configuration. |
| `data:read`, `data:write` | Own durable provider data and migrations. |
| `cache:write` | Disposable own cache. |
| `network` | Outbound provider/transport connections. |
| `secrets:resolve` | Resolve one own profile/field binding transiently. |
| `ssh-agent:use` | List bounded public identities and sign SSH authentication challenges. |
| `provider:depend` | Call an explicitly declared provider dependency. |
| `external-resources:manage` | Create, start, stop, or delete provider resources. |

Request the smallest set. Adding a permission in an update requires fresh user
confirmation. A manifest grant is necessary but not sufficient: the host also
checks the authenticated user, selected server, extension/profile ownership,
provider binding, operation, deadline, and cancellation state.

Never put secrets in manifests, forms returned to clients, profile values,
provider state, status/progress, error text, logs, process arguments,
environment variables, or dependency payloads. `secrets.withValue` scopes bytes
to its callback and zeroizes the transferred child copy afterward, but trusted
code could retain or exfiltrate them; permission review is therefore meaningful.

Extensions cannot receive application protocol handlers, workspace snapshots,
raw vault ids, authentication envelopes, renderer APIs, Electron APIs, host
bridges, agent sockets, or arbitrary other-extension instances. Dependency
calls require both `provider:depend` and a compatible declared extension
dependency. Provider and project identities are host-derived; reject any
payload that attempts to substitute them.
