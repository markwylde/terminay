import { ExtensionsClient, ProjectEnvironmentsClient, TerminayClientFacade } from '@terminay/client-core';
import type { TerminayClient } from '@terminay/client-core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DeclarativeProviderForm } from './DeclarativeProviderForm';
import { ExtensionManager } from './ExtensionManager';
import { ProjectEnvironmentManager } from './ProjectEnvironmentManager';
import { SSH_PROFILE_FORM_FIXTURE } from './uiModel';
import type { ExtensionSummaryDto, ProjectEnvironmentSummaryDto } from './uiModel';
import './projectEnvironments.css';

export type ProjectEnvironmentSurface = 'environments' | 'extensions' | 'new-ssh';

export function ProjectEnvironmentSurfaceDialog({ surface: requestedSurface, serverName, applicationClient, onClose }: Readonly<{
	surface: ProjectEnvironmentSurface;
	serverName: string;
	applicationClient?: TerminayClient;
	onClose: () => void;
}>) {
	const closeRef = useRef<HTMLButtonElement>(null);
	const [surface, setSurface] = useState(requestedSurface);
	const [environments, setEnvironments] = useState<readonly ProjectEnvironmentSummaryDto[]>([]);
	const [extensions, setExtensions] = useState<readonly ExtensionSummaryDto[]>([]);
	const [extensionRevision, setExtensionRevision] = useState(0);
	const [authorityLabel, setAuthorityLabel] = useState(serverName);
	const [announcement, setAnnouncement] = useState('');
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const clients = useMemo(() => {
		if (applicationClient === undefined) return null;
		const transport = new TerminayClientFacade(applicationClient);
		return { environments: new ProjectEnvironmentsClient(transport), extensions: new ExtensionsClient(transport) };
	}, [applicationClient]);
	const refresh = useCallback(async () => {
		if (clients === null) { setError('The selected Terminay Server does not provide an authenticated application client.'); return; }
		setBusy(true); setError('');
		try {
			if (surface === 'extensions') {
				const snapshot = await clients.extensions.list();
				setExtensions(snapshot.extensions);
				setExtensionRevision(snapshot.revision);
				setAuthorityLabel(snapshot.authorityLabel);
			} else if (surface === 'environments') {
				const snapshot = await clients.environments.snapshot();
				setEnvironments(snapshot.environments);
			}
		} catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
		finally { setBusy(false); }
	}, [clients, surface]);
	useEffect(() => { void refresh(); }, [refresh]);
	useEffect(() => {
		closeRef.current?.focus();
		const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
		window.addEventListener('keydown', keydown);
		return () => window.removeEventListener('keydown', keydown);
	}, [onClose]);
	const run = useCallback(async (action: () => Promise<unknown>, success: string) => {
		setBusy(true); setError(''); setAnnouncement('Operation started.');
		try { await action(); setAnnouncement(success); await refresh(); }
		catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setAnnouncement(''); }
		finally { setBusy(false); }
	}, [refresh]);
	return (
		<div className="project-environment-surface-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
			<section className="project-environment-surface" role="dialog" aria-modal="true" aria-label={surface === 'extensions' ? 'Extensions' : surface === 'new-ssh' ? 'New SSH connection' : 'Project Environments'} aria-busy={busy}>
				<div className="project-environment-surface__close"><button ref={closeRef} type="button" onClick={onClose} aria-label="Close">×</button></div>
				<div className="project-environment-surface__body">
					{error ? <div className="declarative-provider-form__errors" role="alert"><strong>Unable to complete the server operation</strong><p>{error}</p><button type="button" onClick={() => void refresh()}>Retry</button></div> : null}
					{surface === 'environments' ? <ProjectEnvironmentManager environments={environments} serverName={authorityLabel} onCreateSsh={() => setSurface('new-ssh')} onTest={(id) => run(() => clients!.environments.testProfile(id), 'Connection test completed.')} onRemove={(id) => run(() => clients!.environments.removeProfile(id), 'Environment removed.')} /> : null}
					{surface === 'extensions' ? <ExtensionManager extensions={extensions} serverName={authorityLabel} revision={extensionRevision} onPreview={(spec) => clients!.extensions.previewInstall(spec)} onInstall={(digest) => run(() => clients!.extensions.install(digest, extensionRevision), 'Extension installed.')} onAction={(action,id) => run(() => clients!.extensions.action(action,id,extensionRevision), `Extension ${action} completed.`)} /> : null}
					{surface === 'new-ssh' ? <DeclarativeProviderForm form={SSH_PROFILE_FORM_FIXTURE} onCancel={() => setSurface('environments')} onSubmit={async (values) => { await run(() => clients!.environments.createProfile('terminay.ssh', values), 'SSH connection saved.'); setSurface('environments'); }} /> : null}
					{busy ? <div className="management-route-announcement" role="status"><progress /> Working on {authorityLabel}…</div> : null}
					{announcement ? <div className="management-route-announcement" role="status">{announcement}</div> : null}
				</div>
			</section>
		</div>
	);
}
