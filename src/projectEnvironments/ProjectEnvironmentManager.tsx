import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { SharedSettingsRouteBody } from '../shared/SharedSettingsRouteBody';
import type { ProjectEnvironmentSummaryDto } from './uiModel';
import { statusLabel } from './uiModel';

type ProviderSummary = Readonly<{
	providerId: string;
	displayName: string;
	hasProfileForm: boolean;
	hasCreateForm: boolean;
}>;

type ProviderProfile = Readonly<{
	id: string;
	providerId: string;
	name: string;
	endpointSummary: string;
	defaultRoot?: string;
	initialValues: Readonly<Record<string, string | boolean>>;
}>;

type StatusAction = NonNullable<ProjectEnvironmentSummaryDto['statusCard']>['actions'][number];
type ProviderItem = Readonly<{ kind: 'provider'; id: string; profile: ProviderProfile; provider: ProviderSummary; connectionCount: number }>;
type ConnectionItem = Readonly<{ kind: 'connection'; id: string; environment: ProjectEnvironmentSummaryDto; provider?: ProviderSummary; profile?: ProviderProfile; ownerName?: string }>;
type ManagementItem = ProviderItem | ConnectionItem;
export type ProjectEnvironmentSelectionHint = Readonly<{
	providerId: string;
	providerName: string;
}>;

/** Presents server-owned providers separately from selectable project connections. */
export function ProjectEnvironmentManager({
	environments, profiles, providers, serverName, onCreateProfile,
	onCreateEnvironment, onEditProfile, onTestProfile, onRemoveProfile, onRemoveConnection, onAction, detail,
	selectionHint, onSelectionHintHandled, operationNotice,
}: Readonly<{
	environments: readonly ProjectEnvironmentSummaryDto[];
	profiles: readonly ProviderProfile[];
	providers: readonly ProviderSummary[];
	serverName: string;
	onCreateProfile: (providerId: string) => void;
	onCreateEnvironment: (providerId: string, profileId: string) => void;
	onEditProfile: (profile: ProviderProfile) => void;
	onTestProfile: (profileId: string) => void;
	onRemoveProfile: (profileId: string) => void;
	onRemoveConnection: (environment: ProjectEnvironmentSummaryDto) => void;
	onAction: (environment: ProjectEnvironmentSummaryDto, action: StatusAction) => void;
	detail?: ReactNode;
	/** A server-operation failure belongs in the scrollable settings content,
	 * above the selected detail/form.  It must never be a fixed overlay: those
	 * obscure the very controls needed to recover from the failure. */
	operationNotice?: ReactNode;
	selectionHint?: ProjectEnvironmentSelectionHint | null;
	onSelectionHintHandled?: () => void;
}>) {
	const [query, setQuery] = useState('');
	const [addMenuOpen, setAddMenuOpen] = useState(false);
	const [selectedId, setSelectedId] = useState('');
	const providerById = useMemo(() => new Map(providers.map((provider) => [provider.providerId, provider])), [providers]);
	const providerItems = useMemo<readonly ProviderItem[]>(() => profiles.flatMap((profile) => {
		const provider = providerById.get(profile.providerId);
		if (provider?.hasCreateForm !== true) return [];
		return [{ kind: 'provider' as const, id: `provider:${profile.id}`, profile, provider,
			connectionCount: environments.filter((environment) => environment.profileId === profile.id).length }];
	}), [environments, profiles, providerById]);
	const connectionItems = useMemo<readonly ConnectionItem[]>(() => environments.map((environment) => {
		const profile = environment.profileId === undefined
			? undefined
			: profiles.find((candidate) => candidate.id === environment.profileId);
		return {
			kind: 'connection' as const,
			id: `connection:${environment.id}`,
			environment,
			provider: providerById.get(environment.providerId),
			...(profile === undefined ? {} : { profile, ownerName: profile.name }),
		};
	}), [environments, profiles, providerById]);
	const items = useMemo<readonly ManagementItem[]>(() => [...providerItems, ...connectionItems], [connectionItems, providerItems]);
	const filtered = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		return items.filter((item) => (item.kind === 'provider'
			? `${item.profile.name} ${item.provider.displayName} ${item.profile.endpointSummary}`
			: `${item.environment.name} ${item.environment.providerLabel} ${item.environment.endpointSummary}`)
			.toLowerCase().includes(normalized));
	}, [items, query]);
	const selected = items.find((item) => item.id === selectedId) ?? filtered[0] ?? items[0];
	const selectedProviderConnections = selected?.kind === 'provider'
		? connectionItems.filter((connection) => connection.environment.profileId === selected.profile.id) : [];

	useEffect(() => { if (selectedId === '' && items[0] !== undefined) setSelectedId(items[0].id); }, [items, selectedId]);
	useEffect(() => {
		if (selectionHint === null || selectionHint === undefined) return;
		const provider = providerItems.find((item) =>
			item.profile.providerId === selectionHint.providerId &&
			item.profile.name === selectionHint.providerName,
		);
		if (provider === undefined) return;
		setSelectedId(provider.id);
		onSelectionHintHandled?.();
	}, [onSelectionHintHandled, providerItems, selectionHint]);
	const providerCreateActions = providers.filter((provider) => provider.hasProfileForm && provider.hasCreateForm);
	const connectionCreateActions = providers.filter((provider) => provider.hasProfileForm && !provider.hasCreateForm);

	return <SharedSettingsRouteBody
		title="Project Environments" query={query} queryPlaceholder="Search providers and connections..." categories={[]}
		categorySections={[
			{ id: 'providers', label: 'Providers', categories: filtered.filter((item): item is ProviderItem => item.kind === 'provider').map((item) => ({ id: item.id, label: item.profile.name, icon: <span className="environment-nav-provider" aria-hidden="true">◆</span> })) },
			{ id: 'connections', label: 'Connections', categories: filtered.filter((item): item is ConnectionItem => item.kind === 'connection').map((item) => ({ id: item.id, label: item.environment.name, icon: <span className={`environment-nav-status environment-nav-status--${item.environment.status}`}><span aria-hidden="true" /><span className="sr-only">{statusLabel(item.environment.status)}</span></span> })) },
		]}
		activeCategoryId={selected?.id ?? ''}
		status={`${providerItems.length} ${providerItems.length === 1 ? 'provider' : 'providers'} · ${connectionItems.length} ${connectionItems.length === 1 ? 'connection' : 'connections'} on ${serverName}`}
		onQueryChange={setQuery} onCategorySelect={setSelectedId}
		sidebarAction={providerCreateActions.length + connectionCreateActions.length === 0 ? undefined : (
			<details className="environment-add-menu" open={addMenuOpen} onToggle={(event) => setAddMenuOpen(event.currentTarget.open)}>
				<summary className="settings-primary-button">Add</summary>
				<div className="environment-add-menu__items">
					{providerCreateActions.map((provider) => <button key={provider.providerId} type="button" onClick={() => { setAddMenuOpen(false); onCreateProfile(provider.providerId); }}>New {provider.displayName.replace(/ VM$/i, '')} provider…</button>)}
					{connectionCreateActions.map((provider) => <button key={provider.providerId} type="button" onClick={() => { setAddMenuOpen(false); onCreateProfile(provider.providerId); }}>Add {provider.displayName} connection…</button>)}
				</div>
			</details>
		)}
	>
		{operationNotice}
		{detail ?? (selected === undefined ? <div className="settings-empty-hero"><h2>No matching providers or connections</h2><p>Change your search or add a provider or connection.</p></div>
			: selected.kind === 'provider' ? <ProviderDetail item={selected} connections={selectedProviderConnections} onCreateConnection={() => onCreateEnvironment(selected.provider.providerId, selected.profile.id)} onBrowseConnection={(connection) => setSelectedId(connection.id)} onForgetConnection={(connection) => onRemoveConnection(connection.environment)} onEdit={() => onEditProfile(selected.profile)} onTest={() => onTestProfile(selected.profile.id)} onRemove={() => onRemoveProfile(selected.profile.id)} />
			: <ConnectionDetail item={selected} onAction={onAction} onEditProfile={onEditProfile} onTestProfile={onTestProfile} onRemoveProfile={onRemoveProfile} onRemoveConnection={onRemoveConnection} />)}
	</SharedSettingsRouteBody>;
}

