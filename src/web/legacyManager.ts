import { runLegacyManagerMigration, type WebStorageLike } from '@terminay/web';

function storage(): WebStorageLike | undefined {
	try {
		const candidate = window.localStorage;
		candidate.getItem('__terminay_storage_probe__');
		return candidate;
	} catch {
		return undefined;
	}
}

function renderRecovery(message: string): void {
	const status = document.getElementById('legacy-migration-status');
	if (status !== null) status.textContent = message;
	const retry = document.getElementById('legacy-migration-retry');
	if (retry instanceof HTMLButtonElement) {
		retry.hidden = false;
		retry.addEventListener('click', () => window.location.reload(), {
			once: true,
		});
	}
}

const result = runLegacyManagerMigration({ window, storage: storage() });
if (result.status === 'recovery') renderRecovery(result.message);
