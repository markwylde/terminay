import type { EnvironmentCapability, JsonValue } from "@terminay/extension-api";
import type { ProjectEnvironmentRegistry, ProjectEnvironmentRuntime, ProjectEnvironmentInvocationContext } from "../projectEnvironment/registry.js";
import type { ProjectEnvironmentCapability, ProjectEnvironmentState } from "../projectEnvironment/types.js";
import type { ExtensionHostManager } from "./manager.js";
import { randomUUID } from "node:crypto";
import type { PtyProcess } from "../terminalService/types.js";
import { RemoteFileProtocol } from "./remoteFileProtocol.js";

const OPERATIONS: Readonly<Record<ProjectEnvironmentCapability, ReadonlySet<string>>> = Object.freeze({
  terminal: new Set(["resolve-launch", "spawn", "create", "input", "resize", "read", "kill", "dispose"]),
  filesystem: new Set(["resolveRoot", "browse", "realpath", "stat", "list", "read", "write", "createDirectory", "rename", "remove"]),
  "filesystem-observation": new Set(["observe", "poll", "stop", "manualRefresh"]),
  git: new Set(["discover", "status", "branches", "worktrees", "diff", "fetch", "quickPush", "cancel"]),
  "process-observation": new Set(["observe", "poll", "stop"]),
  "agent-journal": new Set(["observe", "stop"]),
  "shell-discovery": new Set(["list"]),
  infrastructure: new Set<string>(),
});

/** Adapts one registered extension provider into the canonical environment
 * router. Provider state is always loaded from server-owned state, never from
 * a client request, and a revision change fails closed before child IPC. */
export class ExtensionProjectEnvironmentRuntime implements ProjectEnvironmentRuntime {
  private readonly remoteFiles: RemoteFileProtocol;
  private readonly pendingRoots = new Map<string, PendingRemoteProjectRoot>();
  constructor(
    readonly providerId: string,
    readonly capabilities: readonly ProjectEnvironmentCapability[],
    private readonly hosts: Pick<ExtensionHostManager, "invokeProvider">,
    private readonly snapshot: () => ProjectEnvironmentState,
    private readonly projectRoot?: (projectId: string) => string | undefined,
  ) { this.remoteFiles = new RemoteFileProtocol((operation, input, context) => this.invokeService("filesystem", operation, input, context), projectRoot); }

