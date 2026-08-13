import {
	ExtensionsClient,
	TerminayClientFacade,
	type TerminayClient,
} from '@terminay/client-core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExtensionManager } from '../projectEnvironments/ExtensionManager';
import type { ExtensionSummaryDto } from '../projectEnvironments/uiModel';
import '../projectEnvironments/projectEnvironments.css';

export function ExtensionSettingsSection({
	applicationClient,
	serverName,
}: Readonly<{
	applicationClient?: TerminayClient;
	serverName: string;
}>) {
	const [extensions, setExtensions] = useState<readonly ExtensionSummaryDto[]>([]);
	const [revision, setRevision] = useState(0);
	const [authorityLabel, setAuthorityLabel] = useState(serverName);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [announcement, setAnnouncement] = useState('');
	const client = useMemo(
		() => applicationClient === undefined
			? undefined
			: new ExtensionsClient(new TerminayClientFacade(applicationClient)),
		[applicationClient],
	);
	const refresh = useCallback(async () => {
		if (client === undefined) {
			setError('Connect to a Terminay Server to manage its extensions.');
			return;
		}
		setBusy(true);
		setError('');
		try {
			const snapshot = await client.list();
			setExtensions(snapshot.extensions);
			setRevision(snapshot.revision);
			setAuthorityLabel(snapshot.authorityLabel);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(false);
		}
	}, [client]);
	useEffect(() => { void refresh(); }, [refresh]);
	const run = useCallback(async (action: () => Promise<unknown>, success: string) => {
		setBusy(true);
		setError('');
		setAnnouncement('Operation started.');
		try {
			await action();
			setAnnouncement(success);
			await refresh();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
			setAnnouncement('');
		} finally {
			setBusy(false);
		}
	}, [refresh]);

	return (
		<section id="section-extensions" className="settings-section" aria-busy={busy}>
			<div className="settings-section-title-row">
				<h3 className="settings-section-title">Extensions</h3>
			</div>
			<p className="settings-section-description">
				Install and manage project connection providers on <strong>{authorityLabel}</strong>.
			</p>
			{error ? (
				<div className="settings-inline-error" role="alert">
					<span>{error}</span>
					<button type="button" className="settings-secondary-button settings-secondary-button--small" onClick={() => void refresh()}>Retry</button>
				</div>
			) : null}
			<div className="settings-group settings-extension-group">
				<ExtensionManager
					embedded
					extensions={extensions}
					serverName={authorityLabel}
					revision={revision}
					onPreview={(spec) => client!.previewInstall(spec)}
					onInstall={(digest) => run(() => client!.install(digest, revision), 'Extension installed.')}
					onUpdate={(id, digest) => run(() => client!.update(id, digest, revision), 'Extension updated.')}
					onAction={(action, id) => run(() => client!.action(action, id, revision), `Extension ${action} completed.`)}
				/>
			</div>
			{busy ? <div className="settings-status-message" role="status"><progress /> Working on {authorityLabel}…</div> : null}
			{announcement ? <div className="settings-status-message" role="status">{announcement}</div> : null}
		</section>
	);
}
