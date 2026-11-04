# Bot runtime source port

The repository owner authorized copying the desktop and native CLI runner implementation from the internal Atlas product on 2026-11-04. These are independent Terminay-owned source copies, maintained under Terminay's repository terms. Atlas is not a build, package, checkout or runtime dependency. No third-party notice is removed by this port; native CLI and application packages are fetched from their public upstreams during the user-owned local build and retain their own terms.

`port-source.json` records source revision and hashes for maintenance comparisons. Desktop helper names and control endpoints are renamed; the service binds container loopback. The desktop bootstrap, protected VNC, browser sandbox, persistent home, engine transport, per-bot credentials and execution supervisor remain Terminay-owned. The source runner's host/SSH/disposable-container/provider-shared-auth paths are intentionally not copied. Native CLI invocation and stream interpretation are adapted in server-core's native driver rather than importing internal worker types or services.

Pinned public native dependencies: `@openai/codex@0.165.0`, `@anthropic-ai/claude-code@2.1.312`, `chrome-devtools-mcp@1.1.1`. ArtCraft versions and public release URLs are declared in `bin/terminay-artcraft-install`.
