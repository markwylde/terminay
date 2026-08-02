import type {
	ShellProfileCatalogue,
	ShellProfileCatalogueEntry,
	ShellProfileCwdPolicy,
	ShellProfileDefinition,
	ShellProfilesClient,
} from '@terminay/client-core';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';

type EditableProfile = {
	id: string;
	name: string;
	targetKind: 'system' | 'executable' | 'wsl';
	executable: string;
	distribution: string;
	shellPath: string;
	args: string[];
	startupMode: 'default' | 'login' | 'non-login';
	environment: Array<{ key: string; value: string; remove: boolean }>;
	icon: string;
	color: string;
};

export interface ShellProfilesSettingsProps {
	readonly client: ShellProfilesClient;
	readonly serverIdentity: string;
}

function editableProfile(profile?: ShellProfileCatalogueEntry | ShellProfileDefinition, preserveIdentity = false): EditableProfile {
	const environment = profile && 'environment' in profile ? profile.environment : {};
	return {
		id: preserveIdentity && profile ? profile.id : `profile:${crypto.randomUUID()}`,
		name: preserveIdentity && profile ? profile.name : profile ? `${profile.name} copy` : 'New shell profile',
		targetKind: profile?.target.kind ?? 'executable',
		executable: profile?.target.kind === 'executable' ? profile.target.executable : '',
		distribution: profile?.target.kind === 'wsl' ? profile.target.distribution : '',
		shellPath: profile?.target.kind === 'wsl' ? (profile.target.shellPath ?? '') : '',
		args: [...(profile?.args ?? [])],
		startupMode: profile?.startupMode ?? 'default',
		environment: Object.entries(environment).map(([key, value]) => ({ key, value: value ?? '', remove: value === null })),
		icon: profile?.icon ?? '',
		color: profile?.color ?? '',
	};
}

export function toShellProfileDefinition(draft: EditableProfile): ShellProfileDefinition {
	const environment: Record<string, string | null> = {};
	for (const row of draft.environment) {
		const key = row.key.trim();
		if (key) environment[key] = row.remove ? null : row.value;
	}
	const target = draft.targetKind === 'system'
		? { kind: 'system' as const }
		: draft.targetKind === 'wsl'
			? { kind: 'wsl' as const, distribution: draft.distribution.trim(), ...(draft.shellPath.trim() ? { shellPath: draft.shellPath.trim() } : {}) }
			: { kind: 'executable' as const, executable: draft.executable.trim() };
	return {
		id: draft.id,
		name: draft.name.trim(),
		target,
		args: draft.args,
		startupMode: draft.startupMode,
		environment,
		...(draft.icon.trim() ? { icon: draft.icon.trim() } : {}),
		...(draft.color.trim() ? { color: draft.color.trim() } : {}),
	};
}

function targetSummary(profile: ShellProfileCatalogueEntry): string {
	switch (profile.target.kind) {
		case 'system': return 'Resolved from the server account';
		case 'executable': return profile.target.executable;
		case 'wsl': return `WSL · ${profile.target.distribution}${profile.target.shellPath ? ` · ${profile.target.shellPath}` : ''}`;
	}
}

function mutationMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'The shell profile change could not be saved.';
}

