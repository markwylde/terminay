import type { JsonValue, ProtocolId } from '@terminay/protocol';
import type { ProviderDefinition } from '@terminay/extension-api';
import type { OperationRegistries, RequestContext } from '../types.js';
import { THIS_SERVER_ENVIRONMENT_ID, type WorkspaceStore } from '../workspace.js';
import type { ProjectEnvironmentRepository } from './repository.js';
import type { EnvironmentProfile, ProjectEnvironmentRecord, ProjectEnvironmentState } from './types.js';

export const PROJECT_ENVIRONMENT_OPERATIONS = Object.freeze({
	snapshot: 'projectEnvironments.snapshot', createProject: 'projectEnvironments.createProject',
	createProfile: 'projectEnvironments.createProfile', updateProfile: 'projectEnvironments.updateProfile',
	testProfile: 'projectEnvironments.testProfile', removeProfile: 'projectEnvironments.removeProfile',
	invokeAction: 'projectEnvironments.invokeAction',
} as const);

export interface ProjectEnvironmentProviderControl {
	createProfile?(providerId: ProtocolId, values: Readonly<Record<string, string | boolean>>, context: ProviderControlContext): Promise<{ profile: EnvironmentProfile; environments?: readonly ProjectEnvironmentRecord[] }>;
	updateProfile?(profile: EnvironmentProfile, values: Readonly<Record<string, string | boolean>>, context: ProviderControlContext): Promise<{ profile: EnvironmentProfile; environments?: readonly ProjectEnvironmentRecord[] }>;
	testProfile?(profile: EnvironmentProfile, context: ProviderControlContext): Promise<void>;
	removeProfile?(profile: EnvironmentProfile, context: ProviderControlContext): Promise<void>;
	invokeAction?(environment: ProjectEnvironmentRecord, actionId: string, context: ProviderControlContext): Promise<void>;
	validateRoot?(environment: ProjectEnvironmentRecord, root: string | undefined, context: ProviderControlContext): Promise<string>;
}
export interface ProviderControlContext { readonly clientId: ProtocolId; readonly signal: AbortSignal; readonly deadline?: number; }
export interface ProjectEnvironmentOperationOptions {
	readonly repository: ProjectEnvironmentRepository;
	readonly workspace: WorkspaceStore;
	readonly providers?: ProjectEnvironmentProviderControl;
	readonly providerDefinitions?: () => readonly ProviderDefinition[];
	readonly thisServerRoot: () => string | Promise<string>;
	readonly onChanged?: (payload: JsonValue) => void;
}

/** Fixed UI-facing management surface. Provider configuration remains behind
 * server callbacks; values and raw provider errors never enter response DTOs. */
export function createProjectEnvironmentOperationHandlers(options: ProjectEnvironmentOperationOptions): OperationRegistries {
	const snapshot = async (): Promise<JsonValue> => snapshotDto(await options.repository.load(), options.workspace, options.providerDefinitions?.() ?? []);
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
			const created = await requiredProvider(options).createProfile?.(text(payload, 'providerId', 256), values(payload.values), context);
			if (created === undefined) throw failure('unavailable', 'project environment provider does not support profiles', true);
			if (state.profiles[created.profile.id] !== undefined) throw failure('conflict', 'environment profile already exists');
			return mergeProviderResult(state, created);
		}),
		[PROJECT_ENVIRONMENT_OPERATIONS.updateProfile]: mutation(options, serialize, async (state, payload, context) => {
			const id = text(payload, 'profileId', 256); const profile = state.profiles[id]; if (profile === undefined) throw failure('not_found', 'environment profile was not found');
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
			await requiredProvider(options).removeProfile?.(profile, context);
			return { ...state, profiles: without(state.profiles, id), environments: Object.fromEntries(Object.entries(state.environments).filter(([, environment]) => environment.profileId !== id)) };
		}),
		[PROJECT_ENVIRONMENT_OPERATIONS.invokeAction]: async (request: any) => {
			permission(request.context, 'environments:manage'); const payload = exact(request.envelope.payload, ['environmentId', 'actionId']); const state = await options.repository.load();
			const environment = state.environments[text(payload, 'environmentId', 256)]; if (environment === undefined) throw failure('not_found', 'project environment was not found');
			await requiredProvider(options).invokeAction?.(environment, text(payload, 'actionId', 256), providerContext(request.context));
			return { result: operation(request.envelope.commandId, { environmentId: environment.id }), revision: state.revision };
		},
	} satisfies Record<string, any>;
	return { queries: { [PROJECT_ENVIRONMENT_OPERATIONS.snapshot]: async (request) => { permission(request.context, 'environments:read'); exact(request.envelope.payload, []); return snapshot(); } }, commands, policies: { [PROJECT_ENVIRONMENT_OPERATIONS.snapshot]: { scope: 'read' }, ...Object.fromEntries(Object.keys(commands).map((name) => [name, { scope: 'write' }])) } };
}

