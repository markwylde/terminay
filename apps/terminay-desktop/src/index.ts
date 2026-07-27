/**
 * Application boundary for the future mechanical Desktop migration.
 *
 * The existing root Electron application remains authoritative until the
 * migration slice moves it without changing behaviour.
 */
export const desktopApplicationBoundary = "@terminay/desktop";

export * from "./main/index.js";
export * from "./preload/index.js";
export * from "./renderer/index.js";
export * from "./compatibility/index.js";
