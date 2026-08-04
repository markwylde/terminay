const { app, safeStorage } = require('electron');

const profilePath = process.argv[2];
app.setPath('userData', profilePath);

app
	.whenReady()
	.then(async () => {
		const { ElectronSafeStorageKeyProtector } = await import(
			'./vault-reference.mjs'
		);
		const backend =
			process.platform === 'linux' &&
			typeof safeStorage.getSelectedStorageBackend === 'function'
				? safeStorage.getSelectedStorageBackend()
				: process.platform;

		if (!safeStorage.isEncryptionAvailable() || backend === 'basic_text') {
			process.stdout.write(
				`${JSON.stringify({ available: safeStorage.isEncryptionAvailable(), backend, secure: false })}\n`,
			);
			return;
		}

		const protector = new ElectronSafeStorageKeyProtector(safeStorage);
		const key = Buffer.alloc(32, 0x5a);
		const envelope = await protector.wrap(key);
		const unwrapped = await protector.unwrap(envelope);
		const matches = unwrapped.equals(key);
		key.fill(0);
		unwrapped.fill(0);
		process.stdout.write(
			`${JSON.stringify({
				available: true,
				backend,
				secure: true,
				protector: envelope.protector,
				version: envelope.version,
				matches,
			})}\n`,
		);
	})
	.catch((error) => {
		process.stderr.write(
			`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
		);
		process.exitCode = 1;
	})
	.finally(() => {
		app.quit();
	});
