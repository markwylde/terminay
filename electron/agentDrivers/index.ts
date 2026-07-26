import type {
	AgentLifecycleEvent,
	AgentProvider,
} from '../../src/types/agentStatus';
import { claudeCodeDriver } from './claudeCode';
import { codexDriver } from './codex';
import type {
	AgentDriver,
	AgentDriverContext,
	AgentDriverRegistry,
	AgentHookReconciliationRequest,
	AgentHookReconciliationResult,
} from './types';

export * from './claudeCode';
export * from './codex';
export * from './managedHooks';
export * from './types';

export function createAgentDriverRegistry(
	drivers: readonly AgentDriver[] = [codexDriver, claudeCodeDriver],
): AgentDriverRegistry {
	const byProvider = new Map<string, AgentDriver>(
		drivers.map((driver) => [driver.provider, driver] as const),
	);

	return {
		drivers,
		get: (provider) => byProvider.get(provider),
		normalize(provider, nativePayload, context) {
			return (
				byProvider.get(provider)?.normalize(nativePayload, context) ?? null
			);
		},
		async normalizeAsync(provider, nativePayload, context) {
			const driver = byProvider.get(provider);
			if (!driver) {
				return null;
			}
			const enrichedPayload = driver.enrichNativePayload
				? await driver.enrichNativePayload(nativePayload, context)
				: nativePayload;
			return driver.normalize(enrichedPayload, context);
		},
		async hookStatus(provider, options) {
			const driver = byProvider.get(provider);
			if (!driver) {
				throw new Error(`Unknown agent provider: ${provider}`);
			}
			return driver.hooks.status(options);
		},
		async reconcileHooks(request) {
			return reconcileAgentDriverHooks(drivers, request);
		},
	};
}

export async function reconcileAgentDriverHooks(
	drivers: readonly AgentDriver[],
	request: AgentHookReconciliationRequest,
): Promise<AgentHookReconciliationResult> {
	const selected = request.provider
		? drivers.filter((driver) => driver.provider === request.provider)
		: drivers;
	if (request.provider && selected.length === 0) {
		throw new Error(`Unknown agent provider: ${request.provider}`);
	}

	const statuses = await Promise.all(
		selected.map((driver) => {
			if (request.action === 'install') {
				return driver.hooks.install(request.options);
			}
			if (request.action === 'uninstall') {
				return driver.hooks.uninstall(request.options);
			}
			return driver.hooks.status(request.options);
		}),
	);
	return {
		statuses,
		ok: statuses.every((status) => {
			if (request.action === 'install') {
				return status.state === 'installed';
			}
			if (request.action === 'uninstall') {
				return status.state === 'not-installed';
			}
			return status.state !== 'error';
		}),
	};
}

export const agentDriverRegistry = createAgentDriverRegistry();

export function getAgentDriver(
	provider: AgentProvider | string,
): AgentDriver | undefined {
	return agentDriverRegistry.get(provider);
}

export function normalizeAgentHook(
	provider: AgentProvider | string,
	nativePayload: unknown,
	context: AgentDriverContext,
): AgentLifecycleEvent | null {
	return agentDriverRegistry.normalize(provider, nativePayload, context);
}

export function reconcileAgentHooks(
	request: AgentHookReconciliationRequest,
): Promise<AgentHookReconciliationResult> {
	return agentDriverRegistry.reconcileHooks(request);
}