  async invoke(capability: ProjectEnvironmentCapability, operation: string, input: unknown, context: ProjectEnvironmentInvocationContext): Promise<unknown> {
    if (!this.capabilities.includes(capability)) throw new Error("provider service operation is unavailable");
    if (capability === "filesystem" && operation === "prepare-project-root") return this.prepareProjectRoot(input, context);
    if (capability === "filesystem" && operation === "commit-project-root") return this.commitProjectRoot(input, context);
    if (capability === "filesystem" && (operation.startsWith("files.") || operation.startsWith("file."))) return this.remoteFiles.invoke(operation, input, context);
    if (!OPERATIONS[capability].has(operation)) throw new Error("provider service operation is unavailable");
    if (capability === "git") input = withProjectRoot(input, this.projectRoot?.(context.projectId));
    if (capability === "terminal" && operation === "resolve-launch") return this.resolveLaunch(input, context);
    if (capability === "terminal" && operation === "spawn") return this.spawn(input, context);
    return this.invokeService(capability, operation, input, context);
  }
  /**
   * A terminal is always launched by Terminay's server-side TerminalService.
   * Providers only own the remote PTY transport, so the common launch metadata
   * belongs here rather than requiring every provider to expose a second shell
   * catalogue. This keeps the first shell on a freshly-created VM deterministic
   * and, importantly, means it can immediately reach the provider's `spawn`
   * implementation.
   */
  private resolveLaunch(input: unknown, context: ProjectEnvironmentInvocationContext): Readonly<Record<string, unknown>> {
    if (!isLaunchInput(input)) throw new Error("remote terminal launch input is invalid");
    const environment = this.environment(context);
    const cwd =
      typeof input.cwd === "string" && input.cwd.length > 0
        ? input.cwd
        : environment.defaultRoot;
    if (typeof cwd !== "string" || cwd.length === 0) throw new Error("project environment has no default root");
    return Object.freeze({
      profile: Object.freeze({
        id: `environment:${environment.id}:system-shell`,
        revision: environment.pinnedRevision,
        name: `${environment.name} shell`,
        targetSummary: environment.endpointSummary,
        icon: "server",
      }),
      shellPath: "/bin/sh",
      args: Object.freeze([]),
      cwd,
    });
  }
  private async invokeService(capability: ProjectEnvironmentCapability, operation: string, input: unknown, context: ProjectEnvironmentInvocationContext): Promise<unknown> {
    validateInput(capability, operation, input);
    const environment = this.environment(context);
    const remaining = Math.max(1, context.deadline - Date.now());
    try {
      return await this.hosts.invokeProvider({
        providerId: this.providerId,
        callback: "invokeService",
        deadlineMs: remaining,
        signal: context.signal,
        request: {
          environmentId: environment.id,
          ...(environment.profileId === undefined ? {} : { profileId: environment.profileId }),
          providerState: environment.providerState,
          capability: capability as EnvironmentCapability,
          operation,
          projectId: context.projectId,
          environmentRevision: context.environmentRevision,
          input: toJson(input),
        },
      });
    } catch (error) {
      // This is intentionally server-side only. The public protocol receives
      // a bounded remote-filesystem failure; diagnostics retain the operation
      // that failed without ever serializing provider state or credentials.
      console.error("[terminay-project-environment-service]", {
        providerId: this.providerId,
        capability,
        operation,
        message: error instanceof Error ? error.message : "provider invocation failed",
      });
      throw error;
    }
  }
  private environment(context: ProjectEnvironmentInvocationContext) {
    const environment = this.snapshot().environments[context.projectEnvironmentId];
    if (environment === undefined || environment.providerId !== this.providerId || environment.pinnedRevision !== context.environmentRevision || environment.status !== "ready" || environment.archived) throw new Error("project environment binding changed");
    return environment;
  }
  private async prepareProjectRoot(input: unknown, context: ProjectEnvironmentInvocationContext): Promise<{ readonly canonicalRoot: string; readonly preparationId: string }> {
    const root = requiredRoot(input);
    const resolved = asRecord(await this.invokeService("filesystem", "resolveRoot", { root }, context));
    const canonicalRoot = resolved.root;
    if (typeof canonicalRoot !== "string" || canonicalRoot.length === 0 || canonicalRoot.length > 4096 || canonicalRoot.includes("\0")) {
      throw new Error("project environment returned an invalid prepared root");
    }
    const preparationId = randomUUID();
    this.pendingRoots.set(preparationId, Object.freeze({
      projectId: context.projectId,
      canonicalRoot,
      environmentRevision: context.environmentRevision,
    }));
    return Object.freeze({ canonicalRoot, preparationId });
  }
  private commitProjectRoot(input: unknown, context: ProjectEnvironmentInvocationContext): null {
    if (!isPlainObject(input) || Object.keys(input).some((key) => key !== "preparationId")) throw new TypeError("provider service input contains unknown fields");
    const preparationId = input.preparationId;
    if (typeof preparationId !== "string" || preparationId.length === 0 || preparationId.length > 128) throw new TypeError("project root preparation is invalid");
    const pending = this.pendingRoots.get(preparationId);
    if (
      pending === undefined
      || pending.projectId !== context.projectId
      || pending.environmentRevision !== context.environmentRevision
    ) {
      throw new Error("project root preparation is not current");
    }
    this.pendingRoots.delete(preparationId);
    this.remoteFiles.forgetProject(context.projectId);
    return null;
  }
  private async spawn(input: unknown, context: ProjectEnvironmentInvocationContext): Promise<PtyProcess> {
    const source = input as Record<string, unknown>; const sessionId = randomUUID();
    const created = await this.invoke("terminal", "create", clean({ sessionId, term: source.name, rows: source.rows, cols: source.cols, environment: source.env }), context) as Record<string, unknown>;
    if (created.sessionId !== sessionId) throw new Error("remote terminal identity mismatch");
    return new ProviderPty(this, context, sessionId);
  }
}

/** Mirrors every active public project-environment contribution into the
 * selected server's router. This is deliberately provider-neutral: the host
 * owns activation/ownership, while each runtime still verifies the exact
 * server-owned environment binding before forwarding child IPC. */
