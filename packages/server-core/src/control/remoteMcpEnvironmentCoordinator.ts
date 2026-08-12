import type { ProtocolId } from '@terminay/protocol';
import type { EnvironmentRoutedProjectService, ProjectEnvironmentBinding } from '../projectEnvironment/router.js';
import { RemoteMcpBridgeAuthority, type RemoteMcpBridgeCapability, type RemoteMcpBridgeScope, type RemoteMcpRequestFrame } from './remoteMcpBridge.js';

interface ActiveBridge { readonly binding: ProjectEnvironmentBinding; readonly scope: RemoteMcpBridgeScope; readonly capability: RemoteMcpBridgeCapability; readonly controller: AbortController; pump?: Promise<void> }

/** Production coordinator between the provider-owned SSH byte channel and the
 * server-owned MCP authority. Provider frames are never dispatched directly:
 * every one crosses signature, replay, deadline and canonical binding checks. */
export class RemoteMcpEnvironmentCoordinator {
	private readonly active = new Map<ProtocolId, ActiveBridge>();
	constructor(private readonly service: EnvironmentRoutedProjectService, private readonly authority: RemoteMcpBridgeAuthority) {
		if (service.capability !== 'mcp-bridge') throw new TypeError('Remote MCP coordinator requires the mcp-bridge service.');
	}

	async open(projectId: ProtocolId, terminalSessionId: ProtocolId): Promise<Readonly<Omit<RemoteMcpBridgeCapability, 'bootstrapSecret'>>> {
		await this.close(terminalSessionId);
		const binding = this.service.bind(projectId);
		const scope: RemoteMcpBridgeScope = Object.freeze({ terminalSessionId, projectId, projectEnvironmentId: binding.projectEnvironmentId, environmentRevision: binding.environmentRevision, scope: 'write' });
		const capability = this.authority.open(scope);
		const controller = new AbortController();
		const active: ActiveBridge = { binding, scope, capability, controller };
		this.active.set(terminalSessionId, active);
		try {
			await this.service.invokeBound(binding, 'open', { sessionId: terminalSessionId, projectId, environmentId: binding.projectEnvironmentId, environmentRevision: binding.environmentRevision, capability: publicBootstrap(capability) }, { signal: controller.signal });
			active.pump = this.pump(active);
		} catch (error) { this.active.delete(terminalSessionId); this.authority.revoke(capability.bridgeId); controller.abort('open-failed'); throw error; }
		const { bootstrapSecret: _secret, ...metadata } = capability; return Object.freeze(metadata);
	}

	async close(terminalSessionId: ProtocolId): Promise<boolean> {
		const active = this.active.get(terminalSessionId); if (!active) return false;
		this.active.delete(terminalSessionId); active.controller.abort('session-closed'); this.authority.revoke(active.capability.bridgeId);
		try { await this.service.invokeBound(active.binding, 'revoke', { sessionId: terminalSessionId }, { timeoutMs: 5_000 }); } catch { /* canonical revocation already occurred */ }
		return true;
	}
	onReconnect(terminalSessionId: ProtocolId): Promise<boolean> { return this.close(terminalSessionId); }
	onSessionExit(terminalSessionId: ProtocolId): Promise<boolean> { return this.close(terminalSessionId); }
	async shutdown(): Promise<void> { await Promise.all([...this.active.keys()].map(sessionId => this.close(sessionId))); this.authority.shutdown(); }

	private async pump(active: ActiveBridge): Promise<void> {
		try {
			while (!active.controller.signal.aborted && this.active.get(active.scope.terminalSessionId) === active) {
				const frame = await this.service.invokeBound<RemoteMcpRequestFrame>(active.binding, 'exchange', { sessionId: active.scope.terminalSessionId, action: 'receive' }, { signal: active.controller.signal, timeoutMs: 35_000 });
				const response = await this.authority.exchange(frame, active.scope);
				await this.service.invokeBound(active.binding, 'exchange', { sessionId: active.scope.terminalSessionId, action: 'respond', frame: response }, { signal: active.controller.signal, timeoutMs: 5_000 });
			}
		} catch {
			if (this.active.get(active.scope.terminalSessionId) === active) {
				this.active.delete(active.scope.terminalSessionId); this.authority.revoke(active.capability.bridgeId); active.controller.abort('bridge-failed');
				try { await this.service.invokeBound(active.binding, 'revoke', { sessionId: active.scope.terminalSessionId }, { timeoutMs: 5_000 }); } catch { /* fail closed */ }
			}
		}
	}
}

function publicBootstrap(capability: RemoteMcpBridgeCapability) {
	return { version: 1 as const, bridgeId: capability.bridgeId, serverInstanceId: capability.serverInstanceId, bootstrapSecret: capability.bootstrapSecret, issuedAt: capability.issuedAt, expiresAt: capability.expiresAt };
}
