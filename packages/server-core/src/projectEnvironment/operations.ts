import type { JsonValue, ProtocolId } from '@terminay/protocol';
import type { EnvironmentActionResult, ProviderDefinition, ProviderEnvironmentStatus, ProvisioningResult } from '@terminay/extension-api';
import type { ExtensionProviderInvocation } from '../extensions/types.js';
import type { OperationRegistries, RequestContext } from '../types.js';
import { THIS_SERVER_ENVIRONMENT_ID, type WorkspaceStore } from '../workspace.js';
import type { ProjectEnvironmentRepository } from './repository.js';
import type { EnvironmentProfile, ProjectEnvironmentRecord, ProjectEnvironmentState } from './types.js';

export const PROJECT_ENVIRONMENT_OPERATIONS = Object.freeze({
	snapshot: 'projectEnvironments.snapshot', createProject: 'projectEnvironments.createProject',
	createProfile: 'projectEnvironments.createProfile', updateProfile: 'projectEnvironments.updateProfile',
	testProfile: 'projectEnvironments.testProfile', removeProfile: 'projectEnvironments.removeProfile',
	invokeAction: 'projectEnvironments.invokeAction',
	resolveOptions: 'projectEnvironments.resolveOptions',
	createEnvironment: 'projectEnvironments.create',
} as const);

export interface ProjectEnvironmentProviderControl {
	createProfile?(providerId: ProtocolId, values: Readonly<Record<string, string | boolean>>, context: ProviderControlContext): Promise<{ profile: EnvironmentProfile; environments?: readonly ProjectEnvironmentRecord[] }>;
	updateProfile?(profile: EnvironmentProfile, values: Readonly<Record<string, string | boolean>>, context: ProviderControlContext): Promise<{ profile: EnvironmentProfile; environments?: readonly ProjectEnvironmentRecord[] }>;
	testProfile?(profile: EnvironmentProfile, context: ProviderControlContext): Promise<void>;
	removeProfile?(profile: EnvironmentProfile, context: ProviderControlContext): Promise<void>;
	invokeAction?(environment: ProjectEnvironmentRecord, actionId: string, context: ProviderControlContext): Promise<void>;
	validateRoot?(environment: ProjectEnvironmentRecord, root: string | undefined, context: ProviderControlContext): Promise<string>;
}
export interface ProviderControlContext { readonly clientId: ProtocolId; readonly signal: AbortSignal; readonly deadline?: number; readonly idempotencyKey?: string; readonly expectedRevision?: number; }
export interface ProjectEnvironmentOperationOptions {
	readonly repository: ProjectEnvironmentRepository;
	readonly workspace: WorkspaceStore;
	readonly providers?: ProjectEnvironmentProviderControl;
	readonly providerDefinitions?: () => readonly ProviderDefinition[];
	readonly providerRuntime?: { invokeProvider(invocation: ExtensionProviderInvocation): Promise<unknown> };
	readonly thisServerRoot: () => string | Promise<string>;
	readonly onChanged?: (payload: JsonValue) => void;
}

/** Fixed UI-facing management surface. Provider configuration remains behind
 * server callbacks; values and raw provider errors never enter response DTOs. */
