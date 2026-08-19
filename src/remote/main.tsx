import { mountSessionWorkspace } from '../web/main';
import { bootstrapHostedBrowserSession } from '../web/sessionTransportHost';
import { createBrowserSessionBundleHost } from '@terminay/web';
import { renderDirectBrowserBootstrapFailure } from './bootstrapFailure';

/**
 * Installs the session-origin browser host before mounting the canonical
 * workspace. `remote.html` is the browser shell entry and `server.html`
 * invokes it once the hosted bootstrap authority is present.
 */
export async function launchDirectBrowserWorkspace(
	mountRoot?: HTMLElement,
): Promise<void> {
	let step:
		| 'host-runtime'
		| 'session-host'
		| 'workspace-preparation'
		| 'bundle-installation'
		| 'route-activation'
		| 'application-mount' = 'host-runtime';
	try {
		// Capability negotiation is feature-based inside the host. Never gate a
		// direct session on a mutable browser brand or user-agent string.
		const sessionBrowserBundleHost = createBrowserSessionBundleHost(caches);

		step = 'session-host';
		const sessionHost = bootstrapHostedBrowserSession();
		if (sessionHost === undefined)
			throw new Error('A secure Terminay session host was not installed.');

		step = 'workspace-preparation';
		const workspacePreparation = await sessionHost.prepareWorkspace();

		step = 'bundle-installation';
		await sessionBrowserBundleHost.installAndPrepare({
			...workspacePreparation,
			sessionOrigin: sessionHost.origin,
		});

		step = 'route-activation';
		// Keep document history on /v1/. /remote-app/ is a Cache Storage path;
		// restoring that URL would skip the session host.

		step = 'application-mount';
		const root = mountRoot ?? document.getElementById('remote-root');
		if (root === null) throw new Error('Direct browser root is missing.');
		mountSessionWorkspace(root);
	} catch (error) {
		renderDirectBrowserBootstrapFailure({ step, error });
	}
}

if (document.getElementById('remote-root') !== null) {
	void launchDirectBrowserWorkspace();
}
