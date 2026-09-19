# ADR-0026: Extensions may ship prebuilt native modules; install scripts stay disabled

Status: accepted
Date: 2026-09-19

## Context

The extension installer has rejected any tree containing a `.node` file or `binding.gyp`. It has also run npm with lifecycle scripts disabled. The rule was never a recorded decision. It was installer policy written under the ADR-0011 trust model, where extensions are already trusted Node programs with the server account's authority.

The built-in agents extension depends on `@markwylde/all-your-agents`. That library uses the optional native `koffi` FFI for kqueue and pidfd process-exit watches. Without it, an agent that exits without writing a file stays listed until its next file change. `koffi` ships prebuilt N-API binaries for every supported platform inside its package, and loads with install scripts disabled. The staging script also dropped `optionalDependencies`, so even a permitted native module never reached a release.

## Decision

1. **Prebuilt native modules are accepted for every extension**, built-in or custom, in production and optional dependencies alike.
2. **Building native code is still refused.** A tree containing `binding.gyp` fails installation.
3. **Install lifecycle scripts are never run.** A native dependency that works only after its install script fails the activation probe, which is the existing fail-closed path.
4. **Built-in staging includes optional dependencies.** It ships the same bytes in every distribution. Staging does not prune per-architecture binaries, because the Electron and standalone inventories are byte-identical.
5. **Release assembly checks native modules.** It fails when a built-in carries a native module with no prebuild for a supported distribution target.

## Consequences

- An extension gains no authority it lacked. A native module runs with the same server-account authority as the extension's JavaScript. The supply-chain surface grows by the native binaries an extension pulls in, and the lockfile and inventory hashes record them.
- Distributions grow by the prebuilds bundled with native dependencies. For `koffi` this is about 28 MB across all platforms.
- Native modules must use an ABI-stable interface (N-API) to load under both Electron's Node and the pinned standalone Node (ADR-0001). A module compiled against one Node ABI loads under only one of them. The activation probe catches that as a failed install.
- A native module that fails to load at runtime is the extension's own fault to handle. The built-in agents extension degrades to file-change re-validation and reports the degraded mode once.
