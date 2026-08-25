import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Job, Machine } from "./api-types.js";
import type { EventCursorStore } from "./events.js";
import type { RetainedVmBinding } from "./inventory.js";
import type { BindingRepository } from "./provider.js";

interface PersistedState {
  version: 1;
  cursors: Record<string, string>;
  bindings: Record<string, RetainedVmBinding>;
  machines: Record<string, Machine>;
  jobs: Record<string, Job>;
  addresses: Record<string, string>;
}

const empty = (): PersistedState => ({ version: 1, cursors: {}, bindings: {}, machines: {}, jobs: {}, addresses: {} });
const key = (profileId: string, id: string) => `${profileId}:${id}`;

/** Durable, extension-namespaced state. Writes use same-directory atomic rename. */
export class PuzedStateRepository implements EventCursorStore, BindingRepository {
  #state: PersistedState = empty();
  #writeChain: Promise<void> = Promise.resolve();
  private constructor(private readonly file: string) {}

  static async open(file: string): Promise<PuzedStateRepository> {
    const store = new PuzedStateRepository(file);
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as PersistedState;
      if (parsed.version !== 1) throw new Error("Unsupported Puzed state version.");
      store.#state = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return store;
  }

  load(profileId: string): Promise<string | undefined> { return Promise.resolve(this.#state.cursors[profileId]); }
  async save(profileId: string, cursor: string): Promise<void> { this.#state.cursors[profileId] = cursor; await this.flush(); }
  get(profileId: string, machineId: string): Promise<RetainedVmBinding | undefined> { return Promise.resolve(this.#state.bindings[key(profileId, machineId)]); }
  async saveBinding(binding: RetainedVmBinding): Promise<void> { this.#state.bindings[key(binding.platformProfileId, binding.machineId)] = binding; await this.flush(); }
  machine(profileId: string, id: string): Machine | undefined { return this.#state.machines[key(profileId, id)]; }
  job(profileId: string, id: string): Job | undefined { return this.#state.jobs[key(profileId, id)]; }
  address(profileId: string, id: string): string | undefined { return this.#state.addresses[key(profileId, id)]; }
  async saveMachine(profileId: string, machine: Machine): Promise<void> { this.#state.machines[key(profileId, machine.id)] = machine; await this.flush(); }
  async deleteMachine(profileId: string, id: string): Promise<void> { delete this.#state.machines[key(profileId, id)]; delete this.#state.addresses[key(profileId, id)]; await this.flush(); }
  async saveJob(profileId: string, job: Job): Promise<void> { this.#state.jobs[key(profileId, job.id)] = job; await this.flush(); }
  async saveAddress(profileId: string, machineId: string, address: string): Promise<void> { this.#state.addresses[key(profileId, machineId)] = address; await this.flush(); }

  private async flush(): Promise<void> {
    const serialized = JSON.stringify(this.#state);
    this.#writeChain = this.#writeChain.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      await writeFile(temporary, serialized, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.file);
    });
    await this.#writeChain;
  }
}
