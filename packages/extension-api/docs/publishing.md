# Publishing an extension

Maintain each official extension in its own repository. Pin Node/npm to the
supported versions, commit the dependency lock, protect the release environment,
and use npm trusted publishing (OIDC) with provenance. Do not store a long-lived
npm token when trusted publishing is available.

Copy `templates/official-extension-release.yml` into the extension repository
and configure npm's trusted publisher for that repository/workflow. The job
builds and tests, runs conformance, emits release evidence/SBOM/licenses, packs
twice to prove byte reproducibility, publishes with provenance, then verifies
the registry's exact version and compares its integrity with the locally
verified tarball. Upload evidence and the tarball as
immutable CI artifacts even when publication fails.

Release review must confirm:

- exact Node, npm, Extension API and Terminay compatibility;
- dependency lock and production-only closure;
- packed file inventory and reproducible SHA-256;
- no lifecycle/native/build dependency;
- SPDX SBOM and third-party license inventory;
- requested permissions and changes from the previous release;
- npm provenance and registry `dist.integrity`/tarball for the exact version;
- clean-server installation and packed activation; and
- actionable behavior when npmjs is unavailable.

The official badge is hardcoded Terminay catalogue metadata. It does not grant
extra runtime authority and is not inferred from an npm name. Custom packages
use the same manifest, installer, host, and compatibility checks.
