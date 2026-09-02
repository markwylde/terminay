## 1. Package and API client

- [x] 1.1 Scaffold and publish the separate conformant package with an SSH extension dependency and no internal Terminay or Puzed UI imports, verified by the package's dependency and import checks
- [x] 1.2 Implement an HTTPS exact-origin bounded API client with a vault bearer key, `/me` organization and scope validation, safe URL/redirect/error policy, and auditing
- [x] 1.3 Generate and use the current Go-authored OpenAPI contract without duplicating hand-written provider DTOs

## 2. Inventory and lifecycle

- [x] 2.1 Implement paginated `system:Terminay`-filtered VM inventory plus image, worker, bridge, settings, and job discovery, capability and disabled reasons, and exact Open in Puzed routes, verified by unrelated machines never being selectable
- [x] 2.2 Share one authenticated resumable SSE stream per profile organization, process payload-free invalidations, refetch exact resources, and handle resync without polling
- [x] 2.3 Implement idempotent start, stop, resume, reboot, and delete with revisions, operation conflicts, disk disposition, progress, and independent management status

## 3. Existing VM binding

- [x] 3.1 Model stable Platform and machine identity, observed and static address with overrides, retained SSH key binding, stopped start-and-open, provisioning resume, stale and deleted state, and SSH handoff test doubles
- [x] 3.2 Reject untagged VMs and render a tagged VM with no retained private-key binding as non-openable rather than offering arbitrary credential adoption

## 4. Acceptance checks

- [x] 4.1 Verify API keys, scopes, and organizations validate without reaching clients or logs and without crossing redirects
- [x] 4.2 Verify only exact `system:Terminay` machines enter inventory and that opening still requires the matching retained SSH key binding
- [x] 4.3 Verify event, job, machine, and address state survives client disconnect and server restart
- [x] 4.4 Verify existing VM lifecycle never couples to project close and never assumes SSH readiness
