# Fixture Agent

This deliberately fictional package is the third-party conformance fixture for
Terminay's public session source API. It is not derived from any built-in
extension. The implementation imports only `@terminay/extension-api`, watches
one file the fictional CLI rewrites, and publishes bounded session snapshots.

It is kept as a directly packable npm package so tests exercise the same
manifest, module-resolution, activation, and publication boundary available to
an extension developed outside the Terminay repository.