export function ShellProfilesSettings({ client, serverIdentity }: ShellProfilesSettingsProps) {
	const [catalogue, setCatalogue] = useState<ShellProfileCatalogue | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [query, setQuery] = useState('');
	const [editing, setEditing] = useState<EditableProfile | null>(null);
	const [editingExisting, setEditingExisting] = useState(false);
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
	const [announcement, setAnnouncement] = useState('');
	const editorHeadingRef = useRef<HTMLHeadingElement>(null);
	const editorRef = useRef<HTMLFormElement>(null);
	const editorReturnFocusRef = useRef<HTMLElement | null>(null);
	const isEditorOpen = editing !== null;

	useEffect(() => {
		let mounted = true;
		void client.catalogue().then((value) => { if (mounted) { setCatalogue(value); setLoadError(null); } }).catch((error) => { if (mounted) setLoadError(mutationMessage(error)); });
		return () => { mounted = false; };
	}, [client]);

	useEffect(() => {
		if (!isEditorOpen) return;
		editorReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const focusFrame = window.requestAnimationFrame(() => editorHeadingRef.current?.focus());
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				setEditing(null);
				return;
			}
			if (event.key !== 'Tab') return;
			const focusable = [...(editorRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex]:not([tabindex="-1"])') ?? [])].filter((element) => element.offsetParent !== null);
			if (focusable.length === 0) return;
			const first = focusable[0]!;
			const last = focusable[focusable.length - 1]!;
			if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
			else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
		};
		window.addEventListener('keydown', onKeyDown);
		return () => { window.cancelAnimationFrame(focusFrame); window.removeEventListener('keydown', onKeyDown); editorReturnFocusRef.current?.focus(); editorReturnFocusRef.current = null; };
	}, [isEditorOpen]);

	const groups = useMemo(() => {
		const normalized = query.trim().toLocaleLowerCase();
		const visible = (catalogue?.entries ?? []).filter((profile) => !normalized || `${profile.name} ${profile.source} ${targetSummary(profile)}`.toLocaleLowerCase().includes(normalized));
		return [
			{ kind: 'system', title: 'System default', entries: visible.filter((entry) => entry.kind === 'system') },
			{ kind: 'discovered', title: 'Discovered on this server', entries: visible.filter((entry) => entry.kind === 'discovered') },
			{ kind: 'custom', title: 'Custom profiles', entries: visible.filter((entry) => entry.kind === 'custom') },
		] as const;
	}, [catalogue, query]);

	const runMutation = async (operation: (revision: number) => Promise<ShellProfileCatalogue>, success: string) => {
		if (!catalogue || busy) return null;
		setBusy(true);
		setLoadError(null);
		try {
			const next = await operation(catalogue.settingsRevision);
			setCatalogue(next);
			setAnnouncement(success);
			return next;
		} catch (error) {
			setLoadError(mutationMessage(error));
			setAnnouncement('Shell profile change failed.');
			return null;
		} finally {
			setBusy(false);
		}
	};

	const saveProfile = async (event: FormEvent) => {
		event.preventDefault();
		if (!editing || !catalogue) return;
		const profile = toShellProfileDefinition(editing);
		setFieldErrors({});
		setBusy(true);
		try {
			const validation = await client.validate(profile);
			if (!validation.valid) {
				setFieldErrors({ ...validation.fieldErrors });
				setAnnouncement('Review the highlighted shell profile fields.');
				return;
			}
			const next = editingExisting
				? await client.update(profile, { expectedRevision: catalogue.settingsRevision })
				: await client.create((({ id: _draftId, ...definition }) => definition)(profile), { expectedRevision: catalogue.settingsRevision });
			setCatalogue(next);
			setEditing(null);
			setAnnouncement(`${profile.name} saved.`);
		} catch (error) {
			setLoadError(mutationMessage(error));
			setAnnouncement('Shell profile was not saved.');
		} finally {
			setBusy(false);
		}
	};

	const moveProfile = async (profile: ShellProfileCatalogueEntry, delta: -1 | 1) => {
		if (!catalogue) return;
		const customIds = catalogue.entries.filter((entry) => entry.kind === 'custom').map((entry) => entry.id);
		const index = customIds.indexOf(profile.id);
		const swap = index + delta;
		if (index < 0 || swap < 0 || swap >= customIds.length) return;
		[customIds[index], customIds[swap]] = [customIds[swap]!, customIds[index]!];
		await runMutation((revision) => client.reorder(customIds, { expectedRevision: revision }), `${profile.name} moved ${delta < 0 ? 'up' : 'down'}.`);
	};
	const editCustomProfile = async (profile: ShellProfileCatalogueEntry) => {
		setBusy(true);
		setLoadError(null);
		try {
			const detail = await client.detail(profile.id);
			setEditingExisting(true);
			setEditing(editableProfile(detail, true));
		} catch (error) {
			setLoadError(mutationMessage(error));
		} finally {
			setBusy(false);
		}
	};
	const deleteProfile = async (profile: ShellProfileCatalogueEntry) => {
		if (!catalogue || catalogue.defaultProfileId === profile.id || profile.projectReferences.length > 0) return;
		if (!confirm(`Delete ${profile.name}? Existing terminals will not change.`)) return;
		await runMutation((revision) => client.delete(profile.id, { expectedRevision: revision }), `${profile.name} deleted.`);
	};
	const resetProfiles = async () => {
		if (!confirm('Reset shell profiles? Custom profiles will be removed and new terminals will use System default with the current-panel directory policy. Existing terminals will not change.')) return;
		await runMutation((revision) => client.reset({ expectedRevision: revision }), 'Shell profiles reset.');
	};

	if (!catalogue) {
		return <div className="shell-profiles-loading" role={loadError ? 'alert' : 'status'}>{loadError ?? 'Loading shell profiles…'}</div>;
	}

	return <div className="shell-profiles" aria-busy={busy}>
		<div className="shell-profiles-server" role="note"><span className="shell-profiles-server__eyebrow">Connected server</span><strong>{serverIdentity}</strong><span>Executables and environment values run only on this server. Profiles are not shared with other connections.</span></div>
		{loadError ? <div className="shell-profiles-error" role="alert">{loadError}</div> : null}
		<div className="sr-only" aria-live="polite">{announcement}</div>
		<div className="shell-profiles-defaults">
			<label><span>Default shell profile</span><select value={catalogue.defaultProfileId} disabled={busy} onChange={(event) => void runMutation((revision) => client.setDefault(event.target.value, { expectedRevision: revision }), 'Server default profile changed.')}>
				{catalogue.entries.filter((profile) => profile.kind !== 'discovered').map((profile) => <option key={profile.id} value={profile.id} disabled={!profile.availability.available}>{profile.name}{profile.availability.available ? '' : ' — unavailable'}</option>)}
			</select><small>Used by new terminals unless a project or one-time choice overrides it.</small></label>
			<label><span>New terminals start in</span><select value={catalogue.cwdPolicy} disabled={busy} onChange={(event) => void runMutation((revision) => client.setCwdPolicy(event.target.value as ShellProfileCwdPolicy, { expectedRevision: revision }), 'Working-directory policy changed.')}>
				<option value="current">Current terminal or panel</option><option value="project">Project folder</option><option value="home">Home folder</option>
			</select><small>Current terminal or panel falls back safely to the project folder.</small></label>
		</div>
		<div className="shell-profiles-toolbar">
			<label className="shell-profiles-search"><span className="sr-only">Search shell profiles</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search profiles" /></label>
			<button type="button" className="settings-secondary-button settings-secondary-button--small" disabled={busy} onClick={() => void runMutation((revision) => client.refresh({ expectedRevision: revision }), 'Shell discovery refreshed.')}>Refresh discovery</button>
			<button type="button" className="settings-secondary-button settings-secondary-button--small" disabled={busy} onClick={() => void resetProfiles()}>Reset profiles</button>
			<button type="button" className="settings-primary-button" disabled={busy || catalogue.entries.filter((profile) => profile.kind === 'custom').length >= 64} title={catalogue.entries.filter((profile) => profile.kind === 'custom').length >= 64 ? 'This server already has the maximum of 64 custom profiles.' : 'Create a custom shell profile'} onClick={() => { setEditingExisting(false); setEditing(editableProfile()); }}>New profile</button>
		</div>
		<div className="shell-profile-groups">
			{groups.map((group) => group.entries.length ? <section key={group.kind} className="shell-profile-group" aria-labelledby={`shell-profile-group-${group.kind}`}><h4 id={`shell-profile-group-${group.kind}`}>{group.title}</h4><div className="shell-profile-list">
				{group.entries.map((profile) => <article key={profile.id} className={`shell-profile-card${profile.availability.available ? '' : ' shell-profile-card--unavailable'}`}>
					<div className="shell-profile-card__body"><div className="shell-profile-card__title"><span aria-hidden="true">{profile.icon || '›_'}</span><strong>{profile.name}</strong>{catalogue.defaultProfileId === profile.id ? <span className="shell-profile-badge">Server default</span> : null}{profile.projectReferences.length ? <span className="shell-profile-badge">{profile.projectReferences.length} project{profile.projectReferences.length === 1 ? '' : 's'}</span> : null}{profile.argumentCount ? <span className="shell-profile-badge">{profile.argumentCount} argument{profile.argumentCount === 1 ? '' : 's'}</span> : null}{profile.hasEnvironmentOverlay ? <span className="shell-profile-badge">{profile.environmentEntryCount} environment</span> : null}</div><div className="shell-profile-card__summary">{targetSummary(profile)}</div><div className="shell-profile-card__meta"><span>{profile.source}</span><span className={profile.availability.available ? 'is-available' : 'is-unavailable'}>{profile.availability.available ? 'Available' : profile.availability.reason ?? 'Unavailable'}</span></div></div>
					<div className="shell-profile-card__actions">{profile.kind === 'custom' ? <><button type="button" disabled={busy} onClick={() => void moveProfile(profile, -1)} aria-label={`Move ${profile.name} up`}>↑</button><button type="button" disabled={busy} onClick={() => void moveProfile(profile, 1)} aria-label={`Move ${profile.name} down`}>↓</button><button type="button" disabled={busy} onClick={() => void editCustomProfile(profile)}>Edit</button><button type="button" disabled={busy || catalogue.defaultProfileId === profile.id || profile.projectReferences.length > 0} title={catalogue.defaultProfileId === profile.id ? 'Choose another server default before deleting this profile.' : profile.projectReferences.length > 0 ? 'Choose another default in the referenced projects before deleting this profile.' : 'Delete profile'} onClick={() => void deleteProfile(profile)}>Delete</button></> : <button type="button" disabled={busy} onClick={() => { setEditingExisting(false); setEditing(editableProfile(profile)); }}>Copy</button>}</div>
				</article>)}
			</div></section> : null)}
			{groups.every((group) => group.entries.length === 0) ? <p className="shell-profiles-empty">No shell profiles match “{query}”.</p> : null}
		</div>
		{editing ? <div className="shell-profile-editor-backdrop" role="presentation"><form ref={editorRef} className="shell-profile-editor" role="dialog" aria-modal="true" aria-labelledby="shell-profile-editor-title" onSubmit={(event) => void saveProfile(event)}>
			<header><div><h3 id="shell-profile-editor-title" ref={editorHeadingRef} tabIndex={-1}>{editingExisting ? 'Edit shell profile' : 'Create shell profile'}</h3><p>This program executes on <strong>{serverIdentity}</strong>. Arguments are passed directly without shell parsing.</p></div><button type="button" aria-label="Close profile editor" onClick={() => setEditing(null)}>×</button></header>
			<div className="shell-profile-editor__fields"><label><span>Name</span><input value={editing.name} maxLength={128} autoComplete="off" onChange={(event) => setEditing({ ...editing, name: event.target.value })} aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? 'shell-profile-error-name' : undefined} />{fieldErrors.name ? <small id="shell-profile-error-name" className="shell-profile-field-error">{fieldErrors.name}</small> : null}</label>
				<div className="shell-profile-editor__row"><label><span>Target type</span><select value={editing.targetKind} onChange={(event) => setEditing({ ...editing, targetKind: event.target.value as EditableProfile['targetKind'] })}><option value="executable">Executable</option><option value="wsl">Windows Subsystem for Linux</option><option value="system">System default</option></select></label><label><span>Startup mode</span><select value={editing.startupMode} onChange={(event) => setEditing({ ...editing, startupMode: event.target.value as EditableProfile['startupMode'] })}><option value="default">Shell default</option><option value="login">Login</option><option value="non-login">Non-login</option></select></label></div>
				{editing.targetKind === 'executable' ? <label><span>Executable</span><input value={editing.executable} placeholder="/bin/zsh" onChange={(event) => setEditing({ ...editing, executable: event.target.value })} />{fieldErrors['target.executable'] ? <small className="shell-profile-field-error">{fieldErrors['target.executable']}</small> : null}</label> : editing.targetKind === 'wsl' ? <div className="shell-profile-editor__row"><label><span>WSL distribution</span><input value={editing.distribution} onChange={(event) => setEditing({ ...editing, distribution: event.target.value })} /></label><label><span>Shell path (optional)</span><input value={editing.shellPath} placeholder="/bin/bash" onChange={(event) => setEditing({ ...editing, shellPath: event.target.value })} /></label></div> : <p className="shell-profile-editor__hint">Terminay resolves the account shell on this server each time a new terminal is created.</p>}
				<details className="shell-profile-advanced"><summary>Advanced launch options</summary><div className="shell-profile-advanced__body"><ProfileStringRows label="Arguments" addLabel="Add argument" values={editing.args} onChange={(args) => setEditing({ ...editing, args })} /><ProfileEnvironmentRows rows={editing.environment} onChange={(environment) => setEditing({ ...editing, environment })} /><div className="shell-profile-editor__row"><label><span>Icon (optional)</span><input value={editing.icon} maxLength={128} onChange={(event) => setEditing({ ...editing, icon: event.target.value })} /></label><label><span>Colour (optional)</span><input value={editing.color} placeholder="#7c3aed" maxLength={128} onChange={(event) => setEditing({ ...editing, color: event.target.value })} /></label></div></div></details>
			</div><footer><button type="button" className="settings-secondary-button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button><button type="submit" className="settings-primary-button" disabled={busy}>{busy ? 'Validating…' : 'Validate and save'}</button></footer>
		</form></div> : null}
	</div>;
}

