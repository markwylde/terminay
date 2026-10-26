import {
	ExtensionsClient,
	TerminayClientFacade,
	type TerminayClient,
	TerminayGitClient,
} from '@terminay/client-core';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
	type SettingsCategoryParts,
	SettingsListColumn,
	type SettingsListSection,
	SettingsListSections,
} from '../shared/SharedSettingsRouteBody';
import {
	EXTENSIONS_INSTALL_ID,
	ExtensionManager,
	type ExtensionSummaryDto,
	extensionListStatus,
} from './ExtensionManager';
import './extensionManager.css';

export function ExtensionSettingsSection({
	applicationClient,
	serverName,
	harnessSwitches,
	onHarnessSwitchChange,
	collection,
}: Readonly<{
	applicationClient?: TerminayClient;
	serverName: string;
	harnessSwitches?: Readonly<Record<string, boolean>>;
	onHarnessSwitchChange?: (key: string, enabled: boolean) => void;
	/** Presents the extensions as a Settings collection: the list column and one detail. */
	collection?: Readonly<{
		selectedId?: string;
		onSelect: (id: string) => void;
		/** Told the extensions on the server, for the sidebar count and Settings search. */
		onExtensionsChange?: (extensions: readonly ExtensionSummaryDto[]) => void;
		render: (parts: SettingsCategoryParts) => ReactNode;
	}>;
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

	const onExtensionsChange = collection?.onExtensionsChange;
	useEffect(() => {
		onExtensionsChange?.(extensions);
	}, [extensions, onExtensionsChange]);

	const errorBanner = error ? (
		<div className="settings-inline-error" role="alert">
			<span>{error}</span>
			<button type="button" className="settings-secondary-button settings-secondary-button--small" onClick={() => void refresh()}>Retry</button>
		</div>
	) : null;
	const manager = (selectedId?: string) => (
		<ExtensionManager
			{...(selectedId === undefined ? {} : { selectedId })}
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
	);
	const statusLines = (
		<>
			{busy ? <div className="settings-status-message" role="status"><progress /> Working on {authorityLabel}…</div> : null}
			{announcement ? <div className="settings-status-message" role="status">{announcement}</div> : null}
		</>
	);

	if (collection !== undefined) {
		const selectedId =
			collection.selectedId !== undefined &&
			extensions.some((extension) => extension.id === collection.selectedId)
				? collection.selectedId
				: EXTENSIONS_INSTALL_ID;
		const toItem = (extension: ExtensionSummaryDto) => ({
			id: extension.id,
			label: extension.displayName,
			...extensionListStatus(extension),
		});
		const sections: SettingsListSection[] = [
			{
				id: 'install',
				label: '',
				items: [{ id: EXTENSIONS_INSTALL_ID, label: 'Install extension…', status: 'From npm or a package file' }],
			},
			{
				id: 'built-in',
				label: 'Built-in',
				items: extensions.filter((extension) => extension.official).map(toItem),
			},
			{
				id: 'custom',
				label: 'Custom',
				emptyNote: 'Extensions you install appear here.',
				items: extensions.filter((extension) => !extension.official).map(toItem),
			},
		];
		const selected = extensions.find((extension) => extension.id === selectedId);
		return collection.render({
			list: (
				<SettingsListColumn title="Extensions">
					<SettingsListSections
						label="Extensions"
						sections={sections.filter((section) => section.items.length > 0 || section.emptyNote !== undefined)}
						selectedId={selectedId}
						onSelect={collection.onSelect}
					/>
				</SettingsListColumn>
			),
			detailTitle: selected?.displayName ?? 'Install extension',
			detail: (
				<div id="section-extensions" aria-busy={busy}>
					{errorBanner}
					{manager(selectedId)}
					{statusLines}
				</div>
			),
		});
	}

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
