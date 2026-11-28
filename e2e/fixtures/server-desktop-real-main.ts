import { WebSocketByteTransport } from '@terminay/client-core';
import { AUTHENTICATED_WEBRTC_TRANSPORT_VERSION } from '@terminay/protocol';
import type { SessionTransportHost } from '../../src/web/sessionTransportHost';

declare global {
	interface Window {
		__TERMINAY_TEST_DESKTOP_ENDPOINT__: Readonly<{
			origin: string;
			token: string;
		}>;
	}
}

// Replace the hosted connection manager with the standalone server's loopback
// transport. The browser runs the production workspace over its real protocol.
const { origin, token } = window.__TERMINAY_TEST_DESKTOP_ENDPOINT__;
const root = document.getElementById('web-root');
if (root === null) throw new Error('Missing standalone fixture root');

const host: SessionTransportHost = {
	version: 1,
	authenticatedTransportVersion: AUTHENTICATED_WEBRTC_TRANSPORT_VERSION,
	sessionId: 'standalone-desktop-acceptance',
	origin: window.location.origin,
	prepareWorkspace: async () => {
		throw new Error('The fixture loads the workspace directly');
	},
	connect: async ({ onStateChange }) => {
		const transport = new WebSocketByteTransport({
			origin,
			authToken: token,
		});
		transport.onStateChange((state) => {
			if (state === 'closed') onStateChange('closed');
		});
		await transport.open();
		return transport;
	},
};
window.__TERMINAY_SESSION_TRANSPORT__ = host;
const { mountSessionWorkspace } = await import('../../src/web/main');
mountSessionWorkspace(root);
