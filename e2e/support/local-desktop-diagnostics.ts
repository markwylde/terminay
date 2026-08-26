import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
	expect,
	type ElectronApplication,
	_electron as electron,
} from '@playwright/test';

export type DiagnosticEvent = {
	component: string;
	event: string;
	fields?: Record<string, unknown>;
	launchId: string;
	message?: string;
	schemaVersion: number;
	severity: string;
	source?: string;
	stack?: string;
	timestamp: string;
};

export function diagnosticsDirectory(userDataDirectory: string): string {
	return path.join(userDataDirectory, 'logs');
}

/**
 * Launch the built Desktop entry point without Vite's development server. This
 * exercises the same file:// renderer path as a packaged build while keeping
 * each test's user data and diagnostics isolated.
 */
export async function launchPackagedStyleDesktop(options: {
	tempDirectory: string;
	userDataDirectory: string;
}): Promise<ElectronApplication> {
	const application = await electron.launch({
		args: ['.'],
		env: {
			...process.env,
			CI: '1',
			TEMP: options.tempDirectory,
			TERMINAY_E2E_TEMP_DIR: options.tempDirectory,
			TERMINAY_TEST: '1',
			TERMINAY_USER_DATA_DIR: options.userDataDirectory,
			TMP: options.tempDirectory,
			TMPDIR: options.tempDirectory,
			// An empty value is deliberately falsy in main.ts and prevents a host
			// environment from accidentally changing this into a development launch.
			VITE_DEV_SERVER_URL: '',
		},
	});
	// Desktop now paints a native loading document before the Local server is
	// initialized. Diagnostics callers exercise the usable packaged-style app,
	// not that intentionally pre-server surface.
	await expect
		.poll(
			async () =>
				(await readDiagnosticEvents(options.userDataDirectory)).some(
					(event) => event.event === 'local-server.ready',
				),
			{ timeout: 30_000 },
		)
		.toBe(true);
	return application;
}

export async function readDiagnosticText(
	userDataDirectory: string,
): Promise<string> {
	const directory = diagnosticsDirectory(userDataDirectory);
	const names = await readdir(directory).catch(() => []);
	const segments = names.filter((name) => name.endsWith('.jsonl')).sort();
	return (
		await Promise.all(
			segments.map((name) =>
				readFile(path.join(directory, name), 'utf8').catch(() => ''),
			),
		)
	).join('');
}

export async function readDiagnosticEvents(
	userDataDirectory: string,
): Promise<DiagnosticEvent[]> {
	const text = await readDiagnosticText(userDataDirectory);
	const events: DiagnosticEvent[] = [];

	for (const line of text.split('\n')) {
		if (line.length === 0) continue;
		try {
			events.push(JSON.parse(line) as DiagnosticEvent);
		} catch {
			// The writer promises complete atomic lines. Tolerate a concurrent final
			// line here so polling a live process does not itself make a test flaky;
			// post-exit assertions still parse every persisted line below.
		}
	}
	return events;
}

export async function readStrictDiagnosticEvents(
	userDataDirectory: string,
): Promise<DiagnosticEvent[]> {
	const text = await readDiagnosticText(userDataDirectory);
	return text
		.split('\n')
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as DiagnosticEvent);
}

export async function closeDesktop(app: ElectronApplication): Promise<void> {
	if (app.process().exitCode !== null) return;
	await app.evaluate(({ dialog }) => {
		dialog.showMessageBox = async () => ({
			checkboxChecked: false,
			response: 0,
		});
	});
	const closed = app.close();
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			closed,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() =>
						reject(
							new Error(
								'Electron did not finish graceful shutdown in 5 seconds.',
							),
						),
					5_000,
				);
				timer.unref?.();
			}),
		]);
	} catch {
		if (app.process().exitCode === null) app.process().kill('SIGKILL');
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}
