import { mountSessionWorkspace } from '../web/main';
import { establishDevicePairing } from './services/devicePairingFlow';
import {
	generateDeviceKeyPair,
	loadBrowserDeviceIdentity,
	saveBrowserDeviceIdentity,
	signDeviceChallenge,
} from './services/deviceKeys';
import { authenticateDevice } from './services/auth';
import { parsePairingBootstrap } from './services/pairing';
import { createRemoteTransportRuntime } from './services/transport';
import {
	acquireHostedApplicationTransport,
	bootstrapHostedBrowserSession,
} from '../web/sessionTransportHost';
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
		| 'application-registration'
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
		const preparedWorkspace = await sessionBrowserBundleHost.installAndPrepare({
			...workspacePreparation,
			sessionOrigin: sessionHost.origin,
		});

		step = 'route-activation';
		if (
			window.location.pathname !== new URL(preparedWorkspace.entryUrl).pathname
		) {
			const entry = new URL(preparedWorkspace.entryUrl);
			window.history.replaceState(
				{},
				'',
				`${entry.pathname}${window.location.search}${window.location.hash}`,
			);
		}

		step = 'application-registration';
		sessionHost.registerApplication({
			async connect(options) {
				const runtime = createRemoteTransportRuntime();
				if (options.origin !== sessionHost.origin) {
					throw new Error(
						'Saved browser profile belongs to a different session origin.',
					);
				}
				const pairing = await loadBrowserDeviceIdentity(sessionHost.origin);
				if (pairing === null)
					throw new Error('This browser has no saved pairing.');
				const authenticated = await authenticateDevice({
					api: runtime.api,
					deviceId: pairing.deviceId,
					origin: sessionHost.origin,
					signChallenge: (input) =>
						signDeviceChallenge(pairing.privateKey, input),
				});
				options.onStateChange('connecting');
				const transport = await acquireHostedApplicationTransport(
					authenticated.ticket,
				);
				if (transport === undefined)
					throw new Error('Terminay session transport host is unavailable.');
				transport.onStateChange((state) => {
					if (state === 'open') options.onStateChange('live');
					else if (state === 'closed' || state === 'failed')
						options.onStateChange('closed');
				});
				options.onStateChange('live');
				return transport;
			},
			async enroll(options) {
				const runtime = createRemoteTransportRuntime();
				const pairing = await establishDevicePairing({
					api: runtime.api,
					bootstrap: parsePairingBootstrap(options.pairingUrl),
					credentials: {
						saveDeviceIdentity: saveBrowserDeviceIdentity,
					},
					deviceName: options.deviceName.trim(),
					generateKeyPair: generateDeviceKeyPair,
					origin: options.origin,
					pairingPin: options.pairingPin,
				});
				if (!options.isCurrent()) {
					throw new Error('This pairing attempt is no longer active.');
				}
				return Object.freeze({
					deviceId: pairing.deviceId,
					deviceName: pairing.deviceName,
					origin: options.origin,
				});
			},
		});

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
