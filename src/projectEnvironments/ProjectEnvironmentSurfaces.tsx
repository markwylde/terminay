import type { TerminayClient } from '@terminay/client-core';
import { ProjectEnvironmentsClient, TerminayClientFacade } from '@terminay/client-core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DeclarativeProviderForm } from './DeclarativeProviderForm';
import {
	ProjectEnvironmentManager,
	type ProjectEnvironmentSelectionHint,
} from './ProjectEnvironmentManager';
import type {
	DeclarativeFormDto,
	ProjectEnvironmentSummaryDto,
} from './uiModel';
import '../settings.css';
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
	mode?: 'profile' | 'environment';
}>;

export function ProjectEnvironmentsWindow({
	serverName,
	applicationClient,
	initialIntent,
}: Readonly<{
	serverName: string;
	applicationClient?: TerminayClient;
	initialIntent?: Readonly<{
		providerId: string;
		mode: 'profile' | 'environment';
		profileId?: string;
	}>;
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
	const [profiles, setProfiles] = useState<readonly import('@terminay/client-core').ProjectEnvironmentClientProfile[]>([]);
	const [formTarget, setFormTarget] = useState<FormTarget | null>(null);
	const [selectionHint, setSelectionHint] =
		useState<ProjectEnvironmentSelectionHint | null>(null);
	const [authorityLabel, setAuthorityLabel] = useState(serverName);
	const [announcement, setAnnouncement] = useState('');
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const [pendingIntent, setPendingIntent] = useState(
		() => initialIntent ?? intentFromLocation(),
	);

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
			setProfiles(snapshot.profiles);
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
	useEffect(() => {
		if (pendingIntent === undefined) return;
		const provider = providers.find(
			(item) => item.providerId === pendingIntent.providerId,
		);
		const form = pendingIntent.mode === 'profile'
			? provider?.profileForm
			: provider?.createForm;
		if (
			form === undefined ||
			(pendingIntent.mode === 'environment' && pendingIntent.profileId === undefined)
		) return;
		setFormTarget({
			providerId: pendingIntent.providerId,
			mode: pendingIntent.mode,
			form,
			...(pendingIntent.profileId === undefined
				? {}
				: { profileId: pendingIntent.profileId }),
		});
		setPendingIntent(undefined);
	}, [pendingIntent, providers]);
	useEffect(() => {
		const onFocus = () => { void refresh(); };
		window.addEventListener('focus', onFocus);
		return () => window.removeEventListener('focus', onFocus);
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
	const submitForm = useCallback(
		async (action: () => Promise<unknown>, success: string) => {
			setBusy(true);
			setError('');
			setAnnouncement('Operation started.');
			try {
				await action();
				setAnnouncement(success);
				await refresh();
			} catch (cause) {
				setAnnouncement('');
				// DeclarativeProviderForm owns submit failures so it can keep the
				// user's values visible and place the error beside the submission.
				throw cause instanceof Error ? cause : new Error(String(cause));
			} finally {
				setBusy(false);
			}
		},
		[refresh],
	);

	return (
		<div className="project-environments-window" aria-busy={busy}>
				<ProjectEnvironmentManager
						environments={environments}
						profiles={profiles}
						providers={providers.map((provider) => ({
							providerId: provider.providerId,
							displayName: provider.displayName,
							hasProfileForm: provider.profileForm !== undefined,
							hasCreateForm: provider.createForm !== undefined,
						}))}
						serverName={authorityLabel}
						selectionHint={selectionHint}
						onSelectionHintHandled={() => setSelectionHint(null)}
						operationNotice={error === '' ? undefined : (
							<ProjectEnvironmentOperationError
								message={error}
								onRetry={() => void refresh()}
							/>
						)}
						onCreateProfile={(providerId) => {
							const provider = providers.find(
								(candidate) => candidate.providerId === providerId,
							);
							if (provider?.profileForm !== undefined) {
								setFormTarget({ providerId, form: provider.profileForm, mode: 'profile' });
							}
						}}
						onCreateEnvironment={(providerId, profileId) => {
							const provider = providers.find((candidate) => candidate.providerId === providerId);
							if (provider?.createForm !== undefined) setFormTarget({ providerId, profileId, form: provider.createForm, mode: 'environment' });
						}}
						onEditProfile={(profile) => {
							const provider = providers.find(
								(candidate) => candidate.providerId === profile.providerId,
							);
							if (
								provider?.profileForm !== undefined &&
								profile.id !== undefined
							) {
								setFormTarget({
									providerId: provider.providerId,
									profileId: profile.id,
									form: provider.profileForm,
									mode: 'profile',
								});
							}
						}}
						onTestProfile={(profileId) =>
							run(() => client!.testProfile(profileId), 'Provider or connection test completed.')
						}
						onRemoveProfile={(profileId) =>
							run(() => client!.removeProfile(profileId), 'Provider or connection removed.')
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
						detail={formTarget === null ? undefined : (
						<DeclarativeProviderForm
						form={formTarget.form}
						{...(formTarget.profileId === undefined
							? {}
							: { initialValues: { 'profile-id': formTarget.profileId } })}
						onLoadOptions={async (_fieldId, sourceId, query, values, signal) => (
							await client!.resolveOptions({
								providerId: formTarget.providerId,
								sourceId,
								...(formTarget.profileId === undefined
									? {}
									: { profileId: formTarget.profileId }),
								query,
								values,
							}, { signal })
						).options}
						onCancel={() => setFormTarget(null)}
						onSubmit={async (values) => {
							const provider = providers.find(
								(candidate) => candidate.providerId === formTarget.providerId,
							);
							const managesProvider = provider?.createForm !== undefined;
							const createdProvider =
								formTarget.mode !== 'environment' &&
								formTarget.profileId === undefined &&
								managesProvider;
							if (formTarget.mode === 'environment' && formTarget.profileId !== undefined) {
								await submitForm(
									() => client!.createEnvironment(formTarget.providerId, formTarget.profileId!, values),
									'Environment creation started.',
								);
							} else if (formTarget.profileId === undefined) {
								await submitForm(
									() => client!.createProfile(formTarget.providerId, values),
									managesProvider ? 'Provider saved.' : 'Connection saved.',
								);
								if (
									createdProvider &&
									typeof values['display-name'] === 'string' &&
									values['display-name'].trim() !== ''
								) {
									setSelectionHint({
										providerId: formTarget.providerId,
										providerName: values['display-name'],
									});
								}
							} else {
								await submitForm(
									() => client!.updateProfile(formTarget.profileId!, values),
									managesProvider ? 'Provider updated.' : 'Connection updated.',
								);
							}
							setFormTarget(null);
						}}
					/>
					)}
				/>
				{busy ? (
					<div className="settings-status-message environment-window-status" role="status">
						<progress /> Working on {authorityLabel}…
					</div>
				) : null}
				{announcement ? (
					<div className="settings-status-message environment-window-status" role="status">
						{announcement}
					</div>
				) : null}
		</div>
	);
}

/** A normal in-flow content panel, deliberately separate from form-specific
 * validation. Provider operation errors remain visible while leaving the
 * selected provider, connection, and form controls usable. */
function ProjectEnvironmentOperationError({
	message,
	onRetry,
}: Readonly<{ message: string; onRetry: () => void }>) {
	return (
		<section className="environment-operation-error" role="alert" aria-live="assertive">
			<div>
				<h2>Unable to complete the server operation</h2>
				<p>{message}</p>
			</div>
			<button type="button" className="settings-secondary-button" onClick={onRetry}>
				Retry
			</button>
		</section>
	);
}

function intentFromLocation(): Readonly<{
	providerId: string;
	mode: 'profile' | 'environment';
	profileId?: string;
}> | undefined {
	const query = new URLSearchParams(window.location.search);
	const providerId = query.get('providerId');
	const mode = query.get('mode');
	const profileId = query.get('profileId');
	if (providerId === null || (mode !== 'profile' && mode !== 'environment')) {
		return undefined;
	}
	return { providerId, mode, ...(profileId === null ? {} : { profileId }) };
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
			...(section.disclosure === undefined ? {} : { disclosure: section.disclosure }),
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
				...(field.defaultValue === undefined ? {} : { defaultValue: field.defaultValue }),
				...(field.suggestionSource === undefined ? {} : { suggestionSource: field.suggestionSource }),
				...(field.suggestionLabel === undefined ? {} : { suggestionLabel: field.suggestionLabel }),
				...(field.options === undefined ? {} : { options: field.options }),
				...(field.optionSource === undefined
					? {}
					: { optionSource: field.optionSource }),
				...(field.searchable === undefined
					? {}
					: { searchable: field.searchable }),
				...(field.visibleWhen === undefined
					? {}
					: { visibleWhen: field.visibleWhen }),
			})),
		})),
	};
}
