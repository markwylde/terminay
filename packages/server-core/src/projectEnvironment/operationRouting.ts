import type { JsonValue } from '@terminay/protocol';
import type { CommandHandler, CommandRequest, OperationRegistries, QueryHandler, QueryRequest } from '../types.js';
import type { ProjectEnvironmentCapability } from './types.js';
import { ProjectEnvironmentRouter } from './router.js';

export interface ProjectOperationRoute {
	readonly capability: ProjectEnvironmentCapability;
	readonly operation?: string;
}

export type ProjectOperationClassifier = (operation: string) => ProjectOperationRoute | undefined;

/** Wrap protocol registries at the final privileged dispatch boundary. Local
 * requests preserve their exact handler. Remote requests never enter it. */
export function routeProjectOperationRegistries(
	operations: OperationRegistries,
	router: ProjectEnvironmentRouter,
	classify: ProjectOperationClassifier = classifyProjectOperation,
): OperationRegistries {
	return {
		...(operations.queries === undefined ? {} : { queries: routeQueries(operations.queries, router, classify) }),
		...(operations.commands === undefined ? {} : { commands: routeCommands(operations.commands, router, classify) }),
		...(operations.policies === undefined ? {} : { policies: operations.policies }),
	};
}

export function classifyProjectOperation(operation: string): ProjectOperationRoute | undefined {
	if (operation.startsWith('files.observe.') || operation.startsWith('files.observation.')) return { capability: 'filesystem-observation' };
	if (operation.startsWith('files.') || operation.startsWith('file.')) return { capability: 'filesystem' };
	if (operation.startsWith('git.')) return { capability: 'git' };
	if (operation.startsWith('agents.') || operation.startsWith('agent.')) return { capability: 'agent-journal' };
	if (operation.startsWith('mcp.')) return { capability: 'mcp-bridge' };
	if (operation.startsWith('shell-profiles.')) return { capability: 'shell-discovery' };
	return undefined;
}

function routeQueries(source: NonNullable<OperationRegistries['queries']>, router: ProjectEnvironmentRouter, classify: ProjectOperationClassifier): ReadonlyMap<string, QueryHandler> {
	return new Map(entries(source).map(([operation, handler]) => [operation, async (request: QueryRequest) => {
		const route = classify(operation);
		if (route === undefined) return handler(request);
		const projectId = requestProjectId(request);
		if (projectId === undefined) return handler(request);
		return router.route(projectId, route.capability, route.operation ?? operation, providerInput(request), () => handler(request), requestOptions(request));
	}]));
}

function routeCommands(source: NonNullable<OperationRegistries['commands']>, router: ProjectEnvironmentRouter, classify: ProjectOperationClassifier): ReadonlyMap<string, CommandHandler> {
	return new Map(entries(source).map(([operation, handler]) => [operation, async (request: CommandRequest) => {
		const route = classify(operation);
		if (route === undefined) return handler(request);
		const projectId = requestProjectId(request);
		if (projectId === undefined) return handler(request);
		return router.route(projectId, route.capability, route.operation ?? operation, providerInput(request), () => handler(request), requestOptions(request));
	}]));
}

function requestProjectId(request: QueryRequest | CommandRequest): string | undefined {
	const payload = record(request.envelope.payload);
	if (typeof payload?.projectId === 'string') return payload.projectId;
	const claims = record(request.context.claims);
	return typeof claims?.projectId === 'string' ? claims.projectId : undefined;
}

function providerInput(request: QueryRequest | CommandRequest): JsonValue {
	return {
		payload: request.envelope.payload,
		...(request.body.byteLength === 0 ? {} : { body: Buffer.from(request.body).toString('base64') }),
		request: {
			clientId: request.context.clientId,
			authScope: request.context.authScope,
			...(request.context.expectedRevision === undefined ? {} : { expectedRevision: request.context.expectedRevision }),
		},
	};
}

function requestOptions(request: QueryRequest | CommandRequest) {
	const remaining = request.context.deadline === undefined ? undefined : Math.max(1, request.context.deadline - Date.now());
	return { signal: request.context.signal, ...(remaining === undefined ? {} : { timeoutMs: remaining }) };
}

function entries<T>(value: ReadonlyMap<string, T> | Record<string, T>): [string, T][] {
	return value instanceof Map ? [...value] : Object.entries(value);
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
