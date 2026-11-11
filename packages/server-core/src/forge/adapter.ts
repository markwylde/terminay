import type { JsonValue } from '@terminay/protocol';
import type { CommandRequest, QueryRequest } from '../types.js';
import {
	type ForgeCaller,
	type ForgeListRequest,
	type ForgeService,
	type ForgeChange,
	ForgeServiceError,
} from './service.js';

/** Stable application-protocol operation names for forge sources (ADR-0105). */
export const FORGE_OPERATIONS = Object.freeze({
	sources: 'forge.sources',
	accounts: 'forge.accounts',
	owners: 'forge.owners',
	query: 'forge.query',
	detail: 'forge.detail',
	claims: 'forge.claims',
	counts: 'forge.counts',
	settingsGet: 'forge.settings.get',
	settingsSet: 'forge.settings.set',
	accountsAdd: 'forge.accounts.add',
	accountsRemove: 'forge.accounts.remove',
} as const);

/** The journal event clients refresh visible forge lists on. */
export const FORGE_CHANGED_EVENT = 'forge.changed';

export interface ForgeOperationHandlers {
	readonly queries: Readonly<
		Record<string, (request: QueryRequest) => JsonValue | Promise<JsonValue>>
	>;
	readonly commands: Readonly<
		Record<string, (request: CommandRequest) => JsonValue | Promise<JsonValue>>
	>;
}

/**
 * Protocol boundary for forge operations. Authority comes from the request
 * context exactly as for Git: scope, and an optional project binding.
 * Nothing in a response carries a credential.
 */
export class ServerForgeAdapter {
	constructor(private readonly service: ForgeService) {}

	/** Forward service changes as `forge.changed` journal events. */
	subscribeEvents(
		listener: (event: { type: string } & ForgeChange) => void,
	): () => void {
		return this.service.subscribe((change) =>
			listener({ type: FORGE_CHANGED_EVENT, ...change }),
		);
	}

	close(): void {
		this.service.dispose();
	}

	operations(): ForgeOperationHandlers {
		return {
			queries: {
				[FORGE_OPERATIONS.sources]: async (request) =>
					json({ sources: await this.service.sources(caller(request)) }),
				[FORGE_OPERATIONS.accounts]: async (request) =>
					json({
						sources: await this.service.accounts(
							caller(request),
							payload(request).fresh === true,
						),
					}),
				[FORGE_OPERATIONS.owners]: async (request) =>
					json({ owners: await this.service.owners(caller(request)) }),
				[FORGE_OPERATIONS.query]: async (request) =>
					json(await this.service.list(caller(request), listRequest(request))),
				[FORGE_OPERATIONS.detail]: async (request) => {
					const body = payload(request);
					return json(
						await this.service.detail(
							caller(request),
							text(body.sourceId, 'sourceId'),
							body.reference,
							body.fresh === true,
						),
					);
				},
				[FORGE_OPERATIONS.claims]: async (request) =>
					json({
						claims: await this.service.claims(
							caller(request),
							text(payload(request).projectId, 'projectId'),
						),
					}),
				[FORGE_OPERATIONS.counts]: async (request) =>
					json(await this.service.counts(caller(request))),
				[FORGE_OPERATIONS.settingsGet]: async (request) => {
					const sources = await this.service.sources(caller(request));
					const settings: Record<string, unknown> = {};
					for (const source of sources) settings[source.extensionId] = source.settings;
					return json({ settings });
				},
			},
			commands: {
				[FORGE_OPERATIONS.settingsSet]: async (request) => {
					const body = payload(request);
					return {
						result: json({
							settings: await this.service.setSettings(
								caller(request),
								text(body.extensionId, 'extensionId'),
								body.settings,
							),
						}),
					};
				},
				[FORGE_OPERATIONS.accountsAdd]: async (request) => {
					const body = payload(request);
					await this.service.addAccount(
						caller(request),
						text(body.extensionId, 'extensionId'),
						text(body.origin, 'origin'),
						text(body.token, 'token', 4_096),
					);
					return { result: { ok: true } };
				},
				[FORGE_OPERATIONS.accountsRemove]: async (request) => {
					const body = payload(request);
					await this.service.removeAccount(
						caller(request),
						text(body.extensionId, 'extensionId'),
						text(body.origin, 'origin'),
					);
					return { result: { ok: true } };
				},
			},
		};
	}
}

function caller(request: QueryRequest | CommandRequest): ForgeCaller {
	const claims = request.context.claims;
	const projectId =
		claims && typeof claims === 'object' && !Array.isArray(claims) &&
		typeof (claims as Record<string, unknown>).projectId === 'string'
			? ((claims as Record<string, unknown>).projectId as string)
			: undefined;
	const scope = request.context.authScope;
	return {
		scope: scope === 'admin' || scope === 'write' ? scope : 'read',
		...(projectId === undefined ? {} : { projectId }),
	};
}

function payload(request: QueryRequest | CommandRequest): Record<string, unknown> {
	const value = request.envelope.payload;
	if (value === undefined || value === null) return {};
	if (typeof value !== 'object' || Array.isArray(value))
		throw new ForgeServiceError('invalid', 'forge payload must be an object');
	return value as Record<string, unknown>;
}

function text(value: unknown, name: string, maximum = 2_048): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > maximum)
		throw new ForgeServiceError('invalid', `${name} is invalid`);
	return value;
}

function listRequest(request: QueryRequest): ForgeListRequest {
	const body = payload(request);
	return {
		kind: body.kind as ForgeListRequest['kind'],
		scope: body.scope as ForgeListRequest['scope'],
		state: body.state as ForgeListRequest['state'],
		purpose: body.purpose as ForgeListRequest['purpose'],
		...(typeof body.projectId === 'string' ? { projectId: body.projectId } : {}),
		...(Array.isArray(body.repositories)
			? { repositories: body.repositories as ForgeListRequest['repositories'] }
			: {}),
		...(typeof body.text === 'string' ? { text: body.text } : {}),
		...(typeof body.pageSize === 'number' ? { pageSize: body.pageSize } : {}),
		...(typeof body.cursor === 'string' ? { cursor: body.cursor } : {}),
		...(body.fresh === true ? { fresh: true } : {}),
	};
}

function json(value: unknown): JsonValue {
	return JSON.parse(JSON.stringify(value)) as JsonValue;
}
