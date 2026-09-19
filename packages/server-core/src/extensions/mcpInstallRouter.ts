import type {
	McpInstallTargetActionResult,
	McpInstallTargetState,
	McpInstallTargetStatus,
	McpServerCommand,
} from '@terminay/extension-api';
import type { McpInstallTargetProvider } from './manager.js';

/** The subset of the host manager the router needs. */
export interface McpInstallTargetHosts {
	mcpInstallTargetContributions(): readonly McpInstallTargetProvider[];
	invokeMcpTarget(
		targetId: string,
		operation: 'status' | 'install' | 'uninstall',
		server: McpServerCommand,
		signal?: AbortSignal,
	): Promise<unknown>;
}

/** One row of the Install Terminay MCP surface, keyed by target id. */
export interface McpInstallTargetRow {
	readonly id: string;
	readonly label: string;
	readonly state: McpInstallTargetState;
	readonly installed: boolean;
	readonly configPath: string;
	readonly message?: string;
}

export interface McpInstallRouterStatus {
	/**
	 * `ready` when targets are registered and the MCP server command is known,
	 * `unavailable` when this server has no MCP server command, and
	 * `no-targets` when no running extension registers a target (for example
	 * the Built-in Agents extension is disabled).
	 */
	readonly state: 'ready' | 'unavailable' | 'no-targets';
	readonly agents: readonly McpInstallTargetRow[];
}

export interface McpInstallRouterOptions {
	readonly hosts: () => McpInstallTargetHosts | undefined;
	/** Absent on a server that cannot launch the Terminay MCP server. */
	readonly serverCommand?: () => McpServerCommand | undefined;
	readonly deadlineMs?: number;
}

/**
 * Routes the `mcp-install.*` operations to extension-registered install
 * targets. The host decides when a write happens — only on an authenticated
 * install or uninstall — and supplies the exact server command; the target
 * owns its client's configuration format.
 */
export class McpInstallRouter {
	private readonly deadlineMs: number;

	constructor(private readonly options: McpInstallRouterOptions) {
		this.deadlineMs = options.deadlineMs ?? 10_000;
	}

	async status(): Promise<McpInstallRouterStatus> {
		const hosts = this.options.hosts();
		const targets = hosts?.mcpInstallTargetContributions() ?? [];
		if (hosts === undefined || targets.length === 0)
			return Object.freeze({ state: 'no-targets', agents: [] });
		const server = this.options.serverCommand?.();
		const agents = await Promise.all(
			targets.map(async ({ contribution }): Promise<McpInstallTargetRow> => {
				if (server === undefined)
					return row(contribution.id, contribution.displayName, {
						state: 'unavailable',
						configPath: '',
						message: 'The Terminay MCP server is unavailable on this server.',
					});
				try {
					const status = (await hosts.invokeMcpTarget(
						contribution.id,
						'status',
						server,
						AbortSignal.timeout(this.deadlineMs),
					)) as McpInstallTargetStatus;
					return row(contribution.id, contribution.displayName, status);
				} catch (error) {
					return row(contribution.id, contribution.displayName, {
						state: 'error',
						configPath: '',
						message: failure(error),
					});
				}
			}),
		);
		return Object.freeze({
			state: server === undefined ? 'unavailable' : 'ready',
			agents: Object.freeze(agents),
		});
	}

	install(targetId: string): Promise<McpInstallTargetActionResult> {
		return this.act(targetId, 'install');
	}

	uninstall(targetId: string): Promise<McpInstallTargetActionResult> {
		return this.act(targetId, 'uninstall');
	}

	private async act(
		targetId: string,
		operation: 'install' | 'uninstall',
	): Promise<McpInstallTargetActionResult> {
		const hosts = this.options.hosts();
		if (
			hosts === undefined ||
			!hosts
				.mcpInstallTargetContributions()
				.some(({ contribution }) => contribution.id === targetId)
		)
			return {
				ok: false,
				installed: false,
				error: 'Unknown MCP install target.',
			};
		const server = this.options.serverCommand?.();
		if (server === undefined)
			return {
				ok: false,
				installed: false,
				error: 'The Terminay MCP server is unavailable on this server.',
			};
		try {
			return (await hosts.invokeMcpTarget(
				targetId,
				operation,
				server,
				AbortSignal.timeout(this.deadlineMs),
			)) as McpInstallTargetActionResult;
		} catch (error) {
			return { ok: false, installed: false, error: failure(error) };
		}
	}
}

function row(
	id: string,
	label: string,
	status: McpInstallTargetStatus,
): McpInstallTargetRow {
	return Object.freeze({
		id,
		label,
		state: status.state,
		installed: status.state === 'installed' || status.state === 'changed',
		configPath: status.configPath,
		...(status.message === undefined ? {} : { message: status.message }),
	});
}

function failure(error: unknown): string {
	return error instanceof Error
		? error.message.replace(/[\r\n]/gu, ' ').slice(0, 1_000)
		: 'MCP install target failed';
}
