import type { TerminayClient } from '@terminay/client-core';
import {
	ExtensionsClient,
	ProjectEnvironmentsClient,
	TerminayClientFacade,
} from '@terminay/client-core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DeclarativeProviderForm } from './DeclarativeProviderForm';
import { ExtensionManager } from './ExtensionManager';
import { ProjectEnvironmentManager } from './ProjectEnvironmentManager';
import type {
	DeclarativeFormDto,
	ExtensionSummaryDto,
	ProjectEnvironmentSummaryDto,
} from './uiModel';
import './projectEnvironments.css';

export type ProjectEnvironmentSurface = 'environments' | 'extensions';

export function ProjectEnvironmentSurfaceDialog({
	surface: requestedSurface,
	serverName,
	applicationClient,
	onClose,
}: Readonly<{
	surface: ProjectEnvironmentSurface;
	serverName: string;
	applicationClient?: TerminayClient;
	onClose: () => void;
}>) {
	const closeRef = useRef<HTMLButtonElement>(null);
	const surface = requestedSurface;
	const [environments, setEnvironments] = useState<
		readonly ProjectEnvironmentSummaryDto[]
	>([]);
	const [providers, setProviders] = useState<
		readonly Readonly<{
			providerId: string;
			displayName: string;
			description?: string;
			profileForm?: DeclarativeFormDto;
			createForm?: DeclarativeFormDto;
		}>[]
	>([]);
	const [formTarget, setFormTarget] = useState<{
		providerId: string;
		profileId?: string;
		form: DeclarativeFormDto;
	} | null>(null);
	const [extensions, setExtensions] = useState<readonly ExtensionSummaryDto[]>(
		[],
	);
	const [extensionRevision, setExtensionRevision] = useState(0);
	const [authorityLabel, setAuthorityLabel] = useState(serverName);
	const [announcement, setAnnouncement] = useState('');
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const clients = useMemo(() => {
		if (applicationClient === undefined) return null;
		const transport = new TerminayClientFacade(applicationClient);
		return {
			environments: new ProjectEnvironmentsClient(transport),
			extensions: new ExtensionsClient(transport),
		};
	}, [applicationClient]);
	const refresh = useCallback(async () => {
		if (clients === null) {
			setError(
				'The selected Terminay Server does not provide an authenticated application client.',
			);
			return;
		}
		setBusy(true);
		setError('');
		try {
			if (surface === 'extensions') {
				const snapshot = await clients.extensions.list();
				setExtensions(snapshot.extensions);
				setExtensionRevision(snapshot.revision);
				setAuthorityLabel(snapshot.authorityLabel);
			} else if (surface === 'environments') {
				const snapshot = await clients.environments.snapshot();
				setEnvironments(snapshot.environments);
				setProviders(
					snapshot.providers.map((provider) => ({
						...provider,
						profileForm:
							provider.profileForm === undefined
								? undefined
								: toUiForm(provider.profileForm),
						createForm:
							provider.createForm === undefined
								? undefined
								: toUiForm(provider.createForm),
					})),
				);
			}
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(false);
		}
	}, [clients, surface]);
	useEffect(() => {
		void refresh();
	}, [refresh]);
	useEffect(() => {
		closeRef.current?.focus();
		const keydown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', keydown);
		return () => window.removeEventListener('keydown', keydown);
	}, [onClose]);
	const run = useCallback(
		async (action: () => Promise<unknown>, success: string) => {
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
		},
		[refresh],
	);
	return (
		<div
			className="project-environment-surface-backdrop"
			role="presentation"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<section
				className="project-environment-surface"
				role="dialog"
				aria-modal="true"
				aria-label={
					surface === 'extensions'
						? 'Extensions'
						: formTarget
							? formTarget.form.title
							: 'Project Environments'
				}
				aria-busy={busy}
			>
				<div className="project-environment-surface__close">
					<button
						ref={closeRef}
						type="button"
						onClick={onClose}
						aria-label="Close"
					>
						×
					</button>
				</div>
				<div className="project-environment-surface__body">
					{error ? (
						<div className="declarative-provider-form__errors" role="alert">
							<strong>Unable to complete the server operation</strong>
							<p>{error}</p>
							<button type="button" onClick={() => void refresh()}>
								Retry
							</button>
						</div>
					) : null}
					{surface === 'environments' && formTarget === null ? (
						<ProjectEnvironmentManager
							environments={environments}
							providers={providers.map((provider) => ({
								providerId: provider.providerId,
								displayName: provider.displayName,
								hasProfileForm: provider.profileForm !== undefined,
							}))}
							serverName={authorityLabel}
							onCreate={(providerId) => {
								const provider = providers.find(
									(candidate) => candidate.providerId === providerId,
								);
								if (provider?.profileForm)
									setFormTarget({ providerId, form: provider.profileForm });
							}}
							onEdit={(environment) => {
								const provider = providers.find(
									(candidate) =>
										candidate.providerId === environment.providerId,
								);
								if (provider?.profileForm && environment.profileId)
									setFormTarget({
										providerId: provider.providerId,
										profileId: environment.profileId,
										form: provider.profileForm,
									});
							}}
							onTest={(id) =>
								run(
									() => clients!.environments.testProfile(id),
									'Connection test completed.',
								)
							}
							onRemove={(id) =>
								run(
									() => clients!.environments.removeProfile(id),
									'Environment removed.',
								)
							}
							onAction={(environment, action) => {
								if (
									action.confirmation &&
									!window.confirm(
										`${action.confirmation.title}\n\n${action.confirmation.message}`,
									)
								)
									return;
								void run(
									() =>
										clients!.environments.invokeAction(
											environment.id,
											action.id,
											{},
											action.confirmation === undefined
												? {}
												: {
														expectedRevision:
															action.confirmation.expectedRevision,
													},
										),
									`${action.label} completed.`,
								);
							}}
						/>
					) : null}
					{surface === 'extensions' ? (
						<ExtensionManager
							extensions={extensions}
							serverName={authorityLabel}
							revision={extensionRevision}
							onPreview={(spec) => clients!.extensions.previewInstall(spec)}
							onInstall={(digest) =>
								run(
									() => clients!.extensions.install(digest, extensionRevision),
									'Extension installed.',
								)
							}
							onUpdate={(id, digest) =>
								run(
									() =>
										clients!.extensions.update(id, digest, extensionRevision),
									'Extension updated.',
								)
							}
							onAction={(action, id) =>
								run(
									() =>
										clients!.extensions.action(action, id, extensionRevision),
									`Extension ${action} completed.`,
								)
							}
						/>
					) : null}
					{surface === 'environments' && formTarget !== null ? (
						<DeclarativeProviderForm
							form={formTarget.form}
							onCancel={() => setFormTarget(null)}
							onSubmit={async (values) => {
								if (formTarget.profileId === undefined)
									await run(
										() =>
											clients!.environments.createProfile(
												formTarget.providerId,
												values,
											),
										'Connection saved.',
									);
								else
									await run(
										() =>
											clients!.environments.updateProfile(
												formTarget.profileId!,
												values,
											),
										'Connection updated.',
									);
								setFormTarget(null);
							}}
						/>
					) : null}
					{busy ? (
						<div className="management-route-announcement" role="status">
							<progress /> Working on {authorityLabel}…
						</div>
					) : null}
					{announcement ? (
						<div className="management-route-announcement" role="status">
							{announcement}
						</div>
					) : null}
				</div>
			</section>
		</div>
	);
}

function toUiForm(
	form: import('@terminay/client-core').ProjectEnvironmentForm,
): DeclarativeFormDto {
	return {
		id: form.id,
		title: form.title,
		submitLabel: form.submitLabel,
		...(form.description === undefined
			? {}
			: { description: form.description }),
		sections: form.sections.map((section) => ({
			id: section.id,
			title: section.title,
			...(section.description === undefined
				? {}
				: { description: section.description }),
			disclosure: section.disclosure !== undefined,
			fields: section.fields.map((field) => ({
				id: field.id,
				label: field.label,
				kind: field.type,
				...(field.description === undefined
					? {}
					: { description: field.description }),
				...(field.required === undefined ? {} : { required: field.required }),
				...(field.placeholder === undefined
					? {}
					: { placeholder: field.placeholder }),
				...(field.options === undefined ? {} : { options: field.options }),
				...(field.optionSource === undefined
					? {}
					: { optionSource: field.optionSource }),
				...(field.searchable === undefined
					? {}
					: { searchable: field.searchable }),
			})),
		})),
	};
}
