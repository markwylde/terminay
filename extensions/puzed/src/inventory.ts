import type { Machine } from "./api-types.js";

export interface SshBindingDescriptor {
  providerId: "com.terminay.ssh/connection";
  bindingId: string;
  logicalHostIdentity: string;
  host: string;
  port: number;
  username: string;
  defaultRoot?: string;
}

export interface RetainedVmBinding {
  platformProfileId: string;
  machineId: string;
  sshBindingId?: string;
  sshUsername: string;
  sshPort?: number;
  addressOverride?: string;
  defaultRoot?: string;
  provisioningJobId?: string;
}

export interface PuzedMachineInventoryItem {
  machine: Machine;
  managementState: "running" | "stopped" | "paused" | "provisioning" | "failed" | "stale";
  openable: boolean;
  disabledReason?: string;
  openInPuzedUrl: string;
  ssh?: SshBindingDescriptor;
}

export function toInventoryItem(machine: Machine, profileId: string, baseUrl: URL, binding: RetainedVmBinding | undefined, address: string | undefined): PuzedMachineInventoryItem {
  if (!machine.tags?.includes("system:Terminay")) throw new Error("Only system:Terminay machines may enter Puzed inventory.");
  const state = machine.state_stale ? "stale" : machine.status === "error" ? "failed" : machine.status === "suspended" ? "paused" : machine.status;
  let disabledReason: string | undefined;
  if (!binding?.sshBindingId) disabledReason = "This Terminay Server does not have the SSH binding retained when the VM was created.";
  else if (["error", "deleting"].includes(machine.status)) disabledReason = `The VM is ${machine.status}.`;
  else if (!address && machine.status === "running") disabledReason = "The VM does not have an observed or configured SSH address yet.";
  const ssh = !disabledReason && address && binding?.sshBindingId ? {
    providerId: "com.terminay.ssh/connection" as const,
    bindingId: binding.sshBindingId,
    logicalHostIdentity: `puzed:${profileId}:${machine.id}`,
    host: binding.addressOverride ?? address,
    port: binding.sshPort ?? 22,
    username: binding.sshUsername,
    ...(binding.defaultRoot ? { defaultRoot: binding.defaultRoot } : {}),
  } : undefined;
  return {
    machine, managementState: state as PuzedMachineInventoryItem["managementState"],
    openable: !disabledReason && (machine.status === "running" || machine.status === "stopped" || machine.status === "paused"),
    ...(disabledReason ? { disabledReason } : {}),
    openInPuzedUrl: new URL(`/vms/${encodeURIComponent(machine.id)}`, baseUrl).toString(),
    ...(ssh ? { ssh } : {}),
  };
}

export function inventoryOption(item: PuzedMachineInventoryItem): { value: string; label: string; description: string; disabledReason?: string } {
  const state = `${item.managementState.charAt(0).toUpperCase()}${item.managementState.slice(1)}`;
  return {
    value: item.machine.id,
    label: item.machine.name,
    description: item.ssh === undefined ? state : `${state} · ${item.ssh.host}`,
    ...(item.openable ? {} : { disabledReason: item.disabledReason ?? "This VM cannot be selected." }),
  };
}
