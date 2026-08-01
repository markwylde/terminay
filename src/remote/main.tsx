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
import { createBrowserWebRtcTransport } from '../web/browserWebRtcTransport';

window.__TERMINAY_BROWSER_ENROLLMENT__ = {
	async connect(options) {
		const runtime = createRemoteTransportRuntime();
		const pairing = await loadPairing(options.origin);
		if (pairing === null) throw new Error('This browser has no saved pairing.');
		const authenticated = await authenticateDevice({
			api: runtime.api,
			deviceId: pairing.deviceId,
			pairingPin: options.pairingPin,
			signChallenge: (input) => signDeviceChallenge(pairing.privateKey, input),
		});
		options.onStateChange('connecting');
		const bridge = window.__TERMINAY_REMOTE_WEBRTC__;
		if (bridge?.getChannel === undefined) {
			throw new Error('The canonical WebRTC application transport is unavailable.');
		}
		const transport = await createBrowserWebRtcTransport(
			(name) => bridge.getChannel!(name, authenticated.ticket),
		);
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
	validatePairingUrl(pairingUrl) {
		parsePairingBootstrap(pairingUrl);
	},
};

const root = document.getElementById('remote-root');
if (root === null) throw new Error('remote root element is missing');
mountWebManagerApp(root);