export function createProjectEnvironmentOperationHandlers(options: ProjectEnvironmentOperationOptions): OperationRegistries {
	const snapshot = async (context?: RequestContext): Promise<JsonValue> => { if (context !== undefined) { await resumePendingOperations(options, context); await refreshRuntimeStatuses(options, context); } return snapshotDto(await options.repository.load(), options.workspace, options.providerDefinitions?.() ?? []); };
	let mutationTail: Promise<void> = Promise.resolve();
	const serialize = <T>(work: () => Promise<T>): Promise<T> => {
		const result = mutationTail.then(work, work);
		mutationTail = result.then(() => undefined, () => undefined);
		return result;
	};
	const commands = {
		[PROJECT_ENVIRONMENT_OPERATIONS.createProject]: async (request: any) => {
			permission(request.context, 'environments:manage');
			permission(request.context, 'workspace:write');
			const payload = exact(request.envelope.payload, ['environmentId', 'viewId', 'root']);
			const state = await options.repository.load();
			const environment = state.environments[text(payload, 'environmentId', 256)];
			if (environment === undefined || environment.archived || environment.status !== 'ready') throw failure('unavailable', 'project environment is unavailable', true);
			const root = environment.id === THIS_SERVER_ENVIRONMENT_ID
				? boundedRoot(payload.root === undefined ? await options.thisServerRoot() : text(payload, 'root', 4096))
				: await requiredProvider(options).validateRoot?.(environment, payload.root === undefined ? undefined : text(payload, 'root', 4096), providerContext(request.context))
					?? (() => { throw failure('unavailable', 'project environment root validation is unavailable', true); })();
			const projectId = uniqueId(`project:${request.envelope.commandId}`, options.workspace.state.projects);
			const result = options.workspace.apply({ commandId: `env:${request.envelope.commandId}`.slice(0, 128), expectedRevision: request.context.expectedRevision, command: { type: 'project.create', projectId, viewId: text(payload, 'viewId', 256), root: boundedRoot(root), rootOrigin: payload.root === undefined ? 'environment-default' : 'explicit', name: projectId, projectEnvironmentId: environment.id, environmentRevision: environment.pinnedRevision } });
			if (!result.ok) throw failure('conflict', result.conflict.message);
			changed(options, state.revision);
			return { result: operation(request.envelope.commandId, { environmentId: environment.id, projectId }), revision: result.revision };
		},
		[PROJECT_ENVIRONMENT_OPERATIONS.createProfile]: mutation(options, serialize, async (state, payload, context) => {
			const providerId = text(payload, 'providerId', 256);
			const created = await requiredProvider(options).createProfile?.(providerId, values(payload.values), context);
			if (created === undefined) throw failure('unavailable', 'project environment provider does not support profiles', true);
			if (state.profiles[created.profile.id] !== undefined) throw failure('conflict', 'environment profile already exists');
			return mergeProviderResult(state, created);
		}),
		[PROJECT_ENVIRONMENT_OPERATIONS.createEnvironment]: mutation(options, serialize, async(state,payload,context)=>{const providerId=text(payload,'providerId',256);const definition=options.providerDefinitions?.().find(candidate=>candidate.providerId===providerId);if(definition?.createForm===undefined)throw failure('not_found','provider environment creation form is unavailable');return createRuntimeEnvironment(options,state,providerId,definition,values(payload.values) as Record<string,JsonValue>,context,payload.profileId===undefined?undefined:text(payload,'profileId',256));}),
		[PROJECT_ENVIRONMENT_OPERATIONS.updateProfile]: mutation(options, serialize, async (state, payload, context) => {
			const id = text(payload, 'profileId', 256); const profile = state.profiles[id]; if (profile === undefined) throw failure('not_found', 'environment profile was not found');
			const related=Object.values(state.environments).filter(environment=>environment.profileId===id);
			if(options.providerRuntime!==undefined&&related.length>0){let next=state;for(const environment of related){const outcome=await runtimeAction(options,environment,'updateEnvironment',{environmentId:environment.id,profileId:id,providerState:environment.providerState,values:values(payload.values) as Record<string,JsonValue>},context,context.idempotencyKey,state.revision);next=applyRuntimeOutcome(next,next.environments[environment.id]!,outcome,runtimeId(`${context.idempotencyKey??id}:${environment.id}`),'update',Date.now());}return next;}
			const updated = await requiredProvider(options).updateProfile?.(profile, values(payload.values), context);
			if (updated === undefined) throw failure('unavailable', 'project environment provider does not support profile updates', true);
			if (updated.profile.id !== id || updated.profile.providerId !== profile.providerId) throw failure('validation', 'provider changed immutable profile identity');
			return mergeProviderResult(state, updated);
		}),
		[PROJECT_ENVIRONMENT_OPERATIONS.testProfile]: providerOnly(options, 'testProfile'),
		[PROJECT_ENVIRONMENT_OPERATIONS.removeProfile]: mutation(options, serialize, async (state, payload, context) => {
			const id = text(payload, 'profileId', 256); const profile = state.profiles[id]; if (profile === undefined) throw failure('not_found', 'environment profile was not found');
			const referenced = Object.values(options.workspace.state.projects).filter((project) => state.environments[project.projectEnvironmentId]?.profileId === id);
			if (referenced.length > 0) throw failure('conflict', 'environment profile is used by a project');
			if (options.providerRuntime !== undefined) for (const environment of Object.values(state.environments).filter((item) => item.profileId === id)) await runtimeAction(options, environment, 'deleteEnvironment', { environmentId:environment.id, profileId:id, providerState:environment.providerState }, context);
			else await requiredProvider(options).removeProfile?.(profile, context);
			return { ...state, profiles: without(state.profiles, id), environments: Object.fromEntries(Object.entries(state.environments).filter(([, environment]) => environment.profileId !== id)) };
		}),
		[PROJECT_ENVIRONMENT_OPERATIONS.invokeAction]: async (request: any) => {
			permission(request.context, 'environments:manage'); const payload = exact(request.envelope.payload, ['environmentId', 'actionId']); const state = await options.repository.load();
			const environment = state.environments[text(payload, 'environmentId', 256)]; if (environment === undefined) throw failure('not_found', 'project environment was not found');
			const context=providerContext(request.context,request.envelope.commandId); const actionId=text(payload, 'actionId', 256);
			if(options.providerRuntime===undefined){await requiredProvider(options).invokeAction?.(environment,actionId,context);return {result:operation(request.envelope.commandId,{environmentId:environment.id}),revision:state.revision};}
			const outcome=await runtimeAction(options,environment,'invokeAction',{environmentId:environment.id,...(environment.profileId===undefined?{}:{profileId:environment.profileId}),providerState:environment.providerState,actionId},context,request.envelope.commandId,state.revision);
			const committed=await options.repository.commit(state.revision,current=>applyRuntimeOutcome(current,environment,outcome,request.envelope.commandId,'action',Date.now())); changed(options,committed.revision);
			return {result:operationDto(committed.operations[request.envelope.commandId]),revision:committed.revision};
		},
	} satisfies Record<string, any>;
	const queries={ [PROJECT_ENVIRONMENT_OPERATIONS.snapshot]: async (request:any) => { permission(request.context, 'environments:read'); exact(request.envelope.payload, []); return snapshot(request.context); }, [PROJECT_ENVIRONMENT_OPERATIONS.resolveOptions]:async(request:any)=>{permission(request.context,'environments:read');const payload=exact(request.envelope.payload,['providerId','sourceId','profileId','query','cursor','values']);return runtimeCall<JsonValue>(options,text(payload,'providerId',256),'resolveOptions',{sourceId:text(payload,'sourceId',256),...(payload.profileId===undefined?{}:{profileId:text(payload,'profileId',256)}),...(payload.query===undefined?{}:{query:text(payload,'query',1024)}),...(payload.cursor===undefined?{}:{cursor:text(payload,'cursor',1024)}),values:values(payload.values) as Record<string,JsonValue>},providerContext(request.context));}};
	return { queries, commands, policies: { ...Object.fromEntries(Object.keys(queries).map(name=>[name,{scope:'read'}])), ...Object.fromEntries(Object.keys(commands).map((name) => [name, { scope: 'write' }])) } };
}

