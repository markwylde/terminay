# Task 20 dependency and native supply-chain audit

Date: 2026-07-27

## Executed JavaScript dependency audit

The repository-local audit is deterministic and does not mutate package
manifests or the lockfile:

```sh
node --test scripts/task20-supply-chain-audit.test.mjs
node scripts/task20-supply-chain-audit.mjs --npm-audit
```

The current run passed with:

- 543 lockfile entries, including 527 downloaded registry entries;
- zero unresolved downloaded-package integrity records;
- zero unresolved downloaded-package license declarations;
- 45 native/package-runtime records with resolved URL, integrity, version,
  and license metadata where the lockfile provides it; and
- npm production audit counts of 0 info, 0 low, 0 moderate, 0 high, and 0
  critical vulnerabilities.

The command can persist the complete deterministic SPDX-2.3 report outside
the repository with `TERMINAY_SUPPLY_CHAIN_REPORT=/path/report.json`. Platform
optional packages that are not installed on the current host are reported as
manifest-unavailable, but their lockfile integrity and license metadata still
participate in the audit.

## Native binary evidence and limits

The existing
[`node-datachannel` inventory](./node-datachannel-native-supply-chain.md)
verifies npm tarball integrity, source/submodule identities, release archive
hashes, native binary hashes, embedded native-library versions, and license
files for the pinned candidate. The existing secure-Werift production
evidence records a locked dependency graph, notices, SPDX SBOM, and source
correspondence for that candidate.

Those native records are audit evidence, not a release approval. The pinned
`node-datachannel` candidate embeds unsupported/vulnerable OpenSSL lines and
remains rejected for release until a supported rebuild or replacement passes
the same gates. The local JavaScript audit cannot prove native ABI execution,
signatures, notarization, or vulnerability absence in statically linked code;
those remain explicit platform/release gates.
