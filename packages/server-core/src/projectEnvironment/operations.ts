import type { JsonValue, ProtocolId } from '@terminay/protocol';
import type { EnvironmentActionResult, ProviderDefinition, ProviderEnvironmentStatus, ProvisioningResult } from '@terminay/extension-api';
import type { ExtensionProviderInvocation } from '../extensions/types.js';
import type { CommandRequest, OperationRegistries, QueryRequest, RequestContext } from '../types.js';
import { THIS_SERVER_ENVIRONMENT_ID, type WorkspaceStore } from '../workspace.js';
import type { ProjectEnvironmentRepository } from './repository.js';
import { ProjectEnvironmentConflictError } from './repository.js';
import type { EnvironmentProfile, ProjectEnvironmentRecord, ProjectEnvironmentState } from './types.js';
import type { PreparedProjectRootUpdate } from '../workspaceProtocol.js';

export const PROJECT_ENVIRONMENT_OPERATIONS = Object.freeze({
	snapshot: 'project-environments.snapshot', createProject: 'project-environments.create-project',
	createProfile: 'project-environments.create-profile', updateProfile: 'project-environments.update-profile',
	testProfile: 'project-environments.test-profile', removeProfile: 'project-environments.remove-profile',
	removeEnvironment: 'project-environments.remove-connection',
	invokeAction: 'project-environments.invoke-action',
	resolveOptions: 'project-environments.resolve-options',
	createEnvironment: 'project-environments.create',
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
	/** Prepare the project filesystem binding before a newly-created project is
	 * published. This keeps environment-created projects on the same canonical
	 * file authority path as workspace.command project.create. */
	readonly prepareProjectRootUpdate?: (
		projectId: string,
		root: string,
	) => Promise<PreparedProjectRootUpdate>;
	readonly onChanged?: (payload: JsonValue) => void;
}

/** Protocol operations plus the server-owned lifecycle hook. Pending provider
 * work is not renderer-owned: it must recover after a server restart even if
 * nobody opens the Project Environments surface. */
export interface ProjectEnvironmentOperationHandlers extends OperationRegistries {
	readonly recoverPending: (context: RequestContext) => Promise<void>;
}

/** Fixed UI-facing management surface. Provider configuration remains behind
 * server callbacks; values and raw provider errors never enter response DTOs. */
export function createProjectEnvironmentOperationHandlers(options: ProjectEnvironmentOperationOptions): ProjectEnvironmentOperationHandlers {
	let mutationTail: Promise<void> = Promise.resolve();
	const serialize = <T>(work: () => Promise<T>): Promise<T> => {
		const result = mutationTail.then(work, work);
		mutationTail = result.then(() => undefined, () => undefined);
		return result;
	};
	// Recovery is a mutation: a provider can advance a durable provisioning
	// operation while another client is reading it. Run it through the same queue
	// as user mutations so compare-and-swap commits cannot race. Crucially, a UI
	// snapshot must never wait for network/SSH recovery: that made opening the
	// chooser appear to hang whenever a VM was still booting or unreachable.
	const recoverPending = async (context: RequestContext): Promise<void> => serialize(() => resumePendingOperations(options, context));
	let recoveryRunning = false;
	let presentations = new Map<string, ProviderEnvironmentStatus>();
	const scheduleRecovery = (requestContext: RequestContext): void => {
		if (recoveryRunning) return;
		recoveryRunning = true;
		// A query transport can abort as soon as its snapshot is sent. Recovery
		// owns a fresh bounded signal instead of inheriting that renderer request.
		const controller = new AbortController();
		const context: RequestContext = {
			...requestContext,
			signal: controller.signal,
			deadline: Date.now() + 8_000,
			expectedRevision: undefined,
		};
		void (async () => {
			await recoverPending(context);
			// Provider cards (including the deliberate changed-host-key action) are
			// obtained off the read path too. A slow SSH verify must never hold the
			// picker hostage, but its eventual safe projection is retained for the
			// next lightweight snapshot.
			presentations = await refreshRuntimeStatuses(options, context);
		})().catch(() => undefined).finally(() => {
			recoveryRunning = false;
		});
	};
	const snapshot = async (context?: RequestContext): Promise<JsonValue> => {
		if (context !== undefined) scheduleRecovery(context);
		return snapshotDto(
			await options.repository.load(),
			options.workspace,
			options.providerDefinitions?.() ?? [],
			presentations,
		);
	};
	const commands = {
		[PROJECT_ENVIRONMENT_OPERATIONS.createProject]: async (request: CommandRequest) => {
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
			let prepared: PreparedProjectRootUpdate | undefined;
			// A newly-created This-server project has no workspace binding yet, so
			// its local filesystem root must be prepared directly before the
			// workspace publication. Remote environments keep their own validated
			// root lifecycle and must not be routed through an as-yet absent project.
			if (
				environment.id === THIS_SERVER_ENVIRONMENT_ID &&
				options.prepareProjectRootUpdate !== undefined
			) {
				try {
					prepared = await options.prepareProjectRootUpdate(projectId, root);
				} catch {
					throw failure('validation', 'project root is not an accessible directory', true);
				}
			}
			const canonicalRoot = prepared?.canonicalRoot ?? boundedRoot(root);
			const result = options.workspace.apply({ commandId: `env:${request.envelope.commandId}`.slice(0, 128), expectedRevision: request.context.expectedRevision, command: { type: 'project.create', projectId, viewId: text(payload, 'viewId', 256), root: canonicalRoot, rootOrigin: payload.root === undefined ? 'environment-default' : 'explicit', name: `Project ${Object.keys(options.workspace.state.projects).length + 1}`, projectEnvironmentId: environment.id, environmentRevision: environment.pinnedRevision } });
			if (!result.ok) throw failure('conflict', result.conflict.message);
			await prepared?.commit();
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
			/* Profile data and secrets are server-owned.  Updating a provider must
			 * therefore always use the profile broker, even when it already owns VM
			 * connections.  Calling an optional per-environment callback here used
			 * to bypass persistence for Puzed and fail with a generic VM error. */
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
			// Removing a saved provider is a local registry operation. Its child
			// connections are local records, so a generic runtime delete here could
			// destroy a real VM. Best-effort cleanup may release Terminay-owned
			// profile resources but may never delay or prevent the local removal.
			void removeProviderResources(options, profile, context);
			return { ...state, profiles: without(state.profiles, id), environments: Object.fromEntries(Object.entries(state.environments).filter(([, environment]) => environment.profileId !== id)) };
		}),
		[PROJECT_ENVIRONMENT_OPERATIONS.removeEnvironment]: async (request: CommandRequest) => {
			permission(request.context, 'environments:manage');
			const payload = exact(request.envelope.payload, ['environmentId']);
			return serialize(async () => {
				const state = await options.repository.load();
				if (request.context.expectedRevision !== undefined && request.context.expectedRevision !== state.revision) throw failure('conflict', 'project environment registry revision changed');
				const id = text(payload, 'environmentId', 256);
				const environment = state.environments[id];
				if (environment === undefined || environment.builtIn || environment.id === THIS_SERVER_ENVIRONMENT_ID) throw failure('forbidden', 'this project environment cannot be removed');
				if (Object.values(options.workspace.state.projects).some((project) => project.projectEnvironmentId === id)) throw failure('conflict', 'project environment is used by a project');
				/* This is a local forget operation. A Puzed connection is not
				 * authority to delete or power off the external VM. */
				const committed = await options.repository.commit(state.revision, (current) => ({
					...current,
					environments: without(current.environments, id),
					operations: Object.fromEntries(Object.entries(current.operations).filter(([, item]) => item.environmentId !== id)),
				}));
				changed(options, committed.revision);
				return { result: operation(request.envelope.commandId, { environmentId: id }), revision: committed.revision };
			});
		},
		[PROJECT_ENVIRONMENT_OPERATIONS.invokeAction]: async (request: CommandRequest) => {
			permission(request.context, 'environments:manage'); const payload = exact(request.envelope.payload, ['environmentId', 'actionId','values']); const state = await options.repository.load();if(request.context.expectedRevision!==undefined&&request.context.expectedRevision!==state.revision)throw failure('conflict','project environment registry revision changed');
			const environment = state.environments[text(payload, 'environmentId', 256)]; if (environment === undefined) throw failure('not_found', 'project environment was not found');
			const context=providerContext(request.context,request.envelope.commandId); const actionId=text(payload, 'actionId', 256);
			if(options.providerRuntime===undefined){await requiredProvider(options).invokeAction?.(environment,actionId,context);return {result:operation(request.envelope.commandId,{environmentId:environment.id}),revision:state.revision};}
			const outcome=await runtimeAction(options,environment,'invokeAction',{environmentId:environment.id,...(environment.profileId===undefined?{}:{profileId:environment.profileId}),providerState:environment.providerState,actionId,values:(payload.values===undefined?{}:values(payload.values)) as Record<string,JsonValue>},context,request.envelope.commandId,state.revision);
			const committed=await commitRuntimeActionOutcome(options,state,environment.id,outcome,request.envelope.commandId); changed(options,committed.revision);
			return {result:operationDto(committed.operations[request.envelope.commandId]),revision:committed.revision};
		},
	} satisfies OperationRegistries['commands'];
	const queries={ [PROJECT_ENVIRONMENT_OPERATIONS.snapshot]: async (request: QueryRequest) => { permission(request.context, 'environments:read'); exact(request.envelope.payload, []); return snapshot(request.context); }, [PROJECT_ENVIRONMENT_OPERATIONS.resolveOptions]:async(request: QueryRequest)=>{permission(request.context,'environments:read');const payload=exact(request.envelope.payload,['providerId','sourceId','profileId','query','cursor','values']);return runtimeCall<JsonValue>(options,text(payload,'providerId',256),'resolveOptions',{sourceId:text(payload,'sourceId',256),...(payload.profileId===undefined?{}:{profileId:text(payload,'profileId',256)}),...(payload.query===undefined?{}:{query:text(payload,'query',1024)}),...(payload.cursor===undefined?{}:{cursor:text(payload,'cursor',1024)}),values:values(payload.values) as Record<string,JsonValue>},providerContext(request.context));}};
	return { queries, commands, policies: { ...Object.fromEntries(Object.keys(queries).map(name=>[name,{scope:'read'}])), ...Object.fromEntries(Object.keys(commands).map((name) => [name, { scope: 'write' }])) }, recoverPending };
}