export function registerActivatedExtensionProjectEnvironmentRuntimes(options: Readonly<{
  registry: ProjectEnvironmentRegistry;
  hosts: Pick<ExtensionHostManager, "invokeProvider" | "activatedProjectEnvironmentContributions" | "onContributionsChanged">;
  snapshot: () => ProjectEnvironmentState;
  workspaceSnapshot?: () => { readonly projects: Readonly<Record<string, { readonly root?: string }>> };
}>): { dispose(): void } {
  const registered = new Set<string>();
  const reconcile = (): void => {
    const contributions = options.hosts.activatedProjectEnvironmentContributions();
    const desired = new Map(contributions.map((contribution) => [contribution.id, contribution]));
    for (const providerId of registered) {
      if (!desired.has(providerId)) {
        options.registry.unregister(providerId);
        registered.delete(providerId);
      }
    }
    for (const contribution of desired.values()) {
      const capabilities = contribution.capabilities as readonly ProjectEnvironmentCapability[];
      const existing = options.registry.get(contribution.id);
      if (existing !== undefined && sameCapabilities(existing.capabilities, capabilities)) continue;
      if (existing !== undefined) {
        options.registry.unregister(contribution.id);
        registered.delete(contribution.id);
      }
      options.registry.register(new ExtensionProjectEnvironmentRuntime(
        contribution.id,
        capabilities,
        options.hosts,
        options.snapshot,
        options.workspaceSnapshot === undefined
          ? undefined
          : (projectId) => options.workspaceSnapshot!().projects[projectId]?.root,
      ));
      registered.add(contribution.id);
    }
  };
  reconcile();
  const unsubscribe = options.hosts.onContributionsChanged(reconcile);
  return Object.freeze({ dispose() {
    unsubscribe();
    for (const providerId of registered) options.registry.unregister(providerId);
    registered.clear();
  } });
}
function sameCapabilities(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item) => right.includes(item));
}
function clean(value:Record<string,unknown>):Record<string,unknown>{return Object.fromEntries(Object.entries(value).filter(([,entry])=>entry!==undefined));}
function isLaunchInput(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return Number.isInteger(source.cols) && Number(source.cols) >= 1 && Number(source.cols) <= 1000
    && Number.isInteger(source.rows) && Number(source.rows) >= 1 && Number(source.rows) <= 1000
    && (source.cwd === undefined || (typeof source.cwd === "string" && source.cwd.length > 0 && source.cwd.length <= 4096))
    && (source.profileId === undefined || (typeof source.profileId === "string" && source.profileId.length > 0 && source.profileId.length <= 256))
    && (source.activePanelId === undefined || (typeof source.activePanelId === "string" && source.activePanelId.length > 0 && source.activePanelId.length <= 256));
}

