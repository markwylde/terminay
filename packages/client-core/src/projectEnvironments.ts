import type { JsonValue } from '@terminay/protocol';
import type { QueryCommandTransport } from './queryCommand.js';
import type { CommandOptions, QueryOptions } from './types.js';

export const PROJECT_ENVIRONMENT_OPERATIONS = Object.freeze({
	snapshot: 'projectEnvironments.snapshot',
	createProject: 'projectEnvironments.createProject',
	createProfile: 'projectEnvironments.createProfile',
	updateProfile: 'projectEnvironments.updateProfile',
	testProfile: 'projectEnvironments.testProfile',
	removeProfile: 'projectEnvironments.removeProfile',
	invokeAction: 'projectEnvironments.invokeAction',
} as const);

export type ProjectEnvironmentClientStatus = 'ready' | 'connecting' | 'reconnecting' | 'provisioning' | 'starting' | 'stopping' | 'offline' | 'authentication-required' | 'host-key-changed' | 'permission-denied' | 'extension-missing' | 'extension-disabled' | 'extension-incompatible' | 'unreachable' | 'failed';
export interface ProjectEnvironmentClientSummary { readonly id: string; readonly providerId: string; readonly providerLabel: string; readonly name: string; readonly endpointSummary: string; readonly defaultRoot?: string; readonly status: ProjectEnvironmentClientStatus; readonly referencedProjectCount: number; readonly isThisServer?: boolean; readonly isFavourite?: boolean; readonly lastUsedAt?: string; }
export interface ProjectEnvironmentClientSnapshot { readonly revision: number; readonly environments: readonly ProjectEnvironmentClientSummary[]; }
export interface ProjectEnvironmentOperation { readonly operationId: string; readonly state: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'; readonly stage?: string; readonly progress?: number; readonly message?: string; readonly environmentId?: string; readonly projectId?: string; }

export class ProjectEnvironmentsClient {
	constructor(private readonly transport: QueryCommandTransport) {}
	async snapshot(options: QueryOptions = {}): Promise<ProjectEnvironmentClientSnapshot> { return parseSnapshot(await this.transport.query(PROJECT_ENVIRONMENT_OPERATIONS.snapshot, {}, options)); }
	async createProject(request: { environmentId: string; viewId: string; root?: string }, options: CommandOptions = {}): Promise<ProjectEnvironmentOperation> { return parseOperation(await this.transport.command(PROJECT_ENVIRONMENT_OPERATIONS.createProject, boundedPayload(request), options)); }
	async createProfile(providerId: string, values: Readonly<Record<string, string | boolean>>, options: CommandOptions = {}): Promise<ProjectEnvironmentOperation> { return parseOperation(await this.transport.command(PROJECT_ENVIRONMENT_OPERATIONS.createProfile, { providerId: text(providerId, 256), values: formValues(values) }, options)); }
	async updateProfile(profileId: string, values: Readonly<Record<string, string | boolean>>, options: CommandOptions = {}): Promise<ProjectEnvironmentOperation> { return parseOperation(await this.transport.command(PROJECT_ENVIRONMENT_OPERATIONS.updateProfile, { profileId: text(profileId, 256), values: formValues(values) }, options)); }
	async testProfile(profileId: string, options: CommandOptions = {}): Promise<ProjectEnvironmentOperation> { return parseOperation(await this.transport.command(PROJECT_ENVIRONMENT_OPERATIONS.testProfile, { profileId: text(profileId, 256) }, options)); }
	async removeProfile(profileId: string, options: CommandOptions = {}): Promise<ProjectEnvironmentOperation> { return parseOperation(await this.transport.command(PROJECT_ENVIRONMENT_OPERATIONS.removeProfile, { profileId: text(profileId, 256) }, options)); }
	async invokeAction(environmentId: string, actionId: string, options: CommandOptions = {}): Promise<ProjectEnvironmentOperation> { return parseOperation(await this.transport.command(PROJECT_ENVIRONMENT_OPERATIONS.invokeAction, { environmentId: text(environmentId, 256), actionId: text(actionId, 256) }, options)); }
}

function parseSnapshot(input: JsonValue): ProjectEnvironmentClientSnapshot { const value = record(input); if (!uint(value.revision) || !Array.isArray(value.environments) || value.environments.length > 2048) throw new TypeError('project environment snapshot is invalid'); return Object.freeze({ revision: value.revision, environments: Object.freeze(value.environments.map(parseSummary)) }); }
function parseSummary(input: JsonValue): ProjectEnvironmentClientSummary { const value = record(input); const statuses: readonly string[] = ['ready','connecting','reconnecting','provisioning','starting','stopping','offline','authentication-required','host-key-changed','permission-denied','extension-missing','extension-disabled','extension-incompatible','unreachable','failed']; if (!statuses.includes(String(value.status)) || !uint(value.referencedProjectCount)) throw new TypeError('project environment summary is invalid'); return Object.freeze({ id: text(value.id,256), providerId: text(value.providerId,256), providerLabel: text(value.providerLabel,128), name: text(value.name,128), endpointSummary: text(value.endpointSummary,512,true), status: value.status as ProjectEnvironmentClientStatus, referencedProjectCount: value.referencedProjectCount, ...(value.defaultRoot === undefined ? {} : { defaultRoot: text(value.defaultRoot,4096) }), ...(typeof value.isThisServer === 'boolean' ? { isThisServer:value.isThisServer } : {}), ...(typeof value.isFavourite === 'boolean' ? { isFavourite:value.isFavourite } : {}), ...(value.lastUsedAt === undefined ? {} : { lastUsedAt:text(value.lastUsedAt,64) }) }); }
function parseOperation(input: JsonValue): ProjectEnvironmentOperation { const value=record(input); const states=['pending','running','succeeded','failed','cancelled']; if(!states.includes(String(value.state))) throw new TypeError('project environment operation is invalid'); return Object.freeze({ operationId:text(value.operationId,256), state:value.state as ProjectEnvironmentOperation['state'], ...(value.stage===undefined?{}:{stage:text(value.stage,256)}), ...(typeof value.progress==='number'&&value.progress>=0&&value.progress<=1?{progress:value.progress}:{}), ...(value.message===undefined?{}:{message:text(value.message,1024,true)}), ...(value.environmentId===undefined?{}:{environmentId:text(value.environmentId,256)}), ...(value.projectId===undefined?{}:{projectId:text(value.projectId,256)}) }); }
function boundedPayload(value:{environmentId:string;viewId:string;root?:string}):JsonValue{return {environmentId:text(value.environmentId,256),viewId:text(value.viewId,256),...(value.root===undefined?{}:{root:text(value.root,4096)})};}
function formValues(input:Readonly<Record<string,string|boolean>>):JsonValue { const entries=Object.entries(input); if(entries.length>128)throw new TypeError('form exceeds field limit'); return Object.fromEntries(entries.map(([key,value])=>[text(key,256),typeof value==='boolean'?value:text(value,16384,true)])); }
function record(value:unknown):Record<string,JsonValue>{if(typeof value!=='object'||value===null||Array.isArray(value))throw new TypeError('expected object');return value as Record<string,JsonValue>;}
function text(value:unknown,max:number,empty=false):string{if(typeof value!=='string'||value.length>max||value.includes('\0')||(!empty&&value.length===0))throw new TypeError('invalid text');return value;}
function uint(value:unknown):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;}