function mutation(options: ProjectEnvironmentOperationOptions, serialize: <T>(work: () => Promise<T>) => Promise<T>, update: (state: ProjectEnvironmentState, payload: Record<string, JsonValue>, context: ProviderControlContext) => Promise<ProjectEnvironmentState>) {
	return async (request: CommandRequest) => { permission(request.context, 'environments:manage'); const payload = exact(request.envelope.payload, ['providerId', 'profileId', 'values']); return serialize(async () => { const before = await options.repository.load(); const expected = request.context.expectedRevision ?? before.revision; if (expected !== before.revision) throw failure('conflict', 'project environment registry revision changed'); const proposed = await update(before, payload, providerContext(request.context,request.envelope.commandId)); const committed = await options.repository.commit(expected, () => proposed); changed(options, committed.revision); const durable=committed.operations[request.envelope.commandId]; return { result: durable===undefined?operation(request.envelope.commandId):operationDto(durable), revision: committed.revision }; }); };
}
function providerOnly(options: ProjectEnvironmentOperationOptions, method: 'testProfile') { return async (request: CommandRequest) => { permission(request.context, 'environments:manage'); const payload = exact(request.envelope.payload, ['profileId']); const state = await options.repository.load(); const profile = state.profiles[text(payload, 'profileId', 256)]; if (profile === undefined) throw failure('not_found', 'environment profile was not found'); await requiredProvider(options)[method]?.(profile, providerContext(request.context)); return { result: operation(request.envelope.commandId), revision: state.revision }; }; }
function snapshotDto(state: ProjectEnvironmentState, workspace: WorkspaceStore, definitions: readonly ProviderDefinition[] = [],presentations:ReadonlyMap<string,ProviderEnvironmentStatus>=new Map()): JsonValue { const refs = new Map<string, number>(); for (const project of Object.values(workspace.state.projects)) refs.set(project.projectEnvironmentId, (refs.get(project.projectEnvironmentId) ?? 0) + 1); return { revision: state.revision, providers: [{ providerId:'terminay:this-server', displayName:'This server', capabilities:['terminal','filesystem'] }, ...definitions.map(providerDto)], profiles: Object.values(state.profiles).filter((profile)=>!profile.archived).map((profile)=>({id:profile.id,providerId:profile.providerId,name:profile.name,endpointSummary:profile.endpointSummary,...(profile.defaultRoot===undefined?{}:{defaultRoot:profile.defaultRoot}),initialValues:safeProfileInitialValues(profile)})), environments: Object.values(state.environments).sort((a,b) => a.name.localeCompare(b.name)).map((environment) => { const presentation=presentations.get(environment.id); return { id: environment.id, providerId: environment.providerId, providerLabel: environment.builtIn ? 'This Terminay Server' : environment.providerId, ...(environment.profileId === undefined ? {} : { profileId: environment.profileId }), name: environment.name, endpointSummary: environment.endpointSummary, ...(environment.defaultRoot === undefined ? {} : { defaultRoot: environment.defaultRoot }), status: presentation === undefined ? environment.status : domainStatus(presentation), referencedProjectCount: refs.get(environment.id) ?? 0, ...(environment.id === THIS_SERVER_ENVIRONMENT_ID ? { isThisServer: true } : {}),...(presentation?.card===undefined?{}:{statusCard:presentation.card as unknown as JsonValue}) }; }) } as JsonValue; }
function safeProfileInitialValues(profile: EnvironmentProfile): Record<string, string | boolean> { const revision = profile.revisions[String(profile.activeRevision)]; if (revision === undefined || typeof revision.configuration !== 'object' || revision.configuration === null || Array.isArray(revision.configuration)) return {}; const secretFields = new Set(revision.secretReferences.flatMap((reference) => { const delimiter = reference.indexOf('='); return delimiter > 0 ? [reference.slice(0, delimiter)] : []; })); return Object.fromEntries(Object.entries(revision.configuration).flatMap(([key, value]) => key === 'profile-id' || secretFields.has(key) || key.length === 0 || key.length > 256 || (typeof value !== 'string' && typeof value !== 'boolean') || (typeof value === 'string' && (value.length > 16_384 || value.includes('\0'))) ? [] : [[key, value]])); }
function providerDto(definition: ProviderDefinition): JsonValue { return { providerId: definition.providerId, displayName: definition.displayName, ...(definition.description === undefined ? {} : { description: definition.description }), capabilities: [...definition.capabilities], ...(definition.profileForm === undefined ? {} : { profileForm: structuredClone(definition.profileForm) }), ...(definition.createForm === undefined ? {} : { createForm: structuredClone(definition.createForm) }), ...(definition.browseForm === undefined ? {} : { browseForm: structuredClone(definition.browseForm) }) } as unknown as JsonValue; }
function mergeProviderResult(state: ProjectEnvironmentState, result: { profile: EnvironmentProfile; environments?: readonly ProjectEnvironmentRecord[] }): ProjectEnvironmentState { return { ...state, profiles: { ...state.profiles, [result.profile.id]: result.profile }, environments: { ...state.environments, ...Object.fromEntries((result.environments ?? []).map((environment) => [environment.id, environment])) } }; }
async function createRuntimeEnvironment(options:ProjectEnvironmentOperationOptions,state:ProjectEnvironmentState,providerId:string,definition:ProviderDefinition,formValues:Record<string,JsonValue>,context:ProviderControlContext,profileId?:string):Promise<ProjectEnvironmentState>{
	const machineId=typeof formValues.machineId==='string'&&formValues.machineId.length>0?formValues.machineId:undefined;
	const existing=machineId===undefined||profileId===undefined?undefined:Object.values(state.environments).find((environment)=>environment.profileId===profileId&&environmentMachineId(environment)===machineId);
	const id=existing?.id??runtimeId(`env:${context.idempotencyKey??Date.now()}`);
	if(existing===undefined&&state.environments[id]!==undefined)return state;
	const issues=await runtimeCall<readonly unknown[]>(options,providerId,'testProfile',{...(profileId===undefined?{}:{profileId}),values:formValues},context);if(issues.length>0)throw failure('validation',providerValidationMessage(issues));
	const result=await runtimeCall<ProvisioningResult>(options,providerId,'createEnvironment',{environmentId:id,displayName:typeof formValues.name==='string'&&formValues.name.length>0?formValues.name:existing?.name??definition.displayName,...(profileId===undefined?{}:{profileId}),values:formValues},context);
	const now=Date.now(); const providerState=result.providerState;
	const status=result.state==='ready'?result.status:undefined;
	const displayName=typeof formValues.name==='string'&&formValues.name.length>0?formValues.name:providerDisplayName(providerState)??existing?.name??definition.displayName;
	const environment:ProjectEnvironmentRecord={id,providerId,...(profileId===undefined?{}:{profileId}),pinnedRevision:existing?.pinnedRevision??1,name:displayName,endpointSummary:definition.displayName,declaredCapabilities:definition.capabilities.filter(domainCapability) as ProjectEnvironmentRecord['declaredCapabilities'],availableCapabilities:result.state==='ready'?definition.capabilities.filter(domainCapability) as ProjectEnvironmentRecord['availableCapabilities']:[],status:status===undefined?'provisioning':domainStatus(status),...(status?.defaultRoot===undefined?{}:{defaultRoot:status.defaultRoot}),...(status===undefined?{}:{lastSuccessfulCheck:now}),operationReferences:result.state==='pending'?[context.idempotencyKey??id]:[],projectReferenceCount:existing?.projectReferenceCount??0,archived:false,builtIn:false,providerState,providerRevision:status?.revision??existing?.providerRevision??1};
	if(result.state==='ready')return {...state,environments:{...state.environments,[id]:environment}};
	const operationId=runtimeId(context.idempotencyKey??`operation:${id}`);
	return {...state,environments:{...state.environments,[id]:{...environment,operationReferences:[operationId]}},operations:{...state.operations,[operationId]:{id:operationId,providerId,environmentId:id,kind:'create',state:'pending',providerOperationId:runtimeId(result.operationId),providerState,progress:result.progress as unknown as JsonValue,createdAt:now,updatedAt:now,revision:1}}};
}
async function runtimeCall<T>(options:ProjectEnvironmentOperationOptions,providerId:string,callback:ExtensionProviderInvocation['callback'],request:JsonValue,context:ProviderControlContext):Promise<T>{if(options.providerRuntime===undefined)throw failure('unavailable','project environment provider runtime is unavailable',true);const remaining=context.deadline===undefined?30000:Math.max(1,context.deadline-Date.now());try{return await options.providerRuntime.invokeProvider({providerId,callback,request,deadlineMs:remaining,...(context.idempotencyKey===undefined?{}:{idempotencyKey:context.idempotencyKey}),...(context.expectedRevision===undefined?{}:{expectedRevision:context.expectedRevision}),signal:context.signal}) as T;}catch(error){throw failure('unavailable',publicProviderOperationMessage(providerId,error)??providerOperationMessage(options,providerId,callback),true);}}
async function runtimeAction(options:ProjectEnvironmentOperationOptions,environment:ProjectEnvironmentRecord,callback:ExtensionProviderInvocation['callback'],request:JsonValue,context:ProviderControlContext,idempotencyKey?:string,expectedRevision?:number):Promise<EnvironmentActionResult>{return runtimeCall(options,environment.providerId,callback,request,{...context,...(idempotencyKey===undefined?{}:{idempotencyKey}),...(expectedRevision===undefined?{}:{expectedRevision})});}
async function removeProviderResources(options:ProjectEnvironmentOperationOptions,profile:EnvironmentProfile,context:ProviderControlContext):Promise<void>{
	try { await options.providers?.removeProfile?.(profile,context); } catch { /* Local removal already committed. */ }
}
function applyRuntimeOutcome(state:ProjectEnvironmentState,environment:ProjectEnvironmentRecord,outcome:EnvironmentActionResult,id:string,kind:string,now:number,options:ProjectEnvironmentOperationOptions):ProjectEnvironmentState{const operationId=runtimeId(id);if(outcome.state==='complete'){const updated=environmentFromStatus(environment,outcome.providerState,outcome.status,now,currentDeclaredCapabilities(environment,options));const operations=environment.status==='provisioning'&&outcome.status.state==='available'?Object.fromEntries(Object.entries(state.operations).map(([key,operation])=>operation.environmentId===environment.id&&(operation.state==='pending'||operation.state==='running')?[key,{...operation,state:'succeeded' as const,providerState:outcome.providerState,updatedAt:now,revision:operation.revision+1}]:[key,operation])):state.operations;return {...state,environments:{...state.environments,[environment.id]:updated},operations:{...operations,[operationId]:{id:operationId,providerId:environment.providerId,environmentId:environment.id,kind,state:'succeeded',providerState:outcome.providerState,createdAt:now,updatedAt:now,revision:1}}};}return {...state,environments:{...state.environments,[environment.id]:{...environment,status:'provisioning',availableCapabilities:[],providerState:outcome.providerState,operationReferences:[...new Set([...environment.operationReferences,operationId])]}},operations:{...state.operations,[operationId]:{id:operationId,providerId:environment.providerId,environmentId:environment.id,kind,state:'pending',providerOperationId:runtimeId(outcome.operationId),providerState:outcome.providerState,progress:outcome.progress as unknown as JsonValue,createdAt:now,updatedAt:now,revision:1}}};}
/** Provider actions can take long enough for asynchronous status recovery to
 * publish a newer registry revision. Rebase the action result instead of
 * falsely reporting a conflict to the user after the provider already acted. */
