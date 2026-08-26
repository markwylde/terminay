import { defineExtension, type ExtensionContext, type JsonValue, type ProviderCallContext, type ProviderRuntime } from "@terminay/extension-api";
import { PuzedApiError, PuzedClient } from "./client.js";
export * from "./api-types.js";
export * from "./client.js";
export * from "./events.js";
export * from "./inventory.js";
export * from "./profile.js";
export * from "./provider.js";
export * from "./reconciler.js";
export * from "./state.js";

export function activate(context: ExtensionContext): void {
    context.registerProjectEnvironmentProvider({
      definition: {
        providerId: "com.puzed.platform/vm",
        displayName: "Puzed VM",
        description: "Terminay-created virtual machines managed by Puzed Platform.",
        icon: "cloud",
        capabilities: ["terminal", "filesystem"],
		profileForm: {
			id: "puzed-profile", title: "New Puzed provider",
			description: "This saves a Puzed Platform provider account. The API key is stored only in this Terminay Server's vault; it does not create a VM or project connection.", submitLabel: "Test and save provider",
			sections: [{ id: "provider", title: "Provider", disclosure: "always", fields: [
            { id: "display-name", type: "text", label: "Name", required: true, maxLength: 80 },
            { id: "base-url", type: "url", label: "Puzed Platform URL", required: true },
            { id: "api-key", type: "secret", label: "API key", required: true },
            { id: "default-ssh-username", type: "text", label: "Default SSH username", placeholder: "vms" },
            { id: "default-root", type: "text", label: "Default project root" },
          ] }],
        },
        createForm: {
          id: "puzed-create-vm", title: "Create Puzed VM",
          description: "Terminay creates a dedicated SSH key for this VM and stores its private half only in this server's vault.", submitLabel: "Create VM and open project",
          sections: [
            { id: "source", title: "Boot source", disclosure: "always", fields: [
              { id: "image-id", type: "select", label: "Image", required: true, searchable: true, optionSource: "com.puzed.platform/vm/images" },
              { id: "size-preset", type: "preset-cards", label: "Size", required: true, optionSource: "com.puzed.platform/vm/size-presets" },
              { id: "worker-id", type: "select", label: "Host", required: true, searchable: true, optionSource: "com.puzed.platform/vm/workers" },
            { id: "bridge-id", type: "select", label: "Network", description: "Networks are limited to the selected host.", optionSource: "com.puzed.platform/vm/bridges" },
            ] },
            { id: "project", title: "Project access", disclosure: "always", fields: [
              { id: "name", type: "text", label: "VM name", required: true, suggestionSource: "com.puzed.platform/vm/name-suggestion", suggestionLabel: "Regenerate" },
              { id: "username", type: "text", label: "SSH username", defaultValue: "vms", required: true },
              { id: "root", type: "text", label: "Project root", defaultValue: "~", required: true },
            ] },
          ],
        },
      },
      runtime: puzedRuntime,
    });
}

interface PuzedEnvironmentState extends Record<string, JsonValue> {
  profileId: string; machineId: string; bindingId: string; sshRevision: number;
  displayName: string; baseUrl: string; managementState: string; trustChallenge: JsonValue;
  jobId?: string; username?: string; root?: string;
}

/** Puzed owns Platform management identity and delegates all workspace
 * transport to SSH through the public provider-dependency broker. */
