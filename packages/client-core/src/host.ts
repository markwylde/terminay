import type { HostCapability, HostCapabilityProvider, HostCapabilitySet } from "./types.js";

const HOST_CAPABILITY_NAMES: readonly HostCapability[] = [
  "nativeWindows",
  "secureStorage",
  "notifications",
  "filePicker",
  "clipboard",
  "serverExposure",
  "connectionProfiles",
];

/** Make a safe, immutable capability provider from a host's plain capability
 * declaration. This keeps host-specific APIs out of the client package. */
export function createHostCapabilityProvider(
  capabilities: HostCapabilitySet | HostCapabilityProvider = {},
): HostCapabilityProvider {
  if (isProvider(capabilities)) return capabilities;
  const normalized: HostCapabilitySet = {};
  for (const name of HOST_CAPABILITY_NAMES) {
    if (capabilities[name] === true) {
      Object.assign(normalized, { [name]: true });
    }
  }
  const frozen = Object.freeze(normalized);
  return Object.freeze({
    capabilities: frozen,
    has(capability: HostCapability): boolean {
      return frozen[capability] === true;
    },
    require(capability: HostCapability): void {
      if (frozen[capability] !== true) throw new Error(`host capability is unavailable: ${capability}`);
    },
  });
}

function isProvider(value: HostCapabilitySet | HostCapabilityProvider): value is HostCapabilityProvider {
  return typeof (value as HostCapabilityProvider).has === "function" &&
    typeof (value as HostCapabilityProvider).require === "function";
}