async function commitRuntimeActionOutcome(options:ProjectEnvironmentOperationOptions,state:ProjectEnvironmentState,environmentId:string,outcome:EnvironmentActionResult,commandId:string):Promise<ProjectEnvironmentState>{
	for(let attempt=0;attempt<3;attempt++){
		const environment=state.environments[environmentId];
		if(environment===undefined)throw failure('not_found','project environment was not found');
		try{return await options.repository.commit(state.revision,current=>applyRuntimeOutcome(current,environment,outcome,commandId,'action',Date.now(),options));}
		catch(error){if(attempt===2||!isProjectEnvironmentConflict(error))throw error;state=await options.repository.load();}
	}
	return state;
}
function environmentFromStatus(environment:ProjectEnvironmentRecord,providerState:JsonValue,status:ProviderEnvironmentStatus,now:number,declaredCapabilities:ProjectEnvironmentRecord['declaredCapabilities']=environment.declaredCapabilities):ProjectEnvironmentRecord{return {...environment,providerState,providerRevision:status.revision,status:domainStatus(status),...(status.defaultRoot===undefined?{}:{defaultRoot:status.defaultRoot}),declaredCapabilities,availableCapabilities:status.state==='available'?declaredCapabilities:[],lastSuccessfulCheck:status.state==='available'?now:environment.lastSuccessfulCheck,operationReferences:[]};}
function currentDeclaredCapabilities(environment:ProjectEnvironmentRecord,options:ProjectEnvironmentOperationOptions):ProjectEnvironmentRecord['declaredCapabilities']{const definition=options.providerDefinitions?.().find((item)=>item.providerId===environment.providerId);if(definition===undefined)return environment.declaredCapabilities;return definition.capabilities.filter(domainCapability) as ProjectEnvironmentRecord['declaredCapabilities'];}
/**
 * Pending operations must not share one deadline.  A historical VM can be
 * waiting for an unreachable SSH service for its entire bounded attempt; if
 * that consumed the snapshot recovery budget, newer creations were never even
 * allowed to ask Puzed whether their job had finished.  Work newest-first and
 * give each operation its own short, abortable recovery window.
 */