const puzedRuntime: ProviderRuntime = {
  async testProfile(request, call) {
    try { await client(request.profileId, await profileValues(request.profileId, request.values, call), call).validateProfile(); return []; }
    catch (error) { return [{ code: safeCode(error), message: safeMessage(error, "Puzed Platform connection failed") }]; }
  },
  async resolveOptions(request, call) {
    const profileId = required(request.profileId, "profileId");
    const platform = client(profileId, await profileValues(profileId, request.values, call), call);
    if (request.sourceId === "com.puzed.platform/vm/images") {
      const [page, settings] = await Promise.all([platform.listImages(), platform.getSettings()]);
      const selectedPreset = typeof request.values["size-preset"] === "string"
        ? (settings.settings.default_size_presets ?? []).find((preset) => preset.id === request.values["size-preset"])
        : undefined;
      return { options: (page.items ?? [])
        .filter((image) => image.status === "ready" && image.cloud_init_supported)
        .map((image) => ({
          value: image.id,
          label: image.name,
          ...(image.description === undefined ? {} : { description: image.description }),
          ...(selectedPreset !== undefined && image.min_disk_bytes !== undefined && selectedPreset.root_disk_bytes < image.min_disk_bytes
            ? { disabledReason: `Requires at least ${formatBytes(image.min_disk_bytes)} of root disk.` }
            : {}),
        })) };
    }
    if (request.sourceId === "com.puzed.platform/vm/size-presets") {
      const settings = (await platform.getSettings()).settings;
      return { options: (settings.default_size_presets ?? []).map((preset) => ({ value: preset.id, label: preset.label, description: `${preset.vcpus} vCPU · ${formatBytes(preset.memory_bytes)} RAM · ${formatBytes(preset.root_disk_bytes)} disk`, default: preset.id === settings.default_size_preset_id })) };
    }
    if (request.sourceId === "com.puzed.platform/vm/workers") {
      const page = await platform.listWorkers();
      return { options: (page.items ?? []).map((worker) => ({ value: worker.id, label: worker.name, description: `${worker.cpu_cores} cores · ${formatBytes(worker.memory_total_bytes)} RAM`, ...(worker.status !== "online" || worker.draining || worker.fault_state !== "ok" ? { disabledReason: worker.status_reason ?? "This host is unavailable." } : {}) })) };
    }
    if (request.sourceId === "com.puzed.platform/vm/bridges") {
      const workerId = optional(request.values["worker-id"]);
      // A bridge is discovered on a worker, not on the organization. Do not
      // show a global bridge before a host exists: it could be incompatible.
      if (workerId === undefined) return { options: [] };
      const page = await platform.listWorkerBridges(workerId);
      return { options: (page.items ?? []).map((bridge) => ({ value: bridge.id, label: bridge.name, default: bridge.is_default })) };
    }
    if (request.sourceId === "com.puzed.platform/vm/name-suggestion") {
      const suggestion = await platform.suggestMachineName();
      return { options: [{ value: suggestion.name, label: suggestion.name, default: true }] };
    }
    throw new Error("Puzed option source is unavailable");
  },
  async createEnvironment(request, call) {
    const profileId = required(request.profileId, "profileId");
    // The original public composition API accepts a complete ephemeral machine
    // description. Keep that path independent of the profile broker: it is
    // also how another trusted provider can compose Puzed with SSH. The
    // declarative UI path deliberately fetches the saved profile so its URL
    // and vault-backed credential remain authoritative.
    const values = typeof request.values["image-id"] === "string"
      ? await profileValues(profileId, request.values, call)
      : request.values;
    if (typeof values["image-id"] === "string") return createVm(request, profileId, values, call);
    const machineId = required(values.machineId, "machineId");
    const generated = typeof values.bindingId === "string" ? undefined : record(await dependency(call, "managed-binding.generate", { ownerProfileId: profileId, operationId: required(values.operationId ?? call.idempotencyKey, "operationId"), logicalHostIdentityHint: `puzed:${profileId}:${machineId}` }));
    const bindingId = typeof values.bindingId === "string" ? required(values.bindingId, "bindingId") : required(generated?.bindingId, "bindingId");
    const ssh = await dependency(call, "managed-binding.bind", {
      bindingId, machineId, logicalHostIdentity: `puzed:${profileId}:${machineId}`,
      host: required(values.host, "host"), port: number(values.port ?? 22, "port"),
      username: required(values.username ?? values["default-ssh-username"] ?? values.defaultSshUsername ?? "vms", "username"), root: values.root ?? values["default-root"] ?? values.defaultRoot ?? "~",
    });
    const verified = await dependency(call, "managed-binding.verify", { bindingId }, number(record(ssh).revision, "revision"));
    if (record(verified).state !== "ready") { const operationId = `puzed-ssh:${machineId}`; const providerState = state(request.displayName, profileId, machineId, bindingId, number(record(ssh).revision, "revision"), values); providerState.trustChallenge = verified; return { state: "pending", operationId, providerState, progress: waitingProgress(operationId), pollAfterMs: 2_000 }; }
    const providerState = state(request.displayName, profileId, machineId, bindingId, number(record(ssh).revision, "revision"), values);
    return { state: "ready", providerState, status: available(providerState, String(record(verified).canonicalRoot ?? values.root ?? "~")) };
  },
  async resumeOperation(request, call) {
    const current = parseState(request.providerState);
    if (current.jobId !== undefined) return resumeCreatedVm(request, current, call);
    const verified = record(await dependency(call, "managed-binding.verify", { bindingId: current.bindingId }, current.sshRevision));
    if (verified.state !== "ready") return { state: "pending", operationId: request.operationId, providerState: current, progress: waitingProgress(request.operationId), pollAfterMs: 2_000 };
    current.trustChallenge = null; return { state: "ready", providerState: current, status: available(current, String(verified.canonicalRoot ?? "~")) };
  },
  async getStatus(request, call) {
    const current = parseState(request.providerState);
    try { const verified = record(await dependency(call, "managed-binding.verify", { bindingId: current.bindingId }, current.sshRevision)); return verified.state === "ready" ? available(current, String(verified.canonicalRoot ?? "~")) : { state: "unavailable", message: String(verified.message ?? "SSH access is unavailable"), revision: current.sshRevision }; }
    catch (error) { return { state: "unavailable", message: safeMessage(error, "SSH access is unavailable"), revision: current.sshRevision }; }
  },
  async invokeAction(request, call) {
    const current = parseState(request.providerState);
    if (request.actionId === "trust-host" || request.actionId === "replace-host-key") {
      const result = record(await dependency(call, "managed-binding.approve-trust", { bindingId: current.bindingId, challengeId: required(request.values?.challengeId, "challengeId"), action: request.actionId === "trust-host" ? "approve" : "replace" }, current.sshRevision));
      current.sshRevision = number(result.revision, "revision"); return { state: "complete", providerState: current, status: available(current, "~") };
    }
    if (!["start", "resume", "stop", "pause", "reboot"].includes(request.actionId)) throw new Error("Puzed environment action is unsupported");
    const snapshot = await call.profiles.get(current.profileId); const platform = client(current.profileId, snapshot.values, call);
    await platform.powerMachine(current.machineId, request.actionId as "start" | "resume" | "stop" | "pause" | "reboot", required(call.idempotencyKey, "idempotencyKey"));
    current.managementState = request.actionId; return { state: "complete", providerState: current, status: available(current, "~") };
  },
  async invokeService(request, call) {
    const current = parseState(request.providerState);
    return dependency(call, "managed-binding.service", { bindingId: current.bindingId, expectedRevision: current.sshRevision, capability: request.capability, operation: request.operation, projectId: request.projectId, input: request.input }, current.sshRevision);
  },
};

