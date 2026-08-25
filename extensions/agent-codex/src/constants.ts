export const EXTENSION_ID = "com.terminay.agent.codex";
export const PROVIDER_ID = "com.terminay.agent.codex/cli";
export const MAPPING_VERSION = "0.1";

export const LIMITS = Object.freeze({
  sessionId: 512,
  providerVersion: 100,
  title: 200,
  prompt: 4_000,
  toolId: 512,
  toolName: 200,
  recordBytes: 64 * 1024,
});
