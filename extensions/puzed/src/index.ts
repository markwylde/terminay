import { defineExtension, type ExtensionContext, type JsonValue, type ProviderCallContext, type ProviderRuntime } from "@terminay/extension-api";
import { PuzedClient } from "./client.js";
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
          id: "puzed-profile", title: "Puzed Platform connection",
          description: "The API key is stored only in this Terminay Server's vault.", submitLabel: "Test and save",
          sections: [{ id: "connection", title: "Connection", disclosure: "always", fields: [
            { id: "display-name", type: "text", label: "Name", required: true, maxLength: 80 },
            { id: "base-url", type: "url", label: "Puzed Platform URL", required: true },
            { id: "api-key", type: "secret", label: "API key", required: true },
            { id: "default-ssh-username", type: "text", label: "Default SSH username", placeholder: "vms" },
            { id: "default-root", type: "text", label: "Default project root" },
          ] }],
        },
      },
      runtime: puzedRuntime,
    });
}

interface PuzedEnvironmentState extends Record<string, JsonValue> {
  profileId: string; machineId: string; bindingId: string; sshRevision: number;
  displayName: string; baseUrl: string; managementState: string; trustChallenge: JsonValue;
}

/** Puzed owns Platform management identity and delegates all workspace
 * transport to SSH through the public provider-dependency broker. */
const puzedRuntime: ProviderRuntime = {
  async testProfile(request, call) {
    try { await client(request.profileId, request.values, call).validateProfile(); return []; }
    catch (error) { return [{ code: safeCode(error), message: safeMessage(error, "Puzed Platform connection failed") }]; }
  },
  async resolveOptions() { return { options: [] }; },
  async createEnvironment(request, call) {
    const values = request.values; const profileId = required(request.profileId, "profileId");
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
    const current = parseState(request.providerState); const verified = record(await dependency(call, "managed-binding.verify", { bindingId: current.bindingId }, current.sshRevision));
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
function client(profileId: string | undefined, values: Record<string, JsonValue>, call: ProviderCallContext): PuzedClient { const id = required(profileId, "profileId"); return new PuzedClient(required(values["base-url"] ?? values.baseUrl, "baseUrl"), { withApiKey: (use) => call.secrets.withValue({ profileId: id, fieldId: "api-key", purpose: "puzed-api-key" }, use) }); }
function state(displayName: string, profileId: string, machineId: string, bindingId: string, sshRevision: number, values: Record<string, JsonValue>): PuzedEnvironmentState { return { profileId, machineId, bindingId, sshRevision, displayName, baseUrl: required(values["base-url"] ?? values.baseUrl, "baseUrl"), managementState: "running", trustChallenge: null }; }
function parseState(value: JsonValue): PuzedEnvironmentState { const item = record(value); for (const key of ["profileId", "machineId", "bindingId", "displayName", "baseUrl", "managementState"]) required(item[key], key); number(item.sshRevision, "sshRevision"); return item as PuzedEnvironmentState; }
function available(value: PuzedEnvironmentState, root: string) { return { state: "available" as const, defaultRoot: root, revision: value.sshRevision, card: { id: "puzed-vm", title: value.displayName, summary: "Puzed management and SSH workspace are ready.", icon: "cloud" as const, tone: "positive" as const, facts: [{ label: "Machine", value: value.machineId }, { label: "Root", value: root }], httpsLink: { label: "Open in Puzed", url: new URL(`/vms/${encodeURIComponent(value.machineId)}`, value.baseUrl).toString() } } }; }
function waitingProgress(operationId: string) { return { operationId, title: "Waiting for SSH", resumable: true, stages: [{ id: "ssh", label: "Verify SSH access", state: "active" as const }] }; }
function record(value: JsonValue): Record<string, JsonValue> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Puzed provider data is invalid"); return value; }
function required(value: unknown, name: string): string { if (typeof value !== "string" || !value || value.length > 2048 || value.includes("\0")) throw new Error(`Puzed ${name} is invalid`); return value; }
function number(value: unknown, name: string): number { if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`Puzed ${name} is invalid`); return Number(value); }
function safeCode(error: unknown): string { return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code.slice(0, 64) : "puzed_error"; }
function safeMessage(error: unknown, fallback: string): string { return error instanceof Error ? error.message.slice(0, 500) : fallback; }

export const extension = defineExtension({ activate });

export default extension;
