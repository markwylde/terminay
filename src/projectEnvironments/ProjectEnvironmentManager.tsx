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

type StatusAction = NonNullable<
	ProjectEnvironmentSummaryDto['statusCard']
>['actions'][number];

export function ProjectEnvironmentManager({
	environments,
	providers,
	serverName,
	onCreate,
	onCreateEnvironment,
	onEdit,
	onTest,
	onRemove,
	onAction,
	detail,
}: Readonly<{
	environments: readonly ProjectEnvironmentSummaryDto[];
	providers: readonly ProviderSummary[];
	serverName: string;
	onCreate: (providerId: string) => void;
	onCreateEnvironment: (providerId: string, profileId: string) => void;
	onEdit: (environment: ProjectEnvironmentSummaryDto) => void;
	onTest: (id: string) => void;
	onRemove: (id: string) => void;
	onAction: (
		environment: ProjectEnvironmentSummaryDto,
		action: StatusAction,
	) => void;
	detail?: ReactNode;
}>) {
	const [query, setQuery] = useState('');
	const [addMenuOpen, setAddMenuOpen] = useState(false);
	const [selectedId, setSelectedId] = useState(environments[0]?.id ?? '');
	const filtered = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		return environments.filter((item) =>
			`${item.name} ${item.providerLabel} ${item.endpointSummary}`
				.toLowerCase()
				.includes(normalized),
		);
	}, [environments, query]);
	const selected =
		environments.find((item) => item.id === selectedId) ?? filtered[0];

	useEffect(() => {
		if (selectedId === '' && environments[0] !== undefined) {
			setSelectedId(environments[0].id);
		}
	}, [environments, selectedId]);

	return (
		<SharedSettingsRouteBody
			title="Project Environments"
			query={query}
			queryPlaceholder="Search environments..."
			categories={filtered.map((environment) => ({
				id: environment.id,
				label: environment.name,
				icon: (
					<span className={`environment-nav-status environment-nav-status--${environment.status}`}>
						<span aria-hidden="true" />
						<span className="sr-only">{statusLabel(environment.status)}</span>
					</span>
				),
			}))}
			activeCategoryId={selected?.id ?? ''}
			status={`${environments.length} ${environments.length === 1 ? 'environment' : 'environments'} on ${serverName}`}
			onQueryChange={setQuery}
			onCategorySelect={setSelectedId}
			sidebarAction={
				providers.some((provider) => provider.hasProfileForm) ? (
					<details
						className="environment-add-menu"
						open={addMenuOpen}
						onToggle={(event) => setAddMenuOpen(event.currentTarget.open)}
					>
						<summary className="settings-primary-button">Add connection</summary>
						<div className="environment-add-menu__items">
							{providers.filter((provider) => provider.hasProfileForm).map((provider) => (
								<button
									key={provider.providerId}
									type="button"
									onClick={() => {
										setAddMenuOpen(false);
										onCreate(provider.providerId);
									}}
								>
									New {provider.displayName}
								</button>
							))}
						</div>
					</details>
				) : undefined
			}
		>
			{detail ?? (
			<>
			<div className="settings-category-header environment-category-header">
				<div>
					<h2>{selected?.name ?? 'Project Environments'}</h2>
					<p>
						{selected === undefined
							? `Profiles and credentials stored by ${serverName}.`
							: `${selected.providerLabel} · ${selected.endpointSummary}`}
					</p>
				</div>
				<div className="settings-inline-actions">
					{selected?.profileOnly && selected.profileId !== undefined && providers.find((provider) => provider.providerId === selected.providerId)?.hasCreateForm ? (
						<button type="button" className="settings-primary-button" onClick={() => onCreateEnvironment(selected.providerId, selected.profileId!)}>New {providers.find((provider) => provider.providerId === selected.providerId)?.displayName} project</button>
					) : null}
				</div>
			</div>

			{selected === undefined ? (
				<div className="settings-empty-hero">
					<h2>No matching environments</h2>
					<p>Change your search or add a connection provider.</p>
				</div>
			) : (
				<>
					<section className="settings-section">
						<h3 className="settings-section-title">Connection</h3>
						<div className="settings-group">
							<EnvironmentRow label="Status" value={statusLabel(selected.status)} />
							<EnvironmentRow label="Endpoint" value={selected.endpointSummary} />
							<EnvironmentRow label="Default root" value={selected.defaultRoot ?? 'Environment home'} />
							<EnvironmentRow label="Projects" value={String(selected.referencedProjectCount)} />
						</div>
					</section>

					{selected.statusCard === undefined ? null : (
						<section className="settings-section" aria-label={selected.statusCard.title}>
							<h3 className="settings-section-title">{selected.statusCard.title}</h3>
							<div className="settings-group">
								<div className="settings-row settings-row--stacked">
									<span className="settings-row-description">{selected.statusCard.summary}</span>
								</div>
								{selected.statusCard.facts.map((fact) => (
									<EnvironmentRow key={fact.label} label={fact.label} value={fact.value} />
								))}
								<div className="settings-group-footer">
									<div className="settings-inline-actions">
										{selected.statusCard.actions.map((action) => (
											<button
												key={action.id}
												type="button"
												className={action.kind === 'destructive' ? 'settings-danger-button' : 'settings-secondary-button'}
												disabled={action.disabledReason !== undefined}
												onClick={() => onAction(selected, action)}
											>
												{action.label}
											</button>
										))}
									</div>
								</div>
							</div>
						</section>
					)}

					<section className="settings-section">
						<h3 className="settings-section-title">Management</h3>
						<div className="settings-group">
							<div className="settings-row">
								<div className="settings-row-info">
									<span className="settings-row-label">Connection profile</span>
									<span className="settings-row-description">
										{selected.isThisServer
											? 'This built-in environment is managed by Terminay.'
											: selected.referencedProjectCount > 0
												? `Used by ${selected.referencedProjectCount} project${selected.referencedProjectCount === 1 ? '' : 's'}. Removal is unavailable while referenced.`
												: 'Test, edit, or remove this saved connection.'}
									</span>
								</div>
								<div className="settings-row-control settings-inline-actions">
									<button type="button" className="settings-secondary-button" disabled={selected.isThisServer || selected.profileId === undefined} onClick={() => selected.profileId && onTest(selected.profileId)}>Test</button>
									<button type="button" className="settings-secondary-button" disabled={selected.isThisServer || selected.profileId === undefined} onClick={() => onEdit(selected)}>Edit</button>
									<button type="button" className="settings-danger-button" disabled={selected.isThisServer || selected.profileId === undefined || selected.referencedProjectCount > 0} onClick={() => selected.profileId && onRemove(selected.profileId)}>Remove</button>
								</div>
							</div>
						</div>
					</section>
				</>
			)}
			</>
			)}
		</SharedSettingsRouteBody>
	);
}

function EnvironmentRow({ label, value }: Readonly<{ label: string; value: string }>) {
	return (
		<div className="settings-row">
			<div className="settings-row-info">
				<span className="settings-row-label">{label}</span>
			</div>
			<div className="settings-row-control environment-setting-value">{value}</div>
		</div>
	);
}
