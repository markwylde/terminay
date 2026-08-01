import path from 'node:path';
import { app } from 'electron';
import {
	type CreateServerUiWindowOptions,
	createServerUiWindow,
} from '../../electron/serverUiHost';

type ProofWindow = Omit<CreateServerUiWindowOptions, 'preloadPath'>;

const actionProofs: unknown[] = [];
Object.assign(globalThis, { __terminayServerUiActionProofs: actionProofs });

async function start(): Promise<void> {
	await app.whenReady();
	const windows = JSON.parse(
		process.env.TERMINAY_SERVER_UI_PROOF_WINDOWS ?? '[]',
	) as ProofWindow[];
	const preloadPath = path.resolve(__dirname, 'server-ui-preload.cjs');

	for (const options of windows) {
		createServerUiWindow({
			...options,
			onHostAction: (action) => {
				actionProofs.push(
					action.type === 'connection.pair'
						? {
								type: action.type,
								pairingHost: new URL(action.pairingUrl).host,
							}
						: action,
				);
			},
			preloadPath,
		});
	}
}

void start();