function ProviderDetail({ item, connections, onCreateConnection, onBrowseConnection, onForgetConnection, onEdit, onTest, onRemove }: Readonly<{
	item: ProviderItem; connections: readonly ConnectionItem[]; onCreateConnection: () => void;
	onBrowseConnection: (connection: ConnectionItem) => void; onForgetConnection: (connection: ConnectionItem) => void; onEdit: () => void; onTest: () => void; onRemove: () => void;
}>) {
	const isPuzed = item.provider.displayName.toLowerCase().includes('puzed');
	return <>
		<div className="settings-category-header environment-category-header"><div><h2>{item.profile.name}</h2><p>{item.provider.displayName.replace(/ VM$/i, '')} provider · {item.profile.endpointSummary}</p></div><div className="settings-inline-actions"><button type="button" className="settings-primary-button" onClick={onCreateConnection}>{isPuzed ? 'Create VM…' : 'Add connection…'}</button></div></div>
		<section className="settings-section"><h3 className="settings-section-title">Provider</h3><div className="settings-group"><EnvironmentRow label="Service" value={item.provider.displayName.replace(/ VM$/i, '')} /><EnvironmentRow label="Endpoint" value={item.profile.endpointSummary} /><EnvironmentRow label="Connections" value={String(item.connectionCount)} /><div className="settings-group-footer"><div className="settings-inline-actions"><button type="button" className="settings-secondary-button" onClick={onTest}>Test provider</button><button type="button" className="settings-secondary-button" onClick={onEdit}>Edit provider</button><button type="button" className="settings-danger-button" disabled={item.connectionCount > 0} onClick={onRemove}>Remove provider</button></div></div></div></section>
		<section className="settings-section"><h3 className="settings-section-title">Connections</h3><div className="settings-group">{connections.length === 0 ? <div className="settings-row settings-row--stacked"><span className="settings-row-description">No Terminay VM connections yet. Creating a VM keeps this provider selected.</span></div> : connections.map((connection) => <div className="settings-row" key={connection.id}><div className="settings-row-info"><span className="settings-row-label">{connection.environment.name}</span><span className="settings-row-description">{connection.environment.endpointSummary} · {statusLabel(connection.environment.status)}</span></div><div className="settings-row-control settings-inline-actions"><button type="button" className="settings-secondary-button" onClick={() => onBrowseConnection(connection)}>{isPuzed ? 'View VM' : 'View connection'}</button><button type="button" className="settings-danger-button" disabled={connection.environment.referencedProjectCount > 0} onClick={() => onForgetConnection(connection)}>Remove connection</button></div></div>)}</div></section>
	</>;
}

