# Official Puzed extension foundation

## Goal

Publish `terminay-plugin-puzed` as a separate official npm package with Platform
profiles, VM inventory/status/lifecycle, durable events/jobs, and SSH provider
composition contracts.

## Delivery phase

Phase 2 after the Extension API contract, in parallel with
[Tasks 43](./43-environment-routed-project-services.md),
[44](./44-extension-installation-and-management.md), and
[45](./45-project-environment-and-extension-ui.md).

## Dependency

- [Task 42](./42-extension-api-manifest-and-host.md)

## Governing specification

- [Puzed project environments](../features/puzed-project-environments.md)

## Parallel work streams

### Package and API client

- [ ] Scaffold/publish the separate conformant package with SSH extension
  dependency and no internal Terminay/Puzed UI imports.
- [ ] Implement HTTPS exact-origin bounded API client, vault bearer key, `/me`
  organization/scope validation, safe URL/redirect/error policy, and audit.
- [ ] Generate/use the current Go-authored OpenAPI contract without duplicating
  hand-written provider DTOs.

### Inventory and lifecycle

- [ ] Implement paginated `system:Terminay`-filtered VM inventory plus image/
  worker/bridge/settings/job discovery, capability/disabled reasons, and exact
  Open in Puzed routes; unrelated machines are never selectable.
- [ ] Share one authenticated resumable SSE stream per profile/org, process
  payload-free invalidations, refetch exact resources, and handle resync without
  polling.
- [ ] Implement idempotent start/stop/resume/reboot/delete with revisions,
  operation conflicts, disk disposition, progress, and independent management
  status.

### Existing VM binding

- [ ] Model stable Platform+machine identity, observed/static address and
  overrides, retained SSH key binding, stopped/start-and-open, provisioning
  resume, stale/deleted state, and SSH handoff test doubles.
- [ ] Reject untagged VMs and render a tagged VM with no retained private-key
  binding as non-openable rather than offering arbitrary credential adoption.

## Acceptance checks

- API keys/scopes/org validate without reaching clients/logs or crossing
  redirects.
- Only exact `system:Terminay` machines enter inventory and opening still
  requires the matching retained SSH key binding.
- Event/job/machine/address state survives client disconnect and server restart.
- Existing VM lifecycle never couples to project close or assumes SSH readiness.

## Definition of done

The public extension can manage and describe existing Puzed VMs and produces a
stable tested SSH dependency descriptor without provisioning new VMs yet.
