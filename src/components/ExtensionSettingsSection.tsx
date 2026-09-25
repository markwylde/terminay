import {
	ExtensionsClient,
	TerminayClientFacade,
	type TerminayClient,
	TerminayGitClient,
} from '@terminay/client-core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExtensionManager, type ExtensionSummaryDto } from './ExtensionManager';
import './extensionManager.css';

export function ExtensionSettingsSection({
	applicationClient,
	serverName,
	harnessSwitches,
	onHarnessSwitchChange,
}: Readonly<{
	applicationClient?: TerminayClient;
	serverName: string;
	harnessSwitches?: Readonly<Record<string, boolean>>;
	onHarnessSwitchChange?: (key: string, enabled: boolean) => void;
}>) {
	const [extensions, setExtensions] = useState<readonly ExtensionSummaryDto[]>([]);
	const [revision, setRevision] = useState(0);
	const [authorityLabel, setAuthorityLabel] = useState(serverName);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [announcement, setAnnouncement] = useState('');
	const [suppressedSignInPrompts, setSuppressedSignInPrompts] = useState<ReadonlySet<string>>(() => new Set());
	const client = useMemo(
		() => applicationClient === undefined
			? undefined
			: new ExtensionsClient(new TerminayClientFacade(applicationClient)),
		[applicationClient],
	);
	const gitClient = useMemo(
		() => applicationClient === undefined
			? undefined
			: new TerminayGitClient(new TerminayClientFacade(applicationClient)),
		[applicationClient],
	);
	const refreshSignInPrompts = useCallback(async () => {
		try {
			const result = await gitClient?.insightPreferences();
			const list = typeof result === 'object' && result !== null && !Array.isArray(result) ? result.suppressedExtensions : undefined;
			setSuppressedSignInPrompts(new Set(Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : []));
		} catch {
			/* a server without worktree insights has nothing to switch */
		}
	}, [gitClient]);
	useEffect(() => { void refreshSignInPrompts(); }, [refreshSignInPrompts]);
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
			<div className="settings-category-header">
				<h2>Extensions</h2>
				<p>
					Install and manage extensions on <strong>{authorityLabel}</strong>.
				</p>
			</div>
			{error ? (
				<div className="settings-inline-error" role="alert">
					<span>{error}</span>
					<button type="button" className="settings-secondary-button settings-secondary-button--small" onClick={() => void refresh()}>Retry</button>
				</div>
			) : null}
			<ExtensionManager
					extensions={extensions}
					serverName={authorityLabel}
					revision={revision}
					onPreview={(spec) => client!.previewInstall(spec)}
					onPreviewPackageFile={async (file) => client!.previewPackageFile(file.name, new Uint8Array(await file.arrayBuffer()))}
					onInstall={(digest) => run(() => client!.install(digest, revision), 'Extension installed.')}
					onUpdate={(id, digest) => run(() => client!.update(id, digest, revision), 'Extension updated.')}
					onAction={(action, id) => run(() => client!.action(action, id, revision), `Extension ${action} completed.`)}
					harnessSwitches={harnessSwitches}
					onHarnessSwitchChange={onHarnessSwitchChange}
					suppressedSignInPrompts={suppressedSignInPrompts}
					onSignInPromptsChange={gitClient === undefined ? undefined : (extensionId, enabled) => {
						void run(async () => {
							await gitClient.setInsightPrompts(extensionId, enabled);
							await refreshSignInPrompts();
						}, enabled ? 'Sign-in prompts switched on.' : 'Sign-in prompts switched off.');
					}}
			/>
			{busy ? <div className="settings-status-message" role="status"><progress /> Working on {authorityLabel}…</div> : null}
			{announcement ? <div className="settings-status-message" role="status">{announcement}</div> : null}
		</section>
	);
}
