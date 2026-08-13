import type { JsonValue, ProtocolId } from '@terminay/protocol';
import { THIS_SERVER_ENVIRONMENT_ID } from '../workspace.js';

export const PROJECT_ENVIRONMENT_SCHEMA_VERSION = 2 as const;
export const THIS_SERVER_PROVIDER_ID = 'terminay:this-server' as const;

export const PROJECT_ENVIRONMENT_CAPABILITIES = [
	'terminal',
	'filesystem',
	'filesystem-observation',
	'git',
	'process-observation',
	'agent-journal',
	'mcp-bridge',
	'infrastructure',
	'shell-discovery',
] as const;
export type ProjectEnvironmentCapability = typeof PROJECT_ENVIRONMENT_CAPABILITIES[number];

export const PROJECT_ENVIRONMENT_STATUSES = [
	'ready', 'connecting', 'reconnecting', 'provisioning', 'starting', 'stopping',
	'offline', 'authentication-required', 'host-key-changed', 'permission-denied',
	'extension-missing', 'extension-disabled', 'extension-incompatible', 'unreachable', 'failed',
] as const;
export type ProjectEnvironmentStatus = typeof PROJECT_ENVIRONMENT_STATUSES[number];

export interface EnvironmentFailure {
	readonly classification: Exclude<ProjectEnvironmentStatus, 'ready' | 'connecting' | 'reconnecting' | 'provisioning' | 'starting' | 'stopping'>;
	readonly message: string;
	readonly retryable: boolean;
}

export interface EnvironmentConfigurationRevision {
	readonly revision: number;
	readonly createdAt: number;
	readonly configuration: JsonValue;
	readonly secretReferences: readonly string[];
}

export interface EnvironmentProfile {
	readonly id: ProtocolId;
	readonly providerId: ProtocolId;
	readonly name: string;
	readonly endpointSummary: string;
	readonly defaultRoot?: string;
	readonly activeRevision: number;
	readonly recommendedRevision: number;
	readonly revisions: Readonly<Record<string, EnvironmentConfigurationRevision>>;
	readonly presentation?: Readonly<Record<string, string>>;
	readonly archived: boolean;
}

export interface ProjectEnvironmentRecord {
	readonly id: ProtocolId;
	readonly providerId: ProtocolId;
	readonly profileId?: ProtocolId;
	readonly pinnedRevision: number;
	readonly name: string;
	readonly endpointSummary: string;
	readonly defaultRoot?: string;
	readonly declaredCapabilities: readonly ProjectEnvironmentCapability[];
	readonly availableCapabilities: readonly ProjectEnvironmentCapability[];
	readonly status: ProjectEnvironmentStatus;
	readonly lastSuccessfulCheck?: number;
	readonly failure?: EnvironmentFailure;
	readonly operationReferences: readonly ProtocolId[];
	readonly projectReferenceCount: number;
	readonly archived: boolean;
	readonly builtIn: boolean;
	/** Provider-private, JSON-safe durable state. Never projected to clients. */
	readonly providerState: JsonValue;
	readonly providerRevision: number;
}

export interface ProjectEnvironmentOperationRecord {
	readonly id: ProtocolId;
	readonly providerId: ProtocolId;
	readonly environmentId: ProtocolId;
	readonly kind: string;
	readonly state: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
	readonly providerOperationId?: ProtocolId;
	readonly providerState: JsonValue;
	readonly progress?: JsonValue;
	readonly failure?: EnvironmentFailure;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly revision: number;
}

export interface ProjectEnvironmentState {
	readonly schemaVersion: typeof PROJECT_ENVIRONMENT_SCHEMA_VERSION;
	readonly serverId: ProtocolId;
	readonly revision: number;
	readonly cursor: string;
	readonly profiles: Readonly<Record<ProtocolId, EnvironmentProfile>>;
	readonly environments: Readonly<Record<ProtocolId, ProjectEnvironmentRecord>>;
	readonly operations: Readonly<Record<ProtocolId, ProjectEnvironmentOperationRecord>>;
}

export interface ProjectEnvironmentSummary {
	readonly id: ProtocolId;
	readonly providerId: ProtocolId;
	readonly profileId?: ProtocolId;
	readonly pinnedRevision: number;
	readonly name: string;
	readonly endpointSummary: string;
	readonly defaultRoot?: string;
	readonly capabilities: readonly ProjectEnvironmentCapability[];
	readonly status: ProjectEnvironmentStatus;
	readonly failure?: EnvironmentFailure;
	readonly archived: boolean;
	readonly builtIn: boolean;
}

export function createInitialProjectEnvironmentState(serverId: ProtocolId): ProjectEnvironmentState {
	return {
		schemaVersion: PROJECT_ENVIRONMENT_SCHEMA_VERSION,
		serverId,
		revision: 0,
		cursor: '0',
		profiles: {},
		operations: {},
		environments: {
			[THIS_SERVER_ENVIRONMENT_ID]: {
				id: THIS_SERVER_ENVIRONMENT_ID,
				providerId: THIS_SERVER_PROVIDER_ID,
				pinnedRevision: 1,
				name: 'This server',
				endpointSummary: 'Local to this Terminay Server',
				declaredCapabilities: ['terminal', 'filesystem', 'filesystem-observation', 'git', 'process-observation', 'agent-journal', 'mcp-bridge', 'shell-discovery'],
				availableCapabilities: ['terminal', 'filesystem', 'filesystem-observation', 'git', 'process-observation', 'agent-journal', 'mcp-bridge', 'shell-discovery'],
				status: 'ready',
				operationReferences: [],
				projectReferenceCount: 0,
				archived: false,
				builtIn: true,
				providerState: null,
				providerRevision: 1,
			},
		},
	};
}
