import path from 'node:path';
import { app } from 'electron';
import {
	type CreateServerUiWindowOptions,
	createServerUiWindow,
} from '../../electron/serverUiHost';

type ProofWindow = Omit<CreateServerUiWindowOptions, 'preloadPath'>;

async function start(): Promise<void> {
	await app.whenReady();
	const windows = JSON.parse(
		process.env.TERMINAY_SERVER_UI_PROOF_WINDOWS ?? '[]',
	) as ProofWindow[];
	const preloadPath = path.resolve(__dirname, 'server-ui-preload.cjs');

	for (const options of windows) {
		createServerUiWindow({
			...options,
			preloadPath,
		});
	}
}

void start();