async function resumePendingOperations(options:ProjectEnvironmentOperationOptions,requestContext:RequestContext):Promise<void>{if(options.providerRuntime===undefined)return;let state=await options.repository.load();const pendingOperations=Object.values(state.operations).filter(item=>item.state==='pending'||item.state==='running').sort((left,right)=>right.updatedAt-left.updatedAt);for(const pending of pendingOperations){const environment=state.environments[pending.environmentId];if(environment===undefined)continue;const controller=new AbortController();const abort=()=>controller.abort();if(requestContext.signal.aborted)abort();else requestContext.signal.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,8_000);const context:RequestContext={...requestContext,signal:controller.signal,deadline:Date.now()+8_000,expectedRevision:undefined};try{const result=await runtimeCall<ProvisioningResult>(options,pending.providerId,'resumeOperation',{environmentId:environment.id,...(environment.profileId===undefined?{}:{profileId:environment.profileId}),providerState:pending.providerState,operationId:pending.providerOperationId??pending.id},providerContext(context,pending.id));state=await commitResumedOperation(options,state,pending.id,result);changed(options,state.revision);}catch{ /* Durable pending state remains retryable; raw provider errors are not persisted. */ }finally{clearTimeout(timer);requestContext.signal.removeEventListener('abort',abort);}} }

