import type { Event } from "./api-types.js";
import type { PuzedClient } from "./client.js";
import type { Invalidation } from "./events.js";
import type { PuzedStateRepository } from "./state.js";

/** Refetches authoritative resource truth after payload-free SSE invalidations. */
export class PuzedInvalidationReconciler {
  constructor(private readonly profileId: string, private readonly client: PuzedClient, private readonly state: PuzedStateRepository, private readonly resync: () => Promise<void>) {}
  async handle(invalidation: Invalidation, signal?: AbortSignal): Promise<void> {
    if (invalidation.kind === "ready") return;
    if (invalidation.kind === "resync") return this.resync();
    await this.refetch(invalidation.event, signal);
  }
  private async refetch(event: Event, signal?: AbortSignal): Promise<void> {
    if (event.type === "machine") {
      if (event.method === "deleted") return this.state.deleteMachine(this.profileId, event.id);
      const response = await this.client.getMachine(event.id, signal);
      if (response.machine.tags?.includes("system:Terminay")) await this.state.saveMachine(this.profileId, response.machine);
      else await this.state.deleteMachine(this.profileId, event.id);
    } else if (event.type === "job") {
      await this.state.saveJob(this.profileId, await this.client.getJob(event.id, signal));
    } else if (event.type === "network_interface") {
      // Interface events identify the interface rather than its machine. A
      // bounded profile inventory reconciliation resolves that relationship.
      await this.resync();
    }
  }
}
