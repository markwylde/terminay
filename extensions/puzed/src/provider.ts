import type { Machine } from "./api-types.js";
import { PuzedClient } from "./client.js";
import { toInventoryItem, type PuzedMachineInventoryItem, type RetainedVmBinding } from "./inventory.js";

export interface BindingRepository { get(profileId: string, machineId: string): Promise<RetainedVmBinding | undefined> }
export interface AddressResolver { resolve(machine: Machine, client: PuzedClient, signal?: AbortSignal): Promise<string | undefined> }

export class PuzedProvider {
  constructor(private readonly profileId: string, private readonly client: PuzedClient, private readonly bindings: BindingRepository, private readonly addresses: AddressResolver) {}
  async inventory(signal?: AbortSignal): Promise<PuzedMachineInventoryItem[]> {
    const machines = await this.client.listAllTerminayMachines(signal);
    return Promise.all(machines.map(async (machine) => toInventoryItem(machine, this.profileId, this.client.baseUrl, await this.bindings.get(this.profileId, machine.id), await this.addresses.resolve(machine, this.client, signal))));
  }
  async start(machineId: string, key: string, signal?: AbortSignal) { return this.client.powerMachine(machineId, "start", key, signal); }
  async stop(machineId: string, key: string, signal?: AbortSignal) { return this.client.powerMachine(machineId, "stop", key, signal); }
  async pause(machineId: string, key: string, signal?: AbortSignal) { return this.client.powerMachine(machineId, "pause", key, signal); }
  async resume(machineId: string, key: string, signal?: AbortSignal) { return this.client.powerMachine(machineId, "resume", key, signal); }
  async reboot(machineId: string, key: string, signal?: AbortSignal) { return this.client.powerMachine(machineId, "reboot", key, signal); }
  async delete(machineId: string, revision: number, key: string, diskDisposition: "delete" | "keep", signal?: AbortSignal) { return this.client.deleteMachine(machineId, revision, key, { disk_disposition: diskDisposition }, signal); }
}