/** A provider call can take long enough for another server-side mutation to
 * commit.  Its result is still valid for this operation, so rebase it onto the
 * latest registry rather than silently losing the post-create transition. */
async function commitResumedOperation(options:ProjectEnvironmentOperationOptions,state:ProjectEnvironmentState,operationId:string,result:ProvisioningResult):Promise<ProjectEnvironmentState>{
	for(let attempt=0;attempt<3;attempt++){
		const pending=state.operations[operationId];const environment=pending===undefined?undefined:state.environments[pending.environmentId];
		if(pending===undefined||environment===undefined||!(pending.state==='pending'||pending.state==='running'))return state;
		const now=Date.now();
		const proposed=result.state==='ready'?{...state,environments:{...state.environments,[environment.id]:environmentFromStatus(environment,result.providerState,result.status,now,currentDeclaredCapabilities(environment,options))},operations:{...state.operations,[pending.id]:{...pending,state:'succeeded' as const,providerState:result.providerState,updatedAt:now,revision:pending.revision+1}}}:{...state,environments:{...state.environments,[environment.id]:{...environment,providerState:result.providerState,status:'provisioning' as const}},operations:{...state.operations,[pending.id]:{...pending,state:'running' as const,providerOperationId:runtimeId(result.operationId),providerState:result.providerState,progress:result.progress as unknown as JsonValue,updatedAt:now,revision:pending.revision+1}}};
		try{return await options.repository.commit(state.revision,()=>proposed);}catch(error){if(attempt===2||!isProjectEnvironmentConflict(error))throw error;state=await options.repository.load();}
	}
	return state;
}
function isProjectEnvironmentConflict(error:unknown):error is ProjectEnvironmentConflictError{return error instanceof ProjectEnvironmentConflictError;}
async function refreshRuntimeStatuses(options:ProjectEnvironmentOperationOptions,requestContext:RequestContext):Promise<Map<string,ProviderEnvironmentStatus>>{const presentations=new Map<string,ProviderEnvironmentStatus>();if(options.providerRuntime===undefined)return presentations;let state=await options.repository.load();for(const environment of Object.values(state.environments).filter(item=>!item.builtIn)){try{const status=await runtimeCall<ProviderEnvironmentStatus>(options,environment.providerId,'getStatus',{environmentId:environment.id,...(environment.profileId===undefined?{}:{profileId:environment.profileId}),providerState:environment.providerState},providerContext(requestContext));presentations.set(environment.id,status);/* A durable operation remains the lifecycle authority while provisioning.
   * Its provider may still expose a safe status card (for example changed-key
   * approval) but must not be promoted or demoted by a concurrent refresh. */if(environment.status==='provisioning')continue;const next=environmentFromStatus(environment,environment.providerState,status,Date.now(),currentDeclaredCapabilities(environment,options));if(JSON.stringify(next)===JSON.stringify(environment))continue;state=await options.repository.commit(state.revision,current=>({...current,environments:{...current.environments,[environment.id]:next}}));changed(options,state.revision);}catch{/* Existing safe state remains visible while provider is unavailable. */}}return presentations;}