function dependency(call: ProviderCallContext, operation: string, payload: JsonValue, expectedRevision?: number): Promise<JsonValue> { return call.dependencies.call({ providerId: "com.terminay.ssh/connection", operation, payload }, { deadlineAt: call.deadlineAt, signal: call.signal, ...(call.idempotencyKey ? { idempotencyKey: call.idempotencyKey } : {}), ...(expectedRevision === undefined ? {} : { expectedRevision }) }); }
async function createVm(request: Parameters<ProviderRuntime["createEnvironment"]>[0], profileId: string, values: Record<string, JsonValue>, call: ProviderCallContext) {
  const platform = client(profileId, values, call); const settings = (await platform.getSettings()).settings;
  const preset = (settings.default_size_presets ?? []).find((item) => item.id === values["size-preset"]);
  if (preset === undefined) throw new Error("Selected Puzed size is unavailable");
  const workerId = required(values["worker-id"], "workerId");
  const bridgeId = optional(values["bridge-id"]);
  // Validate the final pair as late as possible but before generating a
  // binding or issuing POST. Puzed remains authoritative at create time.
  if (bridgeId !== undefined) {
    const compatible = await platform.listAllWorkerBridges(workerId);
    if (!compatible.some((bridge) => bridge.id === bridgeId)) {
      throw new PuzedCompatibilityError();
    }
  }
  const generated = record(await dependency(call, "managed-binding.generate", { ownerProfileId: profileId, operationId: required(call.idempotencyKey, "idempotencyKey"), logicalHostIdentityHint: `puzed:${profileId}:pending` }));
  const bindingId = required(generated.bindingId, "bindingId"); const publicKey = required(generated.publicKey, "publicKey");
  let created: Awaited<ReturnType<PuzedClient["createMachine"]>>;
  try {
    created = await platform.createMachine({ name: required(values.name, "name"), worker_id: workerId, vcpus: preset.vcpus, memory_bytes: preset.memory_bytes, root_disk_bytes: preset.root_disk_bytes, source: { type: "image", image_id: required(values["image-id"], "imageId") }, guest_agent: true, guest_login_mode: "ssh_key_only", ssh_keys: [publicKey], start: true, tags: ["system:Terminay"], ...(bridgeId === undefined ? {} : { nics: [{ bridge_id: bridgeId, ip_mode: "dhcp" }] }) }, required(call.idempotencyKey, "idempotencyKey"));
  } catch (error) {
    if (error instanceof PuzedApiError) {
      throw new Error(`Puzed rejected VM creation (HTTP ${error.status}, ${error.code}).`);
    }
    throw error;
  }
  const providerState = state(request.displayName, profileId, created.machine.id, bindingId, 0, values);
  providerState.jobId = created.job_id; providerState.managementState = "provisioning";
  return { state: "pending" as const, operationId: created.job_id, providerState, progress: provisioningProgress(created.job_id), pollAfterMs: 2_000 };
}

