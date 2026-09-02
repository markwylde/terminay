## 1. Upload and inspection

- [x] 1.1 Add a bounded binary application-protocol command that uploads one `.tgz` to the selected server and returns an exact expiring preview, verified by the protocol payload, size, integrity, and replay tests
- [x] 1.2 Inspect npm-pack archive structure and manifest before confirmation, rejecting traversal, links, malformed and oversized archives, and identity drift, verified by the hostile-archive tests

## 2. Materialization and installation

- [x] 2.1 Materialize the uploaded root archive with scripts disabled while keeping all transitive dependency resolution integrity-pinned to public npmjs, verified by the installer dependency-resolution tests
- [x] 2.2 Bind install and update confirmation to archive integrity, clean staging on success, failure, and restart, and keep active-slot rollback semantics unchanged, verified by the transactional failure tests

## 3. Settings surface

- [x] 3.1 Present **Install package file…** in Extensions Settings for Desktop and browser, including uploaded and unverified source facts and useful errors, verified by the Settings UI behaviour tests

## 4. Verification

- [x] 4.1 Cover permission, payload, size, integrity, replay, hostile archive, transactional failure, client parsing, and Settings UI behaviour, verified by the focused test suites
- [x] 4.2 Run focused builds and unit tests plus Electron acceptance through Docker, verified by those runs passing
