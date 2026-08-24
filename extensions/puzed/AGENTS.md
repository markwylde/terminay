# AGENTS — Terminay Puzed extension

- The package is a public Terminay Server extension; do not import Terminay
  server-core, Electron, renderer, or Puzed UI internals.
- Puzed API DTOs come from the generated Go-authored OpenAPI contract.
- Secrets must be supplied transiently by the host and must never be persisted,
  logged, placed in URLs, or returned in presentation objects.
- The provider may manage only machines carrying the exact `system:Terminay`
  tag. Puzed lifecycle and Terminay project lifecycle remain independent.
- Keep VM creation and its UI out of this foundation package until the
  provisioning task lands.