async function resumeCreatedVm(request: Parameters<ProviderRuntime["resumeOperation"]>[0], current: PuzedEnvironmentState, call: ProviderCallContext) {
  const platform = client(current.profileId, await profileValues(current.profileId, {}, call), call);
  const job = await platform.getJob(current.jobId!);
  if (job.status === "failed" || job.status === "canceled") throw new Error("Puzed VM provisioning did not complete");
  if (job.status !== "succeeded") return { state: "pending" as const, operationId: current.jobId!, providerState: current, progress: provisioningProgress(current.jobId!), pollAfterMs: 2_000 };
  const interfaces = await platform.getMachineInterfaces(current.machineId);
  const host = (interfaces.items ?? []).find((item) => typeof item.observed_ip === "string")?.observed_ip;
  if (host === undefined) return { state: "pending" as const, operationId: current.jobId!, providerState: current, progress: waitingProgress(current.jobId!), pollAfterMs: 2_000 };
  const ssh = record(await dependency(call, "managed-binding.bind", { bindingId: current.bindingId, machineId: current.machineId, logicalHostIdentity: `puzed:${current.profileId}:${current.machineId}`, host, port: 22, username: current.username ?? "vms", root: current.root ?? "~" }));
  const revision = number(ssh.revision, "revision"); const verified = record(await dependency(call, "managed-binding.verify", { bindingId: current.bindingId }, revision));
  current.sshRevision = revision; delete current.jobId; current.managementState = "running";
  if (verified.state !== "ready") { current.trustChallenge = verified; return { state: "pending" as const, operationId: request.operationId, providerState: current, progress: waitingProgress(request.operationId), pollAfterMs: 2_000 }; }
  return { state: "ready" as const, providerState: current, status: available(current, String(verified.canonicalRoot ?? current.root ?? "~")) };
}

