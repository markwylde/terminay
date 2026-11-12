# ADR-0110: Publish three release tracks from `main`, with a canary that is signed but not notarized

Status: accepted, supersedes ADR-0016 and ADR-0027 in part
Date: 2026-11-11
Supersedes: ADR-0016 (decision 3's clause "a single prerelease named `main` is rebuilt on every merge to `main`" only; archives, signatures, manifest, layout and every other decision continue). ADR-0027 (decision 3, the beta channel, its version form and its metadata names, and the consequence that every merge to `main` pays for a notarization run; every other decision continues)

## Context

ADR-0016 and ADR-0027 gave Terminay two tracks: tagged stable releases, and
one rolling prerelease rebuilt on every merge to `main`, which Desktop called
Beta. Every Beta build was notarized by Apple. Apple documents a guideline of
75 notarizations a day, and a build per push does not stay inside it as the
push rate grows. People who wanted early builds also had no choice between
"every push" and "every few days".

Notarization is not part of how an update is trusted. ADR-0027 installs an
update when its digest matches the release metadata and, on macOS, when
Squirrel.Mac confirms the bundle satisfies the running app's designated code
requirement. Gatekeeper checks notarization only on quarantined files, and an
update the app downloads itself is not quarantined.

## Decision

1. Three tracks are built from `main`. **Stable** is built when a maintainer
   dispatches the release workflow. **Nightly** is built once a night and
   skipped when `main` has not moved since the last published nightly.
   **Canary** is built once per push to `main`.
2. Every macOS build on every track is signed with the Developer ID
   certificate under the hardened runtime. Stable and Nightly are also
   notarized and stapled. Canary is never submitted to Apple, and its build
   job holds no notarization credential.
3. Because an un-notarized app downloaded in a browser is blocked, no canary
   desktop payload is offered as a download. Canary is reached only by
   choosing it as the update channel in an installed Stable or Nightly build.
4. Each prerelease track has one rolling GitHub prerelease whose assets are
   replaced as a set with update metadata last: `main-latest` for Nightly and
   `canary-latest` for Canary. Nightly keeps the `main-latest` tag, the `main`
   archive names and the `main` server channel of ADR-0016, so everything that
   followed the rolling `main` channel now follows Nightly. Canary is a new
   server channel, `canary`, under the same signing and upgrade rules
   (ADR-0016, ADR-0062).
5. Prerelease versions are `<next stable version>-main.<commit count>.<track>`.
   Semantic-version precedence then orders builds by commit across tracks, and
   only for one commit by track, Nightly above Canary. Desktop never enables
   downgrades to move between tracks.
6. A Desktop on Nightly or Canary reads its own track's prerelease and the
   stable release, and takes the higher version. It never reads the other
   prerelease track.

## Consequences

- Apple sees about one notarization a day plus stable releases, whatever the
  push rate.
- A canary build has had no Apple malware scan. The Developer ID key is its
  only attestation, as it already was for the update check.
- A canary app that leaves the updater's hands (copied to another Mac, or
  downloaded by hand) is blocked by Gatekeeper. Canary cannot be a first
  install.
- Version order depends on `main` only moving forward. A history rewrite of
  `main` would produce versions that sort below published ones.
- The same commit built twice on one track has the same version, so a re-run
  is not offered to installations already on it.
- Each push publishes canary server archives and an image as well as desktop
  payloads; each night publishes the same set for Nightly.
- Stable is still a separate build of its commit. No binary is promoted from
  one track to another, because the version is compiled into the signed app.

## Open items

- For 90 days after this lands, Nightly is also published under the Beta
  feed's metadata names and the `beta` image tag, so installed Beta builds
  move to Nightly. A follow-up change removes both.
