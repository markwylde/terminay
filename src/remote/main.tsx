import { mountWebManagerApp } from '../web/main';
import { establishDevicePairing } from './services/devicePairingFlow';
import {
	generateDeviceKeyPair,
	loadPairing,
	saveEstablishedPairing,
	signDeviceChallenge,
} from './services/deviceKeys';
import { authenticateDevice } from './services/auth';
import { parsePairingBootstrap } from './services/pairing';
import { createRemoteTransportRuntime } from './services/transport';
import {
	acquireHostedApplicationTransport,
	bootstrapHostedBrowserSession,
} from '../web/sessionTransportHost';
import { createDirectBrowserBundleHost, currentBrowserExecutionRuntime } from '@terminay/web';

// Standalone session-origin composition uses its own isolated cache namespace.
export const directBrowserBundleHost = createDirectBrowserBundleHost(caches, currentBrowserExecutionRuntime(navigator.userAgent));

const sessionHost = bootstrapHostedBrowserSession();
if (sessionHost === undefined) throw new Error('Terminay session transport host is unavailable.');
const workspacePreparation = await sessionHost.prepareWorkspace();
const preparedWorkspace = await directBrowserBundleHost.installAndPrepare({
	...workspacePreparation,
	sessionOrigin: sessionHost.origin,
});
if (window.location.pathname !== new URL(preparedWorkspace.entryUrl).pathname) {
	const entry = new URL(preparedWorkspace.entryUrl);
	window.history.replaceState(
		{},
		'',
		`${entry.pathname}${window.location.search}${window.location.hash}`,
	);
}
sessionHost.registerApplication({
	async connect(options) {
		const runtime = createRemoteTransportRuntime();
		const canonicalOrigin = `${sessionHost.origin}#transport=webrtc:${sessionHost.origin}`;
		if (options.origin !== sessionHost.origin && options.origin !== canonicalOrigin) {
			throw new Error('Saved browser profile belongs to a different session origin.');
		}
		const pairing = await loadPairing(canonicalOrigin);
		if (pairing === null) throw new Error('This browser has no saved pairing.');
		const authenticated = await authenticateDevice({
			api: runtime.api,
			deviceId: pairing.deviceId,
			pairingPin: options.pairingPin,
			signChallenge: (input) => signDeviceChallenge(pairing.privateKey, input),
		});
		options.onStateChange('connecting');
		const transport = await acquireHostedApplicationTransport(authenticated.ticket);
		if (transport === undefined) throw new Error('Terminay session transport host is unavailable.');
		transport.onStateChange((state) => {
			if (state === 'open') options.onStateChange('live');
			else if (state === 'closed' || state === 'failed') options.onStateChange('closed');
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
				saveEstablishedPairing: ({ pairing: value, reconnectGrant }) =>
					saveEstablishedPairing(value, reconnectGrant),
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

const root = document.getElementById('remote-root');
if (root === null) throw new Error('remote root element is missing');
mountWebManagerApp(root);