function ProfileStringRows({ label, addLabel, values, onChange }: { label: string; addLabel: string; values: string[]; onChange: (values: string[]) => void }) {
	return <fieldset className="shell-profile-rows"><legend>{label}</legend>{values.map((value, index) => <div key={`${index}`}><input aria-label={`${label} ${index + 1}`} value={value} onChange={(event) => onChange(values.map((candidate, candidateIndex) => candidateIndex === index ? event.target.value : candidate))} /><button type="button" aria-label={`Remove ${label.toLowerCase()} ${index + 1}`} onClick={() => onChange(values.filter((_, candidateIndex) => candidateIndex !== index))}>Remove</button></div>)}<button type="button" className="settings-secondary-button settings-secondary-button--small" disabled={values.length >= 64} onClick={() => onChange([...values, ''])}>{addLabel}</button></fieldset>;
}

function ProfileEnvironmentRows({ rows, onChange }: { rows: EditableProfile['environment']; onChange: (rows: EditableProfile['environment']) => void }) {
	return <fieldset className="shell-profile-rows"><legend>Environment overlay</legend><p>Values are stored in this server profile. Protected <code>TERMINAY_</code> variables cannot be changed.</p>{rows.map((row, index) => <div key={`${index}`} className="shell-profile-environment-row"><input aria-label={`Environment name ${index + 1}`} placeholder="NAME" value={row.key} onChange={(event) => onChange(rows.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, key: event.target.value } : candidate))} /><input aria-label={`Environment value ${index + 1}`} placeholder="Value" value={row.value} disabled={row.remove} onChange={(event) => onChange(rows.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, value: event.target.value } : candidate))} /><label><input type="checkbox" checked={row.remove} onChange={(event) => onChange(rows.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, remove: event.target.checked } : candidate))} /> Remove</label><button type="button" aria-label={`Remove environment row ${index + 1}`} onClick={() => onChange(rows.filter((_, candidateIndex) => candidateIndex !== index))}>×</button></div>)}<button type="button" className="settings-secondary-button settings-secondary-button--small" disabled={rows.length >= 128} onClick={() => onChange([...rows, { key: '', value: '', remove: false }])}>Add environment variable</button></fieldset>;
}