function operationDto(value:import('./types.js').ProjectEnvironmentOperationRecord|undefined):JsonValue{if(value===undefined)throw failure('not_found','project environment operation was not found');return {operationId:value.id,state:value.state,...(value.progress===undefined?{}:{stage:progressStage(value.progress),progress:progressFraction(value.progress)}),environmentId:value.environmentId};}
function progressStage(value:JsonValue):string{if(typeof value==='object'&&value!==null&&!Array.isArray(value)&&Array.isArray(value.stages)){const stages=value.stages as Array<Record<string,unknown>>;const stage=stages.find(item=>item?.state==='active')??stages.at(-1);if(typeof stage?.label==='string')return stage.label.slice(0,256);}return 'working';}
function progressFraction(value:JsonValue):number{if(typeof value==='object'&&value!==null&&!Array.isArray(value)&&Array.isArray(value.stages)&&value.stages.length>0){const complete=value.stages.filter((item: JsonValue)=>typeof item==='object'&&item!==null&&!Array.isArray(item)&&item.state==='complete').length;return Math.max(0,Math.min(1,complete/value.stages.length));}return 0;}
function domainStatus(status:ProviderEnvironmentStatus):ProjectEnvironmentRecord['status']{return status.state==='available'?'ready':status.state==='connecting'?'connecting':status.state==='unavailable'?'offline':status.state==='deleting'?'stopping':'failed';}
/** testProfile's structured issues are the provider's explicit public validation
 * channel. Do not expose thrown extension errors; they can contain provider
 * implementation details or secrets. */
