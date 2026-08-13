import type { ProtocolId } from '@terminay/protocol';
import { THIS_SERVER_ENVIRONMENT_ID } from '../workspace.js';
import type { ProjectEnvironmentCapability, ProjectEnvironmentRecord, ProjectEnvironmentSummary } from './types.js';
import { THIS_SERVER_PROVIDER_ID } from './types.js';
import { toProjectEnvironmentSummary } from './validation.js';

export interface ProjectEnvironmentInvocationContext {
	readonly serverId: ProtocolId;
	readonly projectId: ProtocolId;
	readonly projectEnvironmentId: ProtocolId;
	readonly environmentRevision: number;
	readonly deadline: number;
	readonly signal: AbortSignal;
}

export interface ProjectEnvironmentRuntime {
	readonly providerId: ProtocolId;
	readonly capabilities: readonly ProjectEnvironmentCapability[];
	invoke(capability: ProjectEnvironmentCapability, operation: string, input: unknown, context: ProjectEnvironmentInvocationContext): Promise<unknown>;
}

export interface ThisServerServices {
	readonly capabilities: Partial<Record<ProjectEnvironmentCapability, (operation: string, input: unknown, context: ProjectEnvironmentInvocationContext) => Promise<unknown>>>;
}

/** The built-in provider is only an adapter over existing server-owned
 * services. It creates no second local terminal/filesystem authority. */
export class ThisServerEnvironmentRuntime implements ProjectEnvironmentRuntime {
	readonly providerId = THIS_SERVER_PROVIDER_ID;
	readonly capabilities: readonly ProjectEnvironmentCapability[];
	constructor(private readonly services: ThisServerServices) { this.capabilities = Object.freeze(Object.keys(services.capabilities) as ProjectEnvironmentCapability[]); }
	async invoke(capability: ProjectEnvironmentCapability, operation: string, input: unknown, context: ProjectEnvironmentInvocationContext): Promise<unknown> {
		if (context.projectEnvironmentId !== THIS_SERVER_ENVIRONMENT_ID || context.environmentRevision !== 1) throw new Error('This server invocation has invalid environment binding');
		if (context.signal.aborted || Date.now() > context.deadline) throw new Error('project environment operation cancelled or expired');
		const service = this.services.capabilities[capability];
		if (service === undefined) throw new ProjectEnvironmentCapabilityError(capability);
		return service(operation, input, context);
	}
}

export class ProjectEnvironmentRegistry {
	private readonly runtimes = new Map<string, ProjectEnvironmentRuntime>();
	register(runtime: ProjectEnvironmentRuntime): void {
		if (this.runtimes.has(runtime.providerId)) throw new Error(`project environment provider already registered: ${runtime.providerId}`);
		this.runtimes.set(runtime.providerId, runtime);
	}
	unregister(providerId: ProtocolId): void { if (providerId === THIS_SERVER_PROVIDER_ID) throw new Error('This server provider cannot be unregistered'); this.runtimes.delete(providerId); }
	resolve(environment: ProjectEnvironmentRecord, capability: ProjectEnvironmentCapability): ProjectEnvironmentRuntime {
		if (environment.archived || environment.status !== 'ready') throw new Error(`project environment is unavailable: ${environment.status}`);
		if (!environment.availableCapabilities.includes(capability)) throw new ProjectEnvironmentCapabilityError(capability);
		const runtime = this.runtimes.get(environment.providerId);
		if (runtime === undefined) throw new Error('project environment provider is unavailable');
		if (!runtime.capabilities.includes(capability)) throw new ProjectEnvironmentCapabilityError(capability);
		return runtime;
	}
	summary(environment: ProjectEnvironmentRecord): ProjectEnvironmentSummary { return toProjectEnvironmentSummary(environment); }
}

export class ProjectEnvironmentCapabilityError extends Error {
	readonly code = 'capability-unavailable';
	constructor(readonly capability: ProjectEnvironmentCapability) { super(`project environment capability is unavailable: ${capability}`); this.name = 'ProjectEnvironmentCapabilityError'; }
}
