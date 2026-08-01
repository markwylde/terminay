import {
	createDesktopServerUiConnectionBinding,
	type DesktopConnectionHost,
	type DesktopServerUiConnectionAdapters,
} from '../apps/terminay-desktop/src/main/index.js';
import {
	type CreateServerUiWindowOptions,
	createServerUiWindow,
} from './serverUiHost';

export type CreateDesktopServerUiWindowOptions = Omit<
	CreateServerUiWindowOptions,
	'capabilities' | 'onHostAction' | 'profiles'
> & {
	readonly connectionHost: DesktopConnectionHost;
	readonly connectionAdapters: DesktopServerUiConnectionAdapters;
};

/**
 * Production composition for a server-bundled Desktop window. Metadata is
 * snapshotted for rendering, while every action returns to the persisted
 * connection host and exact window/view registry.
 */
export function createDesktopServerUiWindow(
	options: CreateDesktopServerUiWindowOptions,
) {
	const { connectionHost, connectionAdapters, ...windowOptions } = options;
	const binding = createDesktopServerUiConnectionBinding(
		connectionHost,
		connectionAdapters,
	);
	return createServerUiWindow({
		...windowOptions,
		capabilities: binding.capabilities,
		profiles: binding.profiles,
		onHostAction: (action) => {
			if (!action.type.startsWith('connection.')) {
				throw new Error('The Desktop server UI action is unsupported.');
			}
			return binding.onHostAction(
				action as Parameters<typeof binding.onHostAction>[0],
			);
		},
	});
}
