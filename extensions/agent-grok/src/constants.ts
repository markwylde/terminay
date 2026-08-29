export const EXTENSION_ID = "com.terminay.agent.grok";
export const PROVIDER_ID = "com.terminay.agent.grok/cli";
export const MAPPING_VERSION = "0.1";
export const SESSION_TITLE_RECORD = "terminay.grok_metadata";

export const LIMITS = Object.freeze({
  sessionId: 512,
  title: 200,
  prompt: 4_000,
  toolId: 512,
  toolName: 200,
  cwd: 4_096,
  activeSessionsBytes: 8 * 1024,
  recordBytes: 64 * 1024,
  // File bytes cross extension IPC as a JSON number array. 32 KiB stays
  // comfortably under the 256 KiB host message cap even in the worst case.
  followChunkBytes: 32 * 1024,
  summaryBytes: 64 * 1024,
});
