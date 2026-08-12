import type { EnvironmentCapability, JsonValue } from "@terminay/extension-api";
import type { ProjectEnvironmentRuntime, ProjectEnvironmentInvocationContext } from "../projectEnvironment/registry.js";
import type { ProjectEnvironmentCapability, ProjectEnvironmentState } from "../projectEnvironment/types.js";
import type { ExtensionHostManager } from "./manager.js";
import { randomUUID } from "node:crypto";
import type { PtyProcess } from "../terminalService/types.js";
import { RemoteFileProtocol } from "./remoteFileProtocol.js";

const OPERATIONS: Readonly<Record<ProjectEnvironmentCapability, ReadonlySet<string>>> = Object.freeze({
  terminal: new Set(["spawn", "create", "input", "resize", "read", "kill", "dispose"]),
  filesystem: new Set(["resolveRoot", "browse", "realpath", "stat", "list", "read", "write", "createDirectory", "rename", "remove"]),
  "filesystem-observation": new Set(["observe", "poll", "stop", "manualRefresh"]),
  git: new Set(["discover", "status", "branches", "worktrees", "diff", "fetch", "quickPush", "cancel"]),
  "process-observation": new Set(["observe", "poll", "stop"]),
  "agent-journal": new Set(["observe", "stop"]),
  "mcp-bridge": new Set(["open", "exchange", "close", "revoke"]),
  "shell-discovery": new Set(["list"]),
  infrastructure: new Set<string>(),
});

/** Adapts one registered extension provider into the canonical environment
 * router. Provider state is always loaded from server-owned state, never from
 * a client request, and a revision change fails closed before child IPC. */
export class ExtensionProjectEnvironmentRuntime implements ProjectEnvironmentRuntime {
  private readonly remoteFiles: RemoteFileProtocol;
  constructor(
    readonly providerId: string,
    readonly capabilities: readonly ProjectEnvironmentCapability[],
    private readonly hosts: Pick<ExtensionHostManager, "invokeProvider">,
    private readonly snapshot: () => ProjectEnvironmentState,
  ) { this.remoteFiles = new RemoteFileProtocol((operation, input, context) => this.invokeService("filesystem", operation, input, context)); }

