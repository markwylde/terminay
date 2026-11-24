## Decisions

1. **Read the version from the archive head.** `peekPublishedIdentity` already
   reads the manifest from the first bytes of the archive for rolling builds
   whose order is unknown. It now also runs for a rolling build that is newer
   or older, so the reported version is the build's own. A peek that fails
   falls back to the asset name rather than failing the check.
2. **The process is the authority on what runs.** The launcher exports the
   archive's version as `TERMINAY_SERVER_VERSION`. The install record is
   rewritten after the new server reports ready, so it lags exactly when a
   client is checking whether the upgrade worked. The record is used only when
   the process has no version of its own (`0.0.0`).
