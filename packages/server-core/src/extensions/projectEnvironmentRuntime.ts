import type { EnvironmentCapability, JsonValue } from "@terminay/extension-api";
import type { ProjectEnvironmentRuntime, ProjectEnvironmentInvocationContext } from "../projectEnvironment/registry.js";
import type { ProjectEnvironmentCapability, ProjectEnvironmentState } from "../projectEnvironment/types.js";
import type { ExtensionHostManager } from "./manager.js";
import { randomUUID } from "node:crypto";
import type { PtyProcess } from "../terminalService/types.js";

const OPERATIONS: Readonly<Record<ProjectEnvironmentCapability, ReadonlySet<string>>> = Object.freeze({
  terminal: new Set(["spawn", "create", "input", "resize", "read", "kill", "dispose"]),
  filesystem: new Set(["resolveRoot", "browse", "realpath", "stat", "list", "read", "write", "createDirectory", "rename", "remove"]),
  "filesystem-observation": new Set(["observe", "poll", "stop"]),
  git: new Set(["discover", "status", "branches", "worktrees", "diff", "fetch", "quickPush", "cancel"]),
  "process-observation": new Set(["observe", "stop"]),
  "agent-journal": new Set(["observe", "stop"]),
  "mcp-bridge": new Set(["open", "exchange", "close", "revoke"]),
  "shell-discovery": new Set(["list"]),
  infrastructure: new Set<string>(),
});

/** Adapts one registered extension provider into the canonical environment
 * router. Provider state is always loaded from server-owned state, never from
 * a client request, and a revision change fails closed before child IPC. */
export class ExtensionProjectEnvironmentRuntime implements ProjectEnvironmentRuntime {
  constructor(
    readonly providerId: string,
    readonly capabilities: readonly ProjectEnvironmentCapability[],
    private readonly hosts: Pick<ExtensionHostManager, "invokeProvider">,
    private readonly snapshot: () => ProjectEnvironmentState,
  ) {}

  async invoke(capability: ProjectEnvironmentCapability, operation: string, input: unknown, context: ProjectEnvironmentInvocationContext): Promise<unknown> {
    if (!this.capabilities.includes(capability) || !OPERATIONS[capability].has(operation)) throw new Error("provider service operation is unavailable");
    if (capability === "terminal" && operation === "spawn") return this.spawn(input, context);
    validateInput(capability, operation, input);
    const environment = this.snapshot().environments[context.projectEnvironmentId];
    if (environment === undefined || environment.providerId !== this.providerId || environment.pinnedRevision !== context.environmentRevision || environment.status !== "ready" || environment.archived) throw new Error("project environment binding changed");
    const remaining = Math.max(1, context.deadline - Date.now());
    return this.hosts.invokeProvider({
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
  }
  private async spawn(input: unknown, context: ProjectEnvironmentInvocationContext): Promise<PtyProcess> {
    const source = input as Record<string, unknown>; const sessionId = randomUUID();
    const created = await this.invoke("terminal", "create", clean({ sessionId, term: source.name, rows: source.rows, cols: source.cols, environment: source.env }), context) as Record<string, unknown>;
    if (created.sessionId !== sessionId) throw new Error("remote terminal identity mismatch");
    return new ProviderPty(this, context, sessionId);
  }
}
function clean(value:Record<string,unknown>):Record<string,unknown>{return Object.fromEntries(Object.entries(value).filter(([,entry])=>entry!==undefined));}

class ProviderPty implements PtyProcess {
  private data = new Set<(bytes:Uint8Array)=>void>(); private exits = new Set<(exit:{exitCode?:number|null;signal?:number|null})=>void>(); private timer: ReturnType<typeof setTimeout>|undefined; private stopped=false;
  constructor(private runtime:ExtensionProjectEnvironmentRuntime,private context:ProjectEnvironmentInvocationContext,private id:string){this.poll();}
  write=(bytes:Uint8Array)=>this.call("input",{sessionId:this.id,data:Buffer.from(bytes).toString("utf8")}).then(()=>undefined);
  resize=(dimensions:{cols:number;rows:number})=>this.call("resize",{sessionId:this.id,...dimensions}).then(()=>undefined);
  kill=(signal?:number|string)=>this.call("kill",{sessionId:this.id,...(signal===undefined?{}:{signal:String(signal)})}).then(()=>undefined);
  dispose=()=>{this.stopped=true;if(this.timer)clearTimeout(this.timer);return this.call("dispose",{sessionId:this.id}).then(()=>undefined);};
  onData=(listener:(bytes:Uint8Array)=>void)=>{this.data.add(listener);return()=>this.data.delete(listener);};
  onExit=(listener:(exit:{exitCode?:number|null;signal?:number|null})=>void)=>{this.exits.add(listener);return()=>this.exits.delete(listener);};
  private call(operation:string,input:unknown){return this.runtime.invoke("terminal",operation,input,this.context);}
  private poll=async()=>{if(this.stopped)return;try{const result=await this.call("read",{sessionId:this.id,maxBytes:65536}) as {data:string;exit?:{code:number|null;signal:string|null}};const bytes=Buffer.from(result.data,"base64");if(bytes.length)for(const listener of this.data)listener(bytes);if(result.exit){this.stopped=true;for(const listener of this.exits)listener({exitCode:result.exit.code,signal:null});return;}}catch{this.stopped=true;for(const listener of this.exits)listener({exitCode:null,signal:null});return;}this.timer=setTimeout(this.poll,15);};
}

function validateInput(capability: ProjectEnvironmentCapability, operation: string, input: unknown): void {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new TypeError("provider service input is invalid");
  const value = input as Record<string, unknown>;
  const allowed = capability === "terminal"
    ? ({ create: ["sessionId","term","rows","cols","environment"], input: ["sessionId","data"], resize: ["sessionId","cols","rows"], read: ["sessionId","maxBytes"], kill: ["sessionId","signal"], dispose: ["sessionId"] } as Record<string,string[]>)[operation]
    : capability === "filesystem"
      ? ({ resolveRoot: ["root"], browse: ["path"], realpath: ["path"], stat: ["path"], list: ["path"], read: ["path","offset","length"], write: ["path","data","encoding","expectedMtimeMs","mode"], createDirectory: ["path","mode"], rename: ["path","destination"], remove: ["path"] } as Record<string,string[]>)[operation]
      : undefined;
  if (allowed === undefined || Object.keys(value).some((key) => !allowed.includes(key))) throw new TypeError("provider service input contains unknown fields");
  for (const key of ["sessionId","path","destination","signal","term"]) if (value[key] !== undefined && (typeof value[key] !== "string" || String(value[key]).length > 4096 || String(value[key]).includes("\0"))) throw new TypeError("provider service input is invalid");
  if (operation !== "create" && capability === "terminal" && typeof value.sessionId !== "string") throw new TypeError("terminal session identity is required");
  if (operation === "input" && (typeof value.data !== "string" || Buffer.byteLength(value.data) > 64 * 1024)) throw new TypeError("terminal input is invalid");
  if (operation === "write" && (typeof value.data !== "string" || value.data.length > 220_000 || ![undefined,"utf8","base64"].includes(value.encoding as never))) throw new TypeError("filesystem write input is invalid");
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
