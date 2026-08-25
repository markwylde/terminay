# terminay-plugin-puzed

Official Puzed Platform project-environment provider for Terminay Server.

The foundation release validates Platform profiles, discovers only machines
tagged exactly `system:Terminay`, follows durable jobs and resumable events,
performs explicit VM lifecycle actions, and produces a public SSH-provider
dependency descriptor for retained Terminay VM keys. It does not adopt
arbitrary VMs or create new VMs yet.

The API key is resolved transiently from the Terminay Server vault. It must not
be supplied through package configuration, environment variables, or client
messages.

## Development

The checked-in `src/generated/openapi.d.ts` is generated from Puzed Platform's
Go-authored OpenAPI document. It is the build input, so normal Terminay builds
do not need access to the Puzed source repository. To refresh it after
regenerating that contract, provide its path explicitly:

```sh
PUZED_OPENAPI_TYPES_SOURCE=/path/to/openapi.d.ts npm run refresh-openapi
```

```sh
npm test
```

## Install, compatibility, and troubleshooting

Puzed ships built in, installed offline and enabled by default. Disable or
re-enable it in **Extensions** settings without deleting profiles, vault
bindings, jobs, or VMs; a compatible npm release may override the bundled
floor. Create an environment, save its API key through Terminay's secret field,
select a machine tagged exactly `system:Terminay`, and use its lifecycle
actions. SSH is called only through its public provider dependency.

Only the transient vault callback sees API-key bytes. This release manages
existing tagged VMs and uses SSH for transport. It requires Extension API 1.1,
Node.js 22+, and compatible SSH/OpenAPI contracts. Empty inventory usually
means the account, key, or exact tag is wrong. Retry stuck work by durable
operation id. Tests mock Platform traffic; there is no default real-cloud smoke
because lifecycle actions can affect billable VMs.
