# Task 20 dependency and native supply-chain audit

Date: 2026-07-27

## Executed JavaScript dependency audit

The repository-local audit is deterministic and does not mutate package
manifests or the lockfile:

```sh
node --test scripts/task20-supply-chain-audit.test.mjs
node scripts/task20-supply-chain-audit.mjs --npm-audit
node --test scripts/production-dependency-audit.test.mjs
node scripts/production-dependency-audit.mjs
```

The current run passed with:

- 691 lockfile entries, including 526 downloaded registry entries;
- every downloaded registry entry has its own integrity record, while bundled
  npm installer dependencies inherit the verified npm carrier archive evidence;
- zero unresolved downloaded-package integrity records;
- zero unresolved downloaded-package license declarations;
- 45 native/package-runtime records with resolved URL, integrity, version,
  and license metadata where the lockfile provides it; and
- zero critical vulnerabilities and no unreviewed high vulnerabilities; and
- four temporary high-severity exceptions confined to the bundled npm 12.0.2
  process: `brace-expansion`, `ip-address`, `npm`, and `tar`. The `npm` and
  `tar` exceptions represent the same bundled-tar advisory and are limited to
  npm's exact paths while npm has no patched 12.x release; they must be removed
  when that upstream release is available.

Those four exceptions cannot affect the Electron renderer or the Terminay
Server process directly. The npm installer runs as a bounded child process
with a 120-second deadline, fixed public-registry origin, sterile environment,
disabled lifecycle scripts, exact lock inspection, and no inherited proxy or
registry credentials. The release gate matches the exact dependency names and
exact `node_modules/npm/node_modules/*` paths and fails closed if npm changes,
the advisory moves outside that child, any critical vulnerability appears, or
any other high vulnerability is reported. Remove each exception as soon as an
upstream npm release carries the fixed dependency.

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
