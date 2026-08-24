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
