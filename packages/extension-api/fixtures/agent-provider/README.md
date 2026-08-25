# Fixture Agent

This deliberately fictional package is the third-party conformance fixture for
Terminay's public Agent Extension API. It is not derived from any built-in
provider. The implementation imports only `@terminay/extension-api`, binds one
terminal-scoped JSONL journal through opaque host handles, and publishes only
canonical lifecycle events.

It is kept as a directly packable npm package so tests exercise the same
manifest, module-resolution, activation, and observation boundary available to
an extension developed outside the Terminay repository.
