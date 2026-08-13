# Publishing an extension

Maintain each official extension in its own repository. Pin Node/npm to the
supported versions, commit the dependency lock, protect the release environment,
and use npm trusted publishing (OIDC) with provenance. Do not store a long-lived
npm token when trusted publishing is available.

Copy `templates/official-extension-release.yml` to
`.github/workflows/official-extension-release.yml` in the extension repository
and configure npm's trusted publisher for that exact repository and workflow
filename. The repository must be public and `package.json.repository.url` must
case-sensitively match it. The job
builds and tests, runs conformance, emits release evidence/SBOM/licenses, packs
twice to prove byte reproducibility, publishes with provenance, then verifies
the registry's exact version and compares its integrity with the locally
verified tarball. Upload evidence and the tarball as
immutable CI artifacts even when publication fails.

The workflow requires `@terminay/extension-api` as a normal, registry-resolved,
exactly locked development dependency. `npx --no-install` deliberately prevents
a release job from downloading an undeclared conformance CLI. Do not commit a
`file:`, Git, URL, or sibling-worktree dependency in an independently released
extension.

## First-release bootstrap

npm only allows a trusted publisher to be configured after the package name
already exists. Reserve each new package with a minimal reviewed bootstrap
version using an interactive maintainer account with 2FA, then configure the
trusted publisher before publishing the real release. The bootstrap tarball
must use the intended public repository metadata and must not contain extension
runtime code. Deprecate it after the first trusted release; do not reuse or
unpublish a version because npm versions are immutable.

Publish in dependency order:

1. Reserve and publish `@terminay/extension-api`, configure its trusted
   publisher, then publish the reviewed API version through CI.
2. Replace every extension's temporary local API dependency with that exact
   npm version and regenerate the lockfile from a fresh independent checkout.
3. Reserve `terminay-plugin-ssh` and `terminay-plugin-puzed`, configure each
   repository's trusted publisher for
   `official-extension-release.yml` with `npm publish` permission, and run the
   workflow once with `publish: false`.
4. Review the uploaded evidence, then rerun the same immutable commit with
   `publish: true`. Verify registry integrity and attestations from the uploaded
   `npm-registry-proof.json`.

Trusted publication runs only on a GitHub-hosted runner with `id-token: write`,
Node 24.15.0, and npm 12.0.2. No `NODE_AUTH_TOKEN` is supplied to the publish
step. A local npm credential is not a substitute for OIDC and must never be
copied into repository secrets.

After the package names and public repository paths exist, a 2FA-authenticated
maintainer configures the three trust relationships explicitly (substitute the
actual case-sensitive repository paths):

```sh
npm install --global npm@12.0.2
npm trust github @terminay/extension-api --file official-extension-release.yml --repo OWNER/EXTENSION-API-REPOSITORY --allow-publish
npm trust github terminay-plugin-ssh --file official-extension-release.yml --repo OWNER/SSH-REPOSITORY --allow-publish
npm trust github terminay-plugin-puzed --file official-extension-release.yml --repo OWNER/PUZED-REPOSITORY --allow-publish
```

Do not add `--yes` to the trust commands: the maintainer must see and complete
the 2FA/browser confirmation. From each repository, request the evidence-only
run and then the reviewed publication run with:

```sh
gh workflow run official-extension-release.yml --ref EXACT_COMMIT_OR_TAG -f publish=false
gh workflow run official-extension-release.yml --ref EXACT_COMMIT_OR_TAG -f publish=true
```

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
