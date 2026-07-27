/**
 * The sole public composition boundary for legacy Desktop services.
 */
export const legacyCompatibilityBoundary = "desktop-compatibility";

export * from "./framedIpcTransport.js";
export * from "./scopedIpcClient.js";
export * from "./workspaceSeed.js";
export * from "./terminalAuthority.js";