function mutation(options: ProjectEnvironmentOperationOptions, serialize: <T>(work: () => Promise<T>) => Promise<T>, update: (state: ProjectEnvironmentState, payload: Record<string, JsonValue>, context: ProviderControlContext) => Promise<ProjectEnvironmentState>) {
	return async (request: any) => { permission(request.context, 'environments:manage'); const payload = exact(request.envelope.payload, ['providerId', 'profileId', 'values']); return serialize(async () => { const before = await options.repository.load(); const expected = request.context.expectedRevision ?? before.revision; if (expected !== before.revision) throw failure('conflict', 'project environment registry revision changed'); const proposed = await update(before, payload, providerContext(request.context)); const committed = await options.repository.commit(expected, () => proposed); changed(options, committed.revision); return { result: operation(request.envelope.commandId), revision: committed.revision }; }); };
}
function providerOnly(options: ProjectEnvironmentOperationOptions, method: 'testProfile') { return async (request: any) => { permission(request.context, 'environments:manage'); const payload = exact(request.envelope.payload, ['profileId']); const state = await options.repository.load(); const profile = state.profiles[text(payload, 'profileId', 256)]; if (profile === undefined) throw failure('not_found', 'environment profile was not found'); await requiredProvider(options)[method]?.(profile, providerContext(request.context)); return { result: operation(request.envelope.commandId), revision: state.revision }; }; }
function snapshotDto(state: ProjectEnvironmentState, workspace: WorkspaceStore, definitions: readonly ProviderDefinition[] = []): JsonValue { const refs = new Map<string, number>(); for (const project of Object.values(workspace.state.projects)) refs.set(project.projectEnvironmentId, (refs.get(project.projectEnvironmentId) ?? 0) + 1); return { revision: state.revision, providers: [{ providerId:'terminay:this-server', displayName:'This server', capabilities:['terminal','filesystem'] }, ...definitions.map(providerDto)], environments: Object.values(state.environments).sort((a,b) => a.name.localeCompare(b.name)).map((environment) => ({ id: environment.id, providerId: environment.providerId, providerLabel: environment.builtIn ? 'This Terminay Server' : environment.providerId, ...(environment.profileId === undefined ? {} : { profileId: environment.profileId }), name: environment.name, endpointSummary: environment.endpointSummary, ...(environment.defaultRoot === undefined ? {} : { defaultRoot: environment.defaultRoot }), status: environment.status, referencedProjectCount: refs.get(environment.id) ?? 0, ...(environment.id === THIS_SERVER_ENVIRONMENT_ID ? { isThisServer: true } : {}) })) } as JsonValue; }
function providerDto(definition: ProviderDefinition): JsonValue { return { providerId: definition.providerId, displayName: definition.displayName, ...(definition.description === undefined ? {} : { description: definition.description }), capabilities: [...definition.capabilities], ...(definition.profileForm === undefined ? {} : { profileForm: structuredClone(definition.profileForm) }), ...(definition.createForm === undefined ? {} : { createForm: structuredClone(definition.createForm) }) } as unknown as JsonValue; }
function mergeProviderResult(state: ProjectEnvironmentState, result: { profile: EnvironmentProfile; environments?: readonly ProjectEnvironmentRecord[] }): ProjectEnvironmentState { return { ...state, profiles: { ...state.profiles, [result.profile.id]: result.profile }, environments: { ...state.environments, ...Object.fromEntries((result.environments ?? []).map((environment) => [environment.id, environment])) } }; }
function operation(id: string, result: { environmentId?: string; projectId?: string } = {}): JsonValue { return { operationId: id, state: 'succeeded', stage: 'complete', progress: 1, ...result }; }
function changed(options: ProjectEnvironmentOperationOptions, revision: number): void { options.onChanged?.({ revision }); }
function providerContext(context: RequestContext): ProviderControlContext { return { clientId: context.clientId, signal: context.signal, ...(context.deadline === undefined ? {} : { deadline: context.deadline }) }; }
function requiredProvider(options: ProjectEnvironmentOperationOptions): ProjectEnvironmentProviderControl { if (options.providers === undefined) throw failure('unavailable', 'project environment provider is unavailable', true); return options.providers; }
function permission(context: RequestContext, required: string): void { if (!context.permissions?.includes(required)) throw failure('forbidden', `permission ${required} is required`); }
function exact(value: unknown, allowed: readonly string[]): Record<string, JsonValue> { if (typeof value !== 'object' || value === null || Array.isArray(value)) throw failure('validation', 'project environment request is invalid'); const result = value as Record<string, JsonValue>; for (const key of Object.keys(result)) if (!allowed.includes(key)) throw failure('validation', 'project environment request contains an unsupported field'); return result; }
function text(value: Record<string, JsonValue>, key: string, max: number): string { const candidate = value[key]; if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > max || candidate.includes('\0')) throw failure('validation', `${key} is invalid`); return candidate; }
function values(value: JsonValue | undefined): Readonly<Record<string, string | boolean>> { if (typeof value !== 'object' || value === null || Array.isArray(value)) throw failure('validation', 'profile values are invalid'); const entries = Object.entries(value); if (entries.length > 128 || entries.some(([key, item]) => key.length === 0 || key.length > 256 || (typeof item !== 'string' && typeof item !== 'boolean') || (typeof item === 'string' && item.length > 16384))) throw failure('validation', 'profile values are invalid'); return value as Record<string, string | boolean>; }
function boundedRoot(value: string): string { if (value.length === 0 || value.length > 4096 || value.includes('\0')) throw failure('validation', 'project root is invalid'); return value; }
function uniqueId(candidate: string, existing: Readonly<Record<string, unknown>>): string { let id = candidate.slice(0,128); let suffix = 1; while (existing[id] !== undefined) id = `${candidate.slice(0, 118)}:${suffix++}`; return id; }
function without<T>(record: Readonly<Record<string,T>>, id: string): Record<string,T> { return Object.fromEntries(Object.entries(record).filter(([key]) => key !== id)); }
function failure(code: 'validation'|'not_found'|'conflict'|'forbidden'|'unavailable', message: string, retryable=false): Error & { code:string; retryable:boolean } { return Object.assign(new Error(message), { code, retryable }); }
