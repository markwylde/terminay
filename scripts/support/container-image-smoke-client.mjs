// The device half of the container image smoke test. It is bundled on the host
// and run inside a container, so it drives Terminay Desktop's own pairing and
// reconnect code from a network position the test chooses. It prints one JSON
// record per line; the orchestrator reads them and approves the device.
import { join } from 'node:path';
import {
	connectDesktopHostedRemote,
	pairDesktopHostedDevice,
} from '../../electron/remote/desktopHostedConnection.ts';
import { DesktopDeviceCredentialStore } from '../../electron/remote/deviceCredentialStore.ts';

const [mode, target, storeDirectory, runtimeRoot, holdMs, derive] =
	process.argv.slice(2);
const emit = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);

// The smoke test stores credentials in a throwaway directory; the platform
// keychain codec Desktop uses is not what is under test.
const store = new DesktopDeviceCredentialStore({
	directory: join(storeDirectory, 'credentials'),
	codec: {
		isAvailable: () => true,
		encrypt: (value) => Buffer.from(`protected:${value}`),
		decrypt: (value) => value.toString('utf8').slice('protected:'.length),
	},
});
const common = {
	store,
	webrtcRuntimeRoot: runtimeRoot,
	// No STUN: a reflexive candidate would let a case pass over a route it is
	// not testing, and the smoke test must not depend on an outside service.
	iceServers: [{ urls: 'stun:127.0.0.1:9' }],
	onCandidatePair: (pair) => emit({ event: 'candidate-pair', ...pair }),
	onConnectionStatus: (status) => emit({ event: 'status', status }),
	onConnectionFailure: (reason) => emit({ event: 'failure', reason }),
	...(derive === 'no-derive'
		? { resolveDirectOriginAddresses: async () => [] }
		: {}),
};

try {
	let origin = target;
	if (mode === 'pair') {
		const paired = await pairDesktopHostedDevice({
			...common,
			pairingUrl: target,
			deviceName: 'container-image-smoke',
			onMatchCode: (code) =>
				emit({ event: 'match-code', matchCode: code.matchCode }),
		});
		origin = paired.origin;
		emit({ event: 'paired', origin, serverId: paired.serverId });
	}
	const connection = await connectDesktopHostedRemote({ ...common, origin });
	emit({ event: 'connected', serverId: connection.serverId });
	await new Promise((resolve) => setTimeout(resolve, Number(holdMs)));
	emit({ event: 'held', holdMs: Number(holdMs) });
	process.exit(0);
} catch (error) {
	emit({
		event: 'error',
		message: error instanceof Error ? error.message : String(error),
	});
	process.exit(1);
}