class ProviderPty implements PtyProcess {
  private data = new Set<(bytes:Uint8Array)=>void>(); private exits = new Set<(exit:{exitCode?:number|null;signal?:number|null})=>void>(); private foreground = new Set<(event:{processName:string;shellForeground:boolean})=>void>(); private timer: ReturnType<typeof setTimeout>|undefined; private processTimer: ReturnType<typeof setTimeout>|undefined; private processObservationId:string|undefined; private lastProcess:string|null|undefined; private stopped=false; private readonly streamAbort = new AbortController();
  constructor(private runtime:ExtensionProjectEnvironmentRuntime,private context:ProjectEnvironmentInvocationContext,private id:string){this.poll();}
  write=(bytes:Uint8Array)=>this.call("input",{sessionId:this.id,data:Buffer.from(bytes).toString("utf8")}).then(()=>undefined);
  resize=(dimensions:{cols:number;rows:number})=>this.call("resize",{sessionId:this.id,...dimensions}).then(()=>undefined);
  kill=(signal?:number|string)=>this.call("kill",{sessionId:this.id,...(signal===undefined?{}:{signal:String(signal)})}).then(()=>undefined);
  dispose=async()=>{this.stopped=true;if(this.timer)clearTimeout(this.timer);if(this.processTimer)clearTimeout(this.processTimer);try{if(this.processObservationId)await this.runtime.invoke("process-observation","stop",{observationId:this.processObservationId,sessionId:this.id},this.streamContext()).catch(()=>undefined);await this.call("dispose",{sessionId:this.id});}finally{this.streamAbort.abort();}};
  onData=(listener:(bytes:Uint8Array)=>void)=>{this.data.add(listener);return()=>this.data.delete(listener);};
  onExit=(listener:(exit:{exitCode?:number|null;signal?:number|null})=>void)=>{this.exits.add(listener);return()=>this.exits.delete(listener);};
  getCwd=async(signal?:AbortSignal)=>{const state=await this.observeProcess(signal);return state.state==="available"?state.cwd:null;};
  onForegroundProcess=(listener:(event:{processName:string;shellForeground:boolean})=>void)=>{this.foreground.add(listener);if(this.foreground.size===1)this.pollProcess();return()=>{this.foreground.delete(listener);if(this.foreground.size===0&&this.processTimer){clearTimeout(this.processTimer);this.processTimer=undefined;}};};
  refreshForegroundProcess=async(signal?:AbortSignal)=>{if(this.stopped)return;try{const state=await this.observeProcess();if(signal?.aborted||this.stopped)return;if(state.state!=="available")return;if(state.foregroundProcess===this.lastProcess)return;this.lastProcess=state.foregroundProcess;const event={processName:state.foregroundProcess??"",shellForeground:state.foregroundProcess===null};for(const listener of this.foreground)listener(event);}catch{/* close observation reports limited from the last committed sample */}};
  /** A terminal outlives the original renderer request that created it. Keep
   * the server-owned binding, but issue every stream operation a fresh bounded
   * deadline and a PTY-owned cancellation signal. Reusing `this.context` here
   * made healthy remote terminals fail as soon as their creation request aged
   * out. */
  private streamContext():ProjectEnvironmentInvocationContext{return{...this.context,deadline:Date.now()+30_000,signal:this.streamAbort.signal};}
  private call(operation:string,input:unknown){return this.runtime.invoke("terminal",operation,input,this.streamContext());}
  private poll=async()=>{if(this.stopped)return;try{const result=await this.call("read",{sessionId:this.id,maxBytes:65536}) as {data:string;exit?:{code:number|null;signal:string|null}};const bytes=Buffer.from(result.data,"base64");if(bytes.length)for(const listener of this.data)listener(bytes);if(result.exit){this.stopped=true;for(const listener of this.exits)listener({exitCode:result.exit.code,signal:null});return;}}catch{this.stopped=true;for(const listener of this.exits)listener({exitCode:null,signal:null});return;}this.timer=setTimeout(this.poll,15);};
  private observeProcess=async(signal?:AbortSignal)=>{const context=signal===undefined?this.streamContext():{...this.streamContext(),signal};if(!this.processObservationId){const started=await this.runtime.invoke("process-observation","observe",{sessionId:this.id},context) as Record<string,unknown>;if(typeof started.observationId!=="string")throw new TypeError("invalid process observation identity");this.processObservationId=started.observationId;}return this.runtime.invoke("process-observation","poll",{observationId:this.processObservationId,sessionId:this.id},context) as Promise<{state:string;cwd:string|null;foregroundProcess:string|null}>;};
  private pollProcess=async()=>{if(this.stopped||this.foreground.size===0)return;try{const state=await this.observeProcess();if(state.state==="available"&&state.foregroundProcess!==this.lastProcess){this.lastProcess=state.foregroundProcess;const event={processName:state.foregroundProcess??"",shellForeground:state.foregroundProcess===null};for(const listener of this.foreground)listener(event);}}catch{/* unavailable observation preserves terminal output fallback */}this.processTimer=setTimeout(this.pollProcess,250);};
}

