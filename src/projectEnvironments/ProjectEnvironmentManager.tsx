import { useMemo, useState } from 'react';
import type { ProjectEnvironmentSummaryDto } from './uiModel';
import { statusLabel } from './uiModel';

export function ProjectEnvironmentManager({ environments, providers, serverName, onCreate, onEdit, onTest, onRemove,onAction }: Readonly<{
	environments: readonly ProjectEnvironmentSummaryDto[];
	providers:readonly Readonly<{providerId:string;displayName:string;hasProfileForm:boolean}>[];
	serverName: string;
	onCreate: (providerId:string) => void;
	onEdit: (environment:ProjectEnvironmentSummaryDto) => void;
	onTest: (id: string) => void;
	onRemove: (id: string) => void;
	onAction:(environment:ProjectEnvironmentSummaryDto,action:NonNullable<ProjectEnvironmentSummaryDto['statusCard']>['actions'][number])=>void;
}>) {
	const [query, setQuery] = useState('');
	const [selectedId, setSelectedId] = useState(environments[0]?.id ?? '');
	const filtered = useMemo(() => environments.filter((item) => `${item.name} ${item.providerLabel} ${item.endpointSummary}`.toLowerCase().includes(query.trim().toLowerCase())), [environments, query]);
	const selected = environments.find((item) => item.id === selectedId) ?? filtered[0];
	return (
		<div className="environment-manager">
			<header className="management-route-header"><div><p className="management-route-eyebrow">Selected Terminay Server</p><h2>Project Environments</h2><p>Profiles and credentials are stored by <strong>{serverName}</strong>.</p></div><div className="management-route-actions">{providers.filter(provider=>provider.hasProfileForm).map(provider=><button key={provider.providerId} type="button" onClick={()=>onCreate(provider.providerId)}>New {provider.displayName}</button>)}</div></header>
			<div className="management-route-grid">
				<aside className="management-route-list" aria-label="Project environments">
					<label><span className="sr-only">Search project environments</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search environments" /></label>
					{filtered.map((item) => <button type="button" key={item.id} className={item.id === selected?.id ? 'is-selected' : ''} onClick={() => setSelectedId(item.id)}><span><strong>{item.name}</strong><small>{item.providerLabel} · {item.endpointSummary}</small></span><span className={`environment-status environment-status--${item.status}`}>{statusLabel(item.status)}</span></button>)}
					{filtered.length === 0 ? <p role="status">No matching environments.</p> : null}
				</aside>
				<section className="management-route-detail" aria-live="polite">
					{selected ? <><div className="management-route-title"><span className="management-route-icon" aria-hidden="true">{selected.isThisServer ? '›_' : selected.providerLabel === 'SSH' ? '⇄' : '⬡'}</span><div><h3>{selected.name}</h3><p>{selected.providerLabel}</p></div></div><dl><div><dt>Status</dt><dd>{statusLabel(selected.status)}</dd></div><div><dt>Endpoint</dt><dd>{selected.endpointSummary}</dd></div><div><dt>Default root</dt><dd>{selected.defaultRoot ?? 'Environment home'}</dd></div><div><dt>Projects</dt><dd>{selected.referencedProjectCount}</dd></div></dl>{selected.statusCard?<section className="environment-trust-card" aria-label={selected.statusCard.title}><h4>{selected.statusCard.title}</h4><p>{selected.statusCard.summary}</p><dl>{selected.statusCard.facts.map(fact=><div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl><div className="management-route-actions">{selected.statusCard.actions.map(action=><button key={action.id} type="button" className={action.kind==='destructive'?'danger':undefined} disabled={action.disabledReason!==undefined} onClick={()=>onAction(selected,action)}>{action.label}</button>)}</div></section>:null}<div className="management-route-actions"><button type="button" disabled={selected.isThisServer||selected.profileId===undefined} onClick={() => selected.profileId&&onTest(selected.profileId)}>Test</button><button type="button" disabled={selected.isThisServer||selected.profileId===undefined} onClick={()=>onEdit(selected)}>Edit</button><button type="button" className="danger" disabled={selected.isThisServer || selected.profileId===undefined || selected.referencedProjectCount > 0} onClick={() => selected.profileId&&onRemove(selected.profileId)}>Remove</button></div>{selected.referencedProjectCount > 0 ? <p className="management-route-note">Removal is blocked while projects reference this environment.</p> : null}</> : <p>Select an environment.</p>}
				</section>
			</div>
		</div>
	);
}
