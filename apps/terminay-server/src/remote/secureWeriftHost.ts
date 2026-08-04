import {
	NodeDataChannelHeadlessHost,
	type NodeDataChannelHeadlessHostOptions,
} from './nodeDataChannelHost.js';
import { createSecureWeriftCompatibilityModule } from './secureWeriftPeer.js';
import { loadSelectedSecureWeriftRuntime } from './secureWeriftRuntime.js';

export type SecureWeriftHeadlessHostOptions = Omit<
	NodeDataChannelHeadlessHostOptions,
	'loadModule' | 'module' | 'runtime'
> & {
	/** Explicit packaged resource root containing selection.json and artifact/. */
	readonly runtimeRoot: string;
};

/**
 * Compose the production server host from the formally selected, verified
 * Secure-Werift artifact. The legacy host class name is an internal migration
 * detail; runtime admission and diagnostics identify this adapter as `werift`.
 */
export function createSecureWeriftHeadlessHost(
	options: SecureWeriftHeadlessHostOptions,
): NodeDataChannelHeadlessHost {
	const { runtimeRoot, ...hostOptions } = options;
	return new NodeDataChannelHeadlessHost({
		...hostOptions,
		runtime: 'werift',
		loadModule: async () =>
			createSecureWeriftCompatibilityModule(
				await loadSelectedSecureWeriftRuntime(runtimeRoot),
			),
	});
}