  async invoke(capability: ProjectEnvironmentCapability, operation: string, input: unknown, context: ProjectEnvironmentInvocationContext): Promise<unknown> {
    if (!this.capabilities.includes(capability)) throw new Error("provider service operation is unavailable");
    if (capability === "filesystem" && (operation.startsWith("files.") || operation.startsWith("file."))) return this.remoteFiles.invoke(operation, input, context);
    if (!OPERATIONS[capability].has(operation)) throw new Error("provider service operation is unavailable");
    if (capability === "terminal" && operation === "spawn") return this.spawn(input, context);
    return this.invokeService(capability, operation, input, context);
  }
  private async invokeService(capability: ProjectEnvironmentCapability, operation: string, input: unknown, context: ProjectEnvironmentInvocationContext): Promise<unknown> {
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
  private data = new Set<(bytes:Uint8Array)=>void>(); private exits = new Set<(exit:{exitCode?:number|null;signal?:number|null})=>void>(); private journals = new Set<(event:{provider:"codex";record:Readonly<Record<string,unknown>>})=>void>(); private foreground = new Set<(event:{processName:string;shellForeground:boolean})=>void>(); private timer: ReturnType<typeof setTimeout>|undefined; private journalTimer: ReturnType<typeof setTimeout>|undefined; private processTimer: ReturnType<typeof setTimeout>|undefined; private journalCursor=0; private processObservationId:string|undefined; private lastProcess:string|null|undefined; private stopped=false;
  constructor(private runtime:ExtensionProjectEnvironmentRuntime,private context:ProjectEnvironmentInvocationContext,private id:string){this.poll();}
  write=(bytes:Uint8Array)=>this.call("input",{sessionId:this.id,data:Buffer.from(bytes).toString("utf8")}).then(()=>undefined);
  resize=(dimensions:{cols:number;rows:number})=>this.call("resize",{sessionId:this.id,...dimensions}).then(()=>undefined);
  kill=(signal?:number|string)=>this.call("kill",{sessionId:this.id,...(signal===undefined?{}:{signal:String(signal)})}).then(()=>undefined);
  dispose=async()=>{this.stopped=true;if(this.timer)clearTimeout(this.timer);if(this.journalTimer)clearTimeout(this.journalTimer);if(this.processTimer)clearTimeout(this.processTimer);if(this.processObservationId)await this.runtime.invoke("process-observation","stop",{observationId:this.processObservationId,sessionId:this.id},this.context).catch(()=>undefined);await this.call("dispose",{sessionId:this.id});};
  onData=(listener:(bytes:Uint8Array)=>void)=>{this.data.add(listener);return()=>this.data.delete(listener);};
  onExit=(listener:(exit:{exitCode?:number|null;signal?:number|null})=>void)=>{this.exits.add(listener);return()=>this.exits.delete(listener);};
  onAgentJournal=(listener:(event:{provider:"codex";record:Readonly<Record<string,unknown>>})=>void)=>{this.journals.add(listener);if(this.journals.size===1)this.pollJournals();return()=>{this.journals.delete(listener);if(this.journals.size===0&&this.journalTimer){clearTimeout(this.journalTimer);this.journalTimer=undefined;}};};
  getCwd=async()=>{const state=await this.observeProcess();return state.state==="available"?state.cwd:null;};
  onForegroundProcess=(listener:(event:{processName:string;shellForeground:boolean})=>void)=>{this.foreground.add(listener);if(this.foreground.size===1)this.pollProcess();return()=>{this.foreground.delete(listener);if(this.foreground.size===0&&this.processTimer){clearTimeout(this.processTimer);this.processTimer=undefined;}};};
  private call(operation:string,input:unknown){return this.runtime.invoke("terminal",operation,input,this.context);}
  private poll=async()=>{if(this.stopped)return;try{const result=await this.call("read",{sessionId:this.id,maxBytes:65536}) as {data:string;exit?:{code:number|null;signal:string|null}};const bytes=Buffer.from(result.data,"base64");if(bytes.length)for(const listener of this.data)listener(bytes);if(result.exit){this.stopped=true;for(const listener of this.exits)listener({exitCode:result.exit.code,signal:null});return;}}catch{this.stopped=true;for(const listener of this.exits)listener({exitCode:null,signal:null});return;}this.timer=setTimeout(this.poll,15);};
  private pollJournals=async()=>{if(this.stopped||this.journals.size===0)return;try{const result=await this.runtime.invoke("agent-journal","observe",{sessionId:this.id,cursor:this.journalCursor,maxRecords:32,maxBytes:262144},this.context);const parsed=parseJournalBatch(result,this.id,this.journalCursor);this.journalCursor=parsed.cursor;for(const record of parsed.records)for(const listener of this.journals)listener({provider:"codex",record});}catch{return;}this.journalTimer=setTimeout(this.pollJournals,250);};
  private observeProcess=async()=>{if(!this.processObservationId){const started=await this.runtime.invoke("process-observation","observe",{sessionId:this.id},this.context) as Record<string,unknown>;if(typeof started.observationId!=="string")throw new TypeError("invalid process observation identity");this.processObservationId=started.observationId;}return this.runtime.invoke("process-observation","poll",{observationId:this.processObservationId,sessionId:this.id},this.context) as Promise<{state:string;cwd:string|null;foregroundProcess:string|null}>;};
  private pollProcess=async()=>{if(this.stopped||this.foreground.size===0)return;try{const state=await this.observeProcess();if(state.state==="available"&&state.foregroundProcess!==this.lastProcess){this.lastProcess=state.foregroundProcess;const event={processName:state.foregroundProcess??"",shellForeground:state.foregroundProcess===null};for(const listener of this.foreground)listener(event);}}catch{/* unavailable observation preserves terminal output fallback */}this.processTimer=setTimeout(this.pollProcess,250);};
}
function parseJournalBatch(value:unknown,sessionId:string,previousCursor:number):{cursor:number;records:Readonly<Record<string,unknown>>[]}{if(value===null||typeof value!=="object"||Array.isArray(value))throw new TypeError("invalid remote agent journal batch");const batch=value as Record<string,unknown>;if(batch.sessionId!==sessionId||!Number.isSafeInteger(batch.cursor)||(batch.cursor as number)<previousCursor||!Array.isArray(batch.records)||batch.records.length>32)throw new TypeError("invalid remote agent journal identity");let bytes=0;const records:Readonly<Record<string,unknown>>[]=[];for(const record of batch.records){if(record===null||typeof record!=="object"||Array.isArray(record)||containsNonJson(record))throw new TypeError("invalid remote agent journal record");bytes+=Buffer.byteLength(JSON.stringify(record));if(bytes>262144)throw new TypeError("remote agent journal batch is too large");records.push(Object.freeze({...record as Record<string,unknown>}));}return{cursor:batch.cursor as number,records};}

function validateInput(capability: ProjectEnvironmentCapability, operation: string, input: unknown): void {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new TypeError("provider service input is invalid");
  const value = input as Record<string, unknown>;
  const allowed = capability === "terminal"
    ? ({ create: ["sessionId","term","rows","cols","environment"], input: ["sessionId","data"], resize: ["sessionId","cols","rows"], read: ["sessionId","maxBytes"], kill: ["sessionId","signal"], dispose: ["sessionId"] } as Record<string,string[]>)[operation]
    : capability === "filesystem"
      ? ({ resolveRoot: ["root"], browse: ["path"], realpath: ["path"], stat: ["path"], list: ["path"], read: ["path","offset","length"], write: ["path","data","encoding","expectedMtimeMs","mode"], createDirectory: ["path","mode"], rename: ["path","destination"], remove: ["path"] } as Record<string,string[]>)[operation]
      : capability === "filesystem-observation"
        ? ({ observe: [], poll: ["observationId"], stop: ["observationId"], manualRefresh: ["observationId"] } as Record<string,string[]>)[operation]
      : capability === "process-observation"
        ? ({ observe: ["sessionId"], poll: ["observationId","sessionId"], stop: ["observationId","sessionId"] } as Record<string,string[]>)[operation]
      : capability === "git"
        ? ["payload","body","request"]
      : capability === "agent-journal"
        ? ({ observe: ["sessionId","cursor","maxRecords","maxBytes"], stop: ["sessionId"] } as Record<string,string[]>)[operation]
      : capability === "mcp-bridge"
        ? ({ open: ["sessionId","projectId","environmentId","environmentRevision","capability"], exchange: ["sessionId","action","frame"], close: ["sessionId"], revoke: ["sessionId"] } as Record<string,string[]>)[operation]
      : undefined;
  if (allowed === undefined || Object.keys(value).some((key) => !allowed.includes(key))) throw new TypeError("provider service input contains unknown fields");
  for (const key of ["sessionId","path","destination","signal","term"]) if (value[key] !== undefined && (typeof value[key] !== "string" || String(value[key]).length > 4096 || String(value[key]).includes("\0"))) throw new TypeError("provider service input is invalid");
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
  if (capability === "mcp-bridge") validateMcpBridgeInput(operation,value);
}
function validateMcpBridgeInput(operation:string,value:Record<string,unknown>):void{const safe=(entry:unknown):entry is string=>typeof entry==="string"&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(entry);if(!safe(value.sessionId))throw new TypeError("remote MCP session identity is invalid");if(operation==="open"){if(!safe(value.projectId)||!safe(value.environmentId)||!Number.isSafeInteger(value.environmentRevision)||Number(value.environmentRevision)<=0)throw new TypeError("remote MCP scope is invalid");const capability=value.capability;if(capability===null||typeof capability!=="object"||Array.isArray(capability))throw new TypeError("remote MCP capability is invalid");const item=capability as Record<string,unknown>;if(Object.keys(item).sort().join("|")!=="bootstrapSecret|bridgeId|expiresAt|issuedAt|serverInstanceId|version"||item.version!==1||!safe(item.bridgeId)||!safe(item.serverInstanceId)||typeof item.bootstrapSecret!=="string"||item.bootstrapSecret.length<32||item.bootstrapSecret.length>128||!Number.isSafeInteger(item.issuedAt)||!Number.isSafeInteger(item.expiresAt)||Number(item.expiresAt)<=Number(item.issuedAt))throw new TypeError("remote MCP capability is invalid");}if(operation==="exchange"){if(value.action!=="receive"&&value.action!=="respond")throw new TypeError("remote MCP exchange action is invalid");if(value.action==="receive"&&value.frame===undefined)return;const frame=value.frame;if(frame===null||typeof frame!=="object"||Array.isArray(frame)||Buffer.byteLength(JSON.stringify(frame))>64*1024)throw new TypeError("remote MCP request frame is invalid");}}

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