function mutation(options: ProjectEnvironmentOperationOptions, serialize: <T>(work: () => Promise<T>) => Promise<T>, update: (state: ProjectEnvironmentState, payload: Record<string, JsonValue>, context: ProviderControlContext) => Promise<ProjectEnvironmentState>) {
	return async (request: any) => { permission(request.context, 'environments:manage'); const payload = exact(request.envelope.payload, ['providerId', 'profileId', 'values']); return serialize(async () => { const before = await options.repository.load(); const expected = request.context.expectedRevision ?? before.revision; if (expected !== before.revision) throw failure('conflict', 'project environment registry revision changed'); const proposed = await update(before, payload, providerContext(request.context,request.envelope.commandId)); const committed = await options.repository.commit(expected, () => proposed); changed(options, committed.revision); const durable=committed.operations[request.envelope.commandId]; return { result: durable===undefined?operation(request.envelope.commandId):operationDto(durable), revision: committed.revision }; }); };
}
function providerOnly(options: ProjectEnvironmentOperationOptions, method: 'testProfile') { return async (request: any) => { permission(request.context, 'environments:manage'); const payload = exact(request.envelope.payload, ['profileId']); const state = await options.repository.load(); const profile = state.profiles[text(payload, 'profileId', 256)]; if (profile === undefined) throw failure('not_found', 'environment profile was not found'); await requiredProvider(options)[method]?.(profile, providerContext(request.context)); return { result: operation(request.envelope.commandId), revision: state.revision }; }; }
function snapshotDto(state: ProjectEnvironmentState, workspace: WorkspaceStore, definitions: readonly ProviderDefinition[] = []): JsonValue { const refs = new Map<string, number>(); for (const project of Object.values(workspace.state.projects)) refs.set(project.projectEnvironmentId, (refs.get(project.projectEnvironmentId) ?? 0) + 1); return { revision: state.revision, providers: [{ providerId:'terminay:this-server', displayName:'This server', capabilities:['terminal','filesystem'] }, ...definitions.map(providerDto)], environments: Object.values(state.environments).sort((a,b) => a.name.localeCompare(b.name)).map((environment) => ({ id: environment.id, providerId: environment.providerId, providerLabel: environment.builtIn ? 'This Terminay Server' : environment.providerId, ...(environment.profileId === undefined ? {} : { profileId: environment.profileId }), name: environment.name, endpointSummary: environment.endpointSummary, ...(environment.defaultRoot === undefined ? {} : { defaultRoot: environment.defaultRoot }), status: environment.status, referencedProjectCount: refs.get(environment.id) ?? 0, ...(environment.id === THIS_SERVER_ENVIRONMENT_ID ? { isThisServer: true } : {}) })) } as JsonValue; }
function providerDto(definition: ProviderDefinition): JsonValue { return { providerId: definition.providerId, displayName: definition.displayName, ...(definition.description === undefined ? {} : { description: definition.description }), capabilities: [...definition.capabilities], ...(definition.profileForm === undefined ? {} : { profileForm: structuredClone(definition.profileForm) }), ...(definition.createForm === undefined ? {} : { createForm: structuredClone(definition.createForm) }) } as unknown as JsonValue; }
function mergeProviderResult(state: ProjectEnvironmentState, result: { profile: EnvironmentProfile; environments?: readonly ProjectEnvironmentRecord[] }): ProjectEnvironmentState { return { ...state, profiles: { ...state.profiles, [result.profile.id]: result.profile }, environments: { ...state.environments, ...Object.fromEntries((result.environments ?? []).map((environment) => [environment.id, environment])) } }; }
async function createRuntimeEnvironment(options:ProjectEnvironmentOperationOptions,state:ProjectEnvironmentState,providerId:string,definition:ProviderDefinition,formValues:Record<string,JsonValue>,context:ProviderControlContext,profileId?:string):Promise<ProjectEnvironmentState>{
	const id=runtimeId(`env:${context.idempotencyKey??Date.now()}`); if(state.environments[id]!==undefined)return state;
	const issues=await runtimeCall<readonly unknown[]>(options,providerId,'testProfile',{...(profileId===undefined?{}:{profileId}),values:formValues},context);if(issues.length>0)throw failure('validation','project environment configuration is invalid');
	const displayName=typeof formValues.name==='string'&&formValues.name.length>0?formValues.name:definition.displayName;
	const result=await runtimeCall<ProvisioningResult>(options,providerId,'createEnvironment',{environmentId:id,displayName,...(profileId===undefined?{}:{profileId}),values:formValues},context);
	const now=Date.now(); const providerState=result.providerState;
	const status=result.state==='ready'?result.status:undefined;
	const environment:ProjectEnvironmentRecord={id,providerId,...(profileId===undefined?{}:{profileId}),pinnedRevision:1,name:displayName,endpointSummary:definition.displayName,declaredCapabilities:definition.capabilities.filter(domainCapability) as ProjectEnvironmentRecord['declaredCapabilities'],availableCapabilities:result.state==='ready'?definition.capabilities.filter(domainCapability) as ProjectEnvironmentRecord['availableCapabilities']:[],status:status===undefined?'provisioning':domainStatus(status),...(status?.defaultRoot===undefined?{}:{defaultRoot:status.defaultRoot}),...(status===undefined?{}:{lastSuccessfulCheck:now}),operationReferences:result.state==='pending'?[context.idempotencyKey??id]:[],projectReferenceCount:0,archived:false,builtIn:false,providerState,providerRevision:status?.revision??1};
	if(result.state==='ready')return {...state,environments:{...state.environments,[id]:environment}};
	const operationId=runtimeId(context.idempotencyKey??`operation:${id}`);
	return {...state,environments:{...state.environments,[id]:{...environment,operationReferences:[operationId]}},operations:{...state.operations,[operationId]:{id:operationId,providerId,environmentId:id,kind:'create',state:'pending',providerOperationId:runtimeId(result.operationId),providerState,progress:result.progress as unknown as JsonValue,createdAt:now,updatedAt:now,revision:1}}};
}
async function runtimeCall<T>(options:ProjectEnvironmentOperationOptions,providerId:string,callback:ExtensionProviderInvocation['callback'],request:JsonValue,context:ProviderControlContext):Promise<T>{if(options.providerRuntime===undefined)throw failure('unavailable','project environment provider runtime is unavailable',true);const remaining=context.deadline===undefined?30000:Math.max(1,context.deadline-Date.now());try{return await options.providerRuntime.invokeProvider({providerId,callback,request,deadlineMs:remaining,...(context.idempotencyKey===undefined?{}:{idempotencyKey:context.idempotencyKey}),...(context.expectedRevision===undefined?{}:{expectedRevision:context.expectedRevision}),signal:context.signal}) as T;}catch{throw failure('unavailable','project environment provider operation failed',true);}}
async function runtimeAction(options:ProjectEnvironmentOperationOptions,environment:ProjectEnvironmentRecord,callback:ExtensionProviderInvocation['callback'],request:JsonValue,context:ProviderControlContext,idempotencyKey?:string,expectedRevision?:number):Promise<EnvironmentActionResult>{return runtimeCall(options,environment.providerId,callback,request,{...context,...(idempotencyKey===undefined?{}:{idempotencyKey}),...(expectedRevision===undefined?{}:{expectedRevision})});}
function applyRuntimeOutcome(state:ProjectEnvironmentState,environment:ProjectEnvironmentRecord,outcome:EnvironmentActionResult,id:string,kind:string,now:number):ProjectEnvironmentState{const operationId=runtimeId(id);if(outcome.state==='complete'){const updated=environmentFromStatus(environment,outcome.providerState,outcome.status,now);return {...state,environments:{...state.environments,[environment.id]:updated},operations:{...state.operations,[operationId]:{id:operationId,providerId:environment.providerId,environmentId:environment.id,kind,state:'succeeded',providerState:outcome.providerState,createdAt:now,updatedAt:now,revision:1}}};}return {...state,environments:{...state.environments,[environment.id]:{...environment,status:'provisioning',availableCapabilities:[],providerState:outcome.providerState,operationReferences:[...new Set([...environment.operationReferences,operationId])]}},operations:{...state.operations,[operationId]:{id:operationId,providerId:environment.providerId,environmentId:environment.id,kind,state:'pending',providerOperationId:runtimeId(outcome.operationId),providerState:outcome.providerState,progress:outcome.progress as unknown as JsonValue,createdAt:now,updatedAt:now,revision:1}}};}
function environmentFromStatus(environment:ProjectEnvironmentRecord,providerState:JsonValue,status:ProviderEnvironmentStatus,now:number):ProjectEnvironmentRecord{return {...environment,providerState,providerRevision:status.revision,status:domainStatus(status),...(status.defaultRoot===undefined?{}:{defaultRoot:status.defaultRoot}),availableCapabilities:status.state==='available'?environment.declaredCapabilities:[],lastSuccessfulCheck:status.state==='available'?now:environment.lastSuccessfulCheck,operationReferences:[]};}
async function resumePendingOperations(options:ProjectEnvironmentOperationOptions,requestContext:RequestContext):Promise<void>{if(options.providerRuntime===undefined)return;let state=await options.repository.load();for(const pending of Object.values(state.operations).filter(item=>item.state==='pending'||item.state==='running')){const environment=state.environments[pending.environmentId];if(environment===undefined)continue;try{const result=await runtimeCall<ProvisioningResult>(options,pending.providerId,'resumeOperation',{environmentId:environment.id,...(environment.profileId===undefined?{}:{profileId:environment.profileId}),providerState:pending.providerState,operationId:pending.providerOperationId??pending.id},providerContext(requestContext,pending.id));const now=Date.now();const proposed=result.state==='ready'?{...state,environments:{...state.environments,[environment.id]:environmentFromStatus(environment,result.providerState,result.status,now)},operations:{...state.operations,[pending.id]:{...pending,state:'succeeded' as const,providerState:result.providerState,updatedAt:now,revision:pending.revision+1}}}:{...state,environments:{...state.environments,[environment.id]:{...environment,providerState:result.providerState,status:'provisioning' as const}},operations:{...state.operations,[pending.id]:{...pending,state:'running' as const,providerOperationId:runtimeId(result.operationId),providerState:result.providerState,progress:result.progress as unknown as JsonValue,updatedAt:now,revision:pending.revision+1}}};state=await options.repository.commit(state.revision,()=>proposed);changed(options,state.revision);}catch{ /* Durable pending state remains retryable; raw provider errors are not persisted. */ }} }
async function refreshRuntimeStatuses(options:ProjectEnvironmentOperationOptions,requestContext:RequestContext):Promise<void>{if(options.providerRuntime===undefined)return;let state=await options.repository.load();for(const environment of Object.values(state.environments).filter(item=>!item.builtIn&&item.status!=='provisioning')){try{const status=await runtimeCall<ProviderEnvironmentStatus>(options,environment.providerId,'getStatus',{environmentId:environment.id,...(environment.profileId===undefined?{}:{profileId:environment.profileId}),providerState:environment.providerState},providerContext(requestContext));const next=environmentFromStatus(environment,environment.providerState,status,Date.now());if(JSON.stringify(next)===JSON.stringify(environment))continue;state=await options.repository.commit(state.revision,current=>({...current,environments:{...current.environments,[environment.id]:next}}));changed(options,state.revision);}catch{/* Existing safe state remains visible while provider is unavailable. */}}}
function operationDto(value:import('./types.js').ProjectEnvironmentOperationRecord|undefined):JsonValue{if(value===undefined)throw failure('not_found','project environment operation was not found');return {operationId:value.id,state:value.state,...(value.progress===undefined?{}:{stage:progressStage(value.progress),progress:progressFraction(value.progress)}),environmentId:value.environmentId};}
function progressStage(value:JsonValue):string{if(typeof value==='object'&&value!==null&&!Array.isArray(value)&&Array.isArray(value.stages)){const stages=value.stages as Array<Record<string,unknown>>;const stage=stages.find(item=>item?.state==='active')??stages.at(-1);if(typeof stage?.label==='string')return stage.label.slice(0,256);}return 'working';}
function progressFraction(value:JsonValue):number{if(typeof value==='object'&&value!==null&&!Array.isArray(value)&&Array.isArray(value.stages)&&value.stages.length>0){const complete=value.stages.filter((item:any)=>item?.state==='complete').length;return Math.max(0,Math.min(1,complete/value.stages.length));}return 0;}
function domainStatus(status:ProviderEnvironmentStatus):ProjectEnvironmentRecord['status']{return status.state==='available'?'ready':status.state==='connecting'?'connecting':status.state==='unavailable'?'offline':status.state==='deleting'?'stopping':'failed';}
function domainCapability(value:string):value is ProjectEnvironmentRecord['declaredCapabilities'][number]{return ['terminal','filesystem','filesystem-observation','git','process-observation','agent-journal','mcp-bridge','infrastructure','shell-discovery'].includes(value);}
function runtimeId(value:string):string{return value.replace(/[^A-Za-z0-9._:-]/gu,'-').slice(0,128)||'operation';}
function operation(id: string, result: { environmentId?: string; projectId?: string } = {}): JsonValue { return { operationId: id, state: 'succeeded', stage: 'complete', progress: 1, ...result }; }
function changed(options: ProjectEnvironmentOperationOptions, revision: number): void { options.onChanged?.({ revision }); }
function providerContext(context: RequestContext, idempotencyKey?: string): ProviderControlContext { return { clientId: context.clientId, signal: context.signal, ...(context.deadline === undefined ? {} : { deadline: context.deadline }), ...(idempotencyKey===undefined?{}:{idempotencyKey}), ...(context.expectedRevision===undefined?{}:{expectedRevision:context.expectedRevision}) }; }
function requiredProvider(options: ProjectEnvironmentOperationOptions): ProjectEnvironmentProviderControl { if (options.providers === undefined) throw failure('unavailable', 'project environment provider is unavailable', true); return options.providers; }
function permission(context: RequestContext, required: string): void { if (!context.permissions?.includes(required)) throw failure('forbidden', `permission ${required} is required`); }
function exact(value: unknown, allowed: readonly string[]): Record<string, JsonValue> { if (typeof value !== 'object' || value === null || Array.isArray(value)) throw failure('validation', 'project environment request is invalid'); const result = value as Record<string, JsonValue>; for (const key of Object.keys(result)) if (!allowed.includes(key)) throw failure('validation', 'project environment request contains an unsupported field'); return result; }
function text(value: Record<string, JsonValue>, key: string, max: number): string { const candidate = value[key]; if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > max || candidate.includes('\0')) throw failure('validation', `${key} is invalid`); return candidate; }
function values(value: JsonValue | undefined): Readonly<Record<string, string | boolean>> { if (typeof value !== 'object' || value === null || Array.isArray(value)) throw failure('validation', 'profile values are invalid'); const entries = Object.entries(value); if (entries.length > 128 || entries.some(([key, item]) => key.length === 0 || key.length > 256 || (typeof item !== 'string' && typeof item !== 'boolean') || (typeof item === 'string' && item.length > 16384))) throw failure('validation', 'profile values are invalid'); return value as Record<string, string | boolean>; }
function boundedRoot(value: string): string { if (value.length === 0 || value.length > 4096 || value.includes('\0')) throw failure('validation', 'project root is invalid'); return value; }
function uniqueId(candidate: string, existing: Readonly<Record<string, unknown>>): string { let id = candidate.slice(0,128); let suffix = 1; while (existing[id] !== undefined) id = `${candidate.slice(0, 118)}:${suffix++}`; return id; }
function without<T>(record: Readonly<Record<string,T>>, id: string): Record<string,T> { return Object.fromEntries(Object.entries(record).filter(([key]) => key !== id)); }
function failure(code: 'validation'|'not_found'|'conflict'|'forbidden'|'unavailable', message: string, retryable=false): Error & { code:string; retryable:boolean } { return Object.assign(new Error(message), { code, retryable }); }