function providerValidationMessage(issues:readonly unknown[]):string{const messages=[...new Set(issues.flatMap((issue)=>{if(typeof issue!=='object'||issue===null||Array.isArray(issue))return [];const message=(issue as Record<string,unknown>).message;return typeof message==='string'?[message.replace(/[\r\n\0]+/gu,' ').trim().slice(0,500)]:[];}).filter(Boolean))].slice(0,5);return messages.length>0?messages.join('; '):'project environment configuration is invalid';}
function providerOperationMessage(options:ProjectEnvironmentOperationOptions,providerId:string,callback:ExtensionProviderInvocation['callback']):string{const name=options.providerDefinitions?.().find((definition)=>definition.providerId===providerId)?.displayName??'The selected provider';if(callback==='createEnvironment')return `${name} could not create this environment. Check the selected values and provider connection, then try again.`;if(callback==='resolveOptions')return `${name} could not load these options. Check the provider connection, then try again.`;if(callback==='testProfile')return `${name} could not validate this configuration. Check the provider connection, then try again.`;return `${name} could not complete this operation. Check the provider connection, then try again.`;}
/** Only a provider's explicit, operation-specific public errors may cross this
 * boundary. All other thrown extension errors remain redacted above. */
function publicProviderOperationMessage(providerId:string,error:unknown):string|undefined{if(providerId!=='com.puzed.platform/vm'||!(error instanceof Error))return undefined;const message=error.message.replace(/[\r\n\0]+/gu,' ').trim();return /^Puzed rejected VM creation \(HTTP [1-5][0-9]{2}, [a-z0-9_]{1,64}\)\.$/u.test(message)?message:undefined;}
function domainCapability(value:string):value is ProjectEnvironmentRecord['declaredCapabilities'][number]{return ['terminal','filesystem','filesystem-observation','git','process-observation','agent-journal','infrastructure','shell-discovery'].includes(value);}

function environmentMachineId(environment:ProjectEnvironmentRecord):string|undefined{const value=environment.providerState;if(typeof value!=='object'||value===null||Array.isArray(value))return undefined;const machineId=value.machineId;return typeof machineId==='string'&&machineId.length>0?machineId:undefined;}
function providerDisplayName(providerState:JsonValue):string|undefined{if(typeof providerState!=='object'||providerState===null||Array.isArray(providerState))return undefined;const name=providerState.displayName;return typeof name==='string'&&name.length>0?name:undefined;}
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
