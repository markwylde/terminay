import type { TerminayClient } from '@terminay/client-core';
import { ProjectEnvironmentsClient, TerminayClientFacade } from '@terminay/client-core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DeclarativeProviderForm } from './DeclarativeProviderForm';
import { ProjectEnvironmentManager } from './ProjectEnvironmentManager';
import type {
	DeclarativeFormDto,
	ProjectEnvironmentSummaryDto,
} from './uiModel';
import './projectEnvironments.css';

type ProviderSummary = Readonly<{
	providerId: string;
	displayName: string;
	description?: string;
	profileForm?: DeclarativeFormDto;
	createForm?: DeclarativeFormDto;
}>;

type FormTarget = Readonly<{
	providerId: string;
	profileId?: string;
	form: DeclarativeFormDto;
}>;

export function ProjectEnvironmentsWindow({
	serverName,
	applicationClient,
}: Readonly<{
	serverName: string;
	applicationClient?: TerminayClient;
}>) {
	const client = useMemo(
		() =>
			applicationClient === undefined
				? null
				: new ProjectEnvironmentsClient(
						new TerminayClientFacade(applicationClient),
					),
		[applicationClient],
	);
	const [environments, setEnvironments] = useState<
		readonly ProjectEnvironmentSummaryDto[]
	>([]);
	const [providers, setProviders] = useState<readonly ProviderSummary[]>([]);
	const [formTarget, setFormTarget] = useState<FormTarget | null>(null);
	const [authorityLabel, setAuthorityLabel] = useState(serverName);
	const [announcement, setAnnouncement] = useState('');
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);

	const refresh = useCallback(async () => {
		if (client === null) {
			setError(
				'The selected Terminay Server does not provide an authenticated application client.',
			);
			return;
		}
		setBusy(true);
		setError('');
		try {
			const snapshot = await client.snapshot();
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
			setAuthorityLabel(serverName);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(false);
		}
	}, [client, serverName]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

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
		<main className="project-environments-window" aria-busy={busy}>
			<div className="project-environments-window__body">
				{error ? (
					<div className="declarative-provider-form__errors" role="alert">
						<strong>Unable to complete the server operation</strong>
						<p>{error}</p>
						<button type="button" onClick={() => void refresh()}>
							Retry
						</button>
					</div>
				) : null}
				{formTarget === null ? (
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
							if (provider?.profileForm !== undefined) {
								setFormTarget({ providerId, form: provider.profileForm });
							}
						}}
						onEdit={(environment) => {
							const provider = providers.find(
								(candidate) => candidate.providerId === environment.providerId,
							);
							if (
								provider?.profileForm !== undefined &&
								environment.profileId !== undefined
							) {
								setFormTarget({
									providerId: provider.providerId,
									profileId: environment.profileId,
									form: provider.profileForm,
								});
							}
						}}
						onTest={(profileId) =>
							run(() => client!.testProfile(profileId), 'Connection test completed.')
						}
						onRemove={(profileId) =>
							run(() => client!.removeProfile(profileId), 'Environment removed.')
						}
						onAction={(environment, action) => {
							if (
								action.confirmation !== undefined &&
								!window.confirm(
									`${action.confirmation.title}\n\n${action.confirmation.message}`,
								)
							) {
								return;
							}
							void run(
								() =>
									client!.invokeAction(
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
				) : (
					<DeclarativeProviderForm
						form={formTarget.form}
						onCancel={() => setFormTarget(null)}
						onSubmit={async (values) => {
							if (formTarget.profileId === undefined) {
								await run(
									() => client!.createProfile(formTarget.providerId, values),
									'Connection saved.',
								);
							} else {
								await run(
									() => client!.updateProfile(formTarget.profileId!, values),
									'Connection updated.',
								);
							}
							setFormTarget(null);
						}}
					/>
				)}
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
		</main>
	);
}

function toUiForm(
	form: import('@terminay/client-core').ProjectEnvironmentForm,
): DeclarativeFormDto {
	return {
		id: form.id,
		title: form.title,
		submitLabel: form.submitLabel,
		...(form.description === undefined ? {} : { description: form.description }),
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