function ConnectionDetail({ item, onAction, onEditProfile, onTestProfile, onRemoveProfile, onRemoveConnection }: Readonly<{
	item: ConnectionItem; onAction: (environment: ProjectEnvironmentSummaryDto, action: StatusAction) => void;
	onEditProfile: (profile: ProviderProfile) => void; onTestProfile: (profileId: string) => void; onRemoveProfile: (profileId: string) => void; onRemoveConnection: (environment: ProjectEnvironmentSummaryDto) => void;
}>) {
	const environment = item.environment;
	const profileIsProvider = item.provider?.hasCreateForm === true;
	return <>
		<div className="settings-category-header environment-category-header"><div><h2>{environment.name}</h2><p>{environment.providerLabel} connection · {environment.endpointSummary}</p></div></div>
		<section className="settings-section"><h3 className="settings-section-title">Connection</h3><div className="settings-group"><EnvironmentRow label="Status" value={statusLabel(environment.status)} /><EnvironmentRow label="Provider" value={item.ownerName === undefined ? environment.providerLabel : `${item.ownerName} · ${environment.providerLabel}`} /><EnvironmentRow label="Endpoint" value={environment.endpointSummary} /><EnvironmentRow label="Default root" value={environment.defaultRoot ?? 'Environment home'} /><EnvironmentRow label="Projects" value={String(environment.referencedProjectCount)} /></div></section>
		{environment.statusCard === undefined ? null : <section className="settings-section" aria-label={environment.statusCard.title}><h3 className="settings-section-title">Connection actions</h3><div className="settings-group"><div className="settings-row settings-row--stacked"><span className="settings-row-description">{environment.statusCard.summary}</span></div>{environment.statusCard.facts.map((fact) => <EnvironmentRow key={fact.label} label={fact.label} value={fact.value} />)}<div className="settings-group-footer"><div className="settings-inline-actions">{environment.statusCard.actions.map((action) => <button key={action.id} type="button" className={action.kind === 'destructive' ? 'settings-danger-button' : 'settings-secondary-button'} disabled={action.disabledReason !== undefined} onClick={() => onAction(environment, action)}>{action.label}</button>)}</div></div></div></section>}
		{environment.isThisServer ? null : <section className="settings-section"><h3 className="settings-section-title">Manage connection</h3><div className="settings-group"><div className="settings-row"><div className="settings-row-info"><span className="settings-row-label">{profileIsProvider ? 'Terminay VM connection' : 'Saved SSH connection'}</span><span className="settings-row-description">{environment.referencedProjectCount > 0 ? `Used by ${environment.referencedProjectCount} project${environment.referencedProjectCount === 1 ? '' : 's'}. Removal is unavailable while referenced.` : 'Remove this saved Terminay connection. This never deletes or powers off its remote machine.'}</span></div><div className="settings-row-control settings-inline-actions">{profileIsProvider || item.profile === undefined ? null : <><button type="button" className="settings-secondary-button" onClick={() => onTestProfile(item.profile!.id)}>Test</button><button type="button" className="settings-secondary-button" onClick={() => onEditProfile(item.profile!)}>Edit</button><button type="button" className="settings-danger-button" disabled={environment.referencedProjectCount > 0} onClick={() => onRemoveProfile(item.profile!.id)}>Remove</button></>}<button type="button" className="settings-danger-button" disabled={environment.referencedProjectCount > 0} onClick={() => onRemoveConnection(environment)}>Remove connection</button></div></div></div></section>}
	</>;
}

function EnvironmentRow({ label, value }: Readonly<{ label: string; value: string }>) {
	return <div className="settings-row"><div className="settings-row-info"><span className="settings-row-label">{label}</span></div><div className="settings-row-control environment-setting-value">{value}</div></div>;
}
