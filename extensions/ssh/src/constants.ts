export const EXTENSION_ID = "com.terminay.ssh";
export const PROVIDER_ID = "com.terminay.ssh/connection";
export const PROFILE_LIMITS = Object.freeze({ name: 100, hostname: 253, username: 64, root: 4096 });
export const DEFAULT_TIMEOUTS = Object.freeze({ connectMs: 15_000, handshakeMs: 15_000, keepaliveMs: 15_000 });