async function profileValues(profileId: string | undefined, values: Record<string, JsonValue>, call: ProviderCallContext): Promise<Record<string, JsonValue>> { if (profileId === undefined) return values; const profile = await call.profiles.get(profileId); return { ...profile.values, ...values }; }
function client(profileId: string | undefined, values: Record<string, JsonValue>, call: ProviderCallContext): PuzedClient { const baseUrl = required(values["base-url"] ?? values.baseUrl, "baseUrl"); if (profileId === undefined) { const apiKey = required(values["api-key"] ?? values.apiKey, "apiKey"); return new PuzedClient(baseUrl, { async withApiKey(use) { const bytes = new TextEncoder().encode(apiKey); try { return await use(bytes); } finally { bytes.fill(0); } } }); } return new PuzedClient(baseUrl, { withApiKey: (use) => call.secrets.withValue({ profileId, fieldId: "api-key", purpose: "puzed-api-key" }, use) }); }
function state(displayName: string, profileId: string, machineId: string, bindingId: string, sshRevision: number, values: Record<string, JsonValue>): PuzedEnvironmentState { return { profileId, machineId, bindingId, sshRevision, displayName, baseUrl: required(values["base-url"] ?? values.baseUrl, "baseUrl"), managementState: "running", trustChallenge: null, ...(typeof values.username === "string" ? { username: values.username } : {}), ...(typeof values.root === "string" ? { root: values.root } : {}) }; }
function parseState(value: JsonValue): PuzedEnvironmentState { const item = record(value); for (const key of ["profileId", "machineId", "bindingId", "displayName", "baseUrl", "managementState"]) required(item[key], key); number(item.sshRevision, "sshRevision"); return item as PuzedEnvironmentState; }
function available(value: PuzedEnvironmentState, root: string) { return { state: "available" as const, defaultRoot: root, revision: value.sshRevision, card: { id: "puzed-vm", title: value.displayName, summary: "Puzed management and SSH workspace are ready.", icon: "cloud" as const, tone: "positive" as const, facts: [{ label: "Machine", value: value.machineId }, { label: "Root", value: root }], httpsLink: { label: "Open in Puzed", url: new URL(`/vms/${encodeURIComponent(value.machineId)}`, value.baseUrl).toString() } } }; }
function waitingProgress(operationId: string) { return { operationId, title: "Waiting for SSH", resumable: true, stages: [{ id: "ssh", label: "Verify SSH access", state: "active" as const }] }; }
function provisioningProgress(operationId: string) { return { operationId, title: "Creating Puzed VM", resumable: true, stages: [{ id: "puzed", label: "Provision Puzed VM", state: "active" as const }, { id: "ssh", label: "Verify SSH access", state: "pending" as const }] }; }
function formatBytes(value: number): string { if (value >= 1024 ** 3) return `${Math.round(value / 1024 ** 3)} GB`; return `${Math.round(value / 1024 ** 2)} MB`; }
function record(value: JsonValue): Record<string, JsonValue> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Puzed provider data is invalid"); return value; }
function required(value: unknown, name: string): string { if (typeof value !== "string" || !value || value.length > 2048 || value.includes("\0")) throw new Error(`Puzed ${name} is invalid`); return value; }
function optional(value: unknown): string | undefined { return typeof value === "string" && value.length > 0 ? required(value, "value") : undefined; }
function number(value: unknown, name: string): number { if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`Puzed ${name} is invalid`); return Number(value); }
function safeCode(error: unknown): string { return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code.slice(0, 64) : "puzed_error"; }
function safeMessage(error: unknown, fallback: string): string { return error instanceof Error ? error.message.slice(0, 500) : fallback; }

/** Public, bounded, non-secret failure used when the platform's current
 * worker bridge discovery contradicts the draft immediately before submit. */
class PuzedCompatibilityError extends Error {
  constructor() { super("Puzed rejected VM creation (HTTP 409, bridge_worker_mismatch)."); }
}

export const extension = defineExtension({ activate });

export default extension;