function validateInput(capability: ProjectEnvironmentCapability, operation: string, input: unknown): void {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new TypeError("provider service input is invalid");
  const value = input as Record<string, unknown>;
  const allowed = capability === "terminal"
    ? ({ create: ["sessionId","term","rows","cols","environment"], input: ["sessionId","data"], resize: ["sessionId","cols","rows"], read: ["sessionId","maxBytes"], kill: ["sessionId","signal"], dispose: ["sessionId"] } as Record<string,string[]>)[operation]
    : capability === "filesystem"
      ? ({ resolveRoot: ["root"], browse: ["path","root"], realpath: ["path","root"], stat: ["path","root"], list: ["path","root"], read: ["path","offset","length","root"], write: ["path","data","encoding","expectedMtimeMs","mode","root"], createDirectory: ["path","mode","root"], rename: ["path","destination","root"], remove: ["path","root"] } as Record<string,string[]>)[operation]
      : capability === "filesystem-observation"
        ? ({ observe: [], poll: ["observationId"], stop: ["observationId"], manualRefresh: ["observationId"] } as Record<string,string[]>)[operation]
      : capability === "process-observation"
        ? ({ observe: ["sessionId"], poll: ["observationId","sessionId"], stop: ["observationId","sessionId"] } as Record<string,string[]>)[operation]
      : capability === "git"
        ? ["payload","body","request","root"]
      : capability === "agent-journal"
        ? ({ observe: ["sessionId","cursor","maxRecords","maxBytes"], stop: ["sessionId"] } as Record<string,string[]>)[operation]
      : undefined;
  if (allowed === undefined || Object.keys(value).some((key) => !allowed.includes(key))) throw new TypeError("provider service input contains unknown fields");
  for (const key of ["sessionId","path","destination","signal","term","root"]) if (value[key] !== undefined && (typeof value[key] !== "string" || String(value[key]).length > 4096 || String(value[key]).includes("\0"))) throw new TypeError("provider service input is invalid");
  if (operation !== "create" && capability === "terminal" && typeof value.sessionId !== "string") throw new TypeError("terminal session identity is required");
  if (operation === "input" && (typeof value.data !== "string" || Buffer.byteLength(value.data) > 64 * 1024)) throw new TypeError("terminal input is invalid");
  if (operation === "write" && (typeof value.data !== "string" || value.data.length > 220_000 || ![undefined,"utf8","base64"].includes(value.encoding as never))) throw new TypeError("filesystem write input is invalid");
  for (const key of ["observationId","proof","cwd","foregroundProcess"]) if (value[key] !== undefined && (typeof value[key] !== "string" || String(value[key]).length > 4096 || String(value[key]).includes("\0"))) throw new TypeError("observation input is invalid");
  if (["poll","stop","manualRefresh"].includes(operation) && capability.includes("observation") && typeof value.observationId !== "string") throw new TypeError("observation identity is required");
  if (capability === "process-observation" && typeof value.sessionId !== "string") throw new TypeError("terminal session identity is required");
  if (capability === "git") {
    if (value.payload === null || typeof value.payload !== "object" || Array.isArray(value.payload)) throw new TypeError("Git protocol payload is invalid");
    if (value.body !== undefined && (typeof value.body !== "string" || value.body.length > 1_400_000)) throw new TypeError("Git protocol body is invalid");
    const request = value.request;
    if (request === null || typeof request !== "object" || Array.isArray(request)) throw new TypeError("Git protocol request is invalid");
    const metadata = request as Record<string, unknown>;
    if (Object.keys(metadata).some((key) => !["clientId","authScope","expectedRevision"].includes(key)) || typeof metadata.clientId !== "string" || typeof metadata.authScope !== "string" || (metadata.expectedRevision !== undefined && !Number.isSafeInteger(metadata.expectedRevision))) throw new TypeError("Git protocol request is invalid");
  }
}
function withProjectRoot(input: unknown, root: string | undefined): unknown {
  if (typeof root !== "string" || root.length === 0 || !isPlainObject(input)) return input;
  return { ...input, root };
}
function requiredRoot(input: unknown): string {
  if (!isPlainObject(input) || Object.keys(input).some((key) => key !== "root")) throw new TypeError("provider service input contains unknown fields");
  const root = input.root;
  if (typeof root !== "string" || root.length === 0 || root.length > 4096 || root.includes("\0")) throw new TypeError("project root is invalid");
  return root;
}
function asRecord(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) throw new TypeError("provider service result is invalid");
  return value;
}
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
interface PendingRemoteProjectRoot {
  readonly projectId: string;
  readonly canonicalRoot: string;
  readonly environmentRevision: number;
}
function toJson(value: unknown): JsonValue {
  if (containsNonJson(value)) throw new TypeError("provider service input is invalid or too large");
  const encoded = JSON.stringify(value);
  if (encoded === undefined || Buffer.byteLength(encoded) > 1024 * 1024) throw new TypeError("provider service input is invalid or too large");
  return JSON.parse(encoded) as JsonValue;
}
function containsNonJson(value: unknown, seen = new Set<unknown>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return false;
  if (typeof value === "number") return !Number.isFinite(value);
  if (typeof value !== "object") return true;
  if (seen.has(value)) return true; seen.add(value);
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return true;
  return Object.values(value as Record<string, unknown>).some((entry) => containsNonJson(entry, seen));
}
