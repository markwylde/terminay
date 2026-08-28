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
	/** Safe, non-secret values from the persisted profile. */
	initialValues?: Readonly<Record<string, string | boolean>>;
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

	const refresh = useCallback(async (options: Readonly<{ background?: boolean }> = {}) => {
		if (client === null) {
			setError(
				'The selected Terminay Server does not provide an authenticated application client.',
			);
			return;
		}
		// The environments window is a management surface.  It must never turn
		// an unreachable server or a stuck provider recovery into a permanent
		// "Working…" overlay that hides the inventory.  Transport cancellation is
		// also important here: a later focus/poll refresh gets a fresh request.
		const controller = new AbortController();
		// Health polling is deliberately non-modal. A connection can remain in a
		// retryable SSH state for a while; repeatedly refreshing that state must
		// not keep the entire management window labelled "Working" forever.
		if (!options.background) setBusy(true);
		setError('');
		try {
			const snapshot = await withDeadline(
				client.snapshot({ signal: controller.signal }),
				controller,
				8_000,
			);
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
			setError(
				controller.signal.aborted
					? `Project Environments did not respond from ${serverName} within 8 seconds. Retry when that server is available.`
					: cause instanceof Error
						? cause.message
						: String(cause),
			);
		} finally {
			if (!options.background) setBusy(false);
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
		const onFocus = () => { void refresh({ background: true }); };
		window.addEventListener('focus', onFocus);
		return () => window.removeEventListener('focus', onFocus);
	}, [refresh]);
	useEffect(() => {
		// Provisioning is server-owned, but refresh its durable projection while
		// this window is visible. Snapshot reads are deliberately nonblocking, so
		// this cannot freeze the chooser behind an SSH readiness attempt.
		if (!environments.some((environment) =>
			['provisioning', 'connecting', 'reconnecting', 'starting', 'stopping'].includes(environment.status),
		)) return;
		const timer = window.setInterval(() => { void refresh({ background: true }); }, 2_000);
		return () => window.clearInterval(timer);
	}, [environments, refresh]);

	const run = useCallback(
		async (action: (signal: AbortSignal) => Promise<unknown>, success: string) => {
			setBusy(true);
			setError('');
			setAnnouncement('Operation started.');
			// A provider command can be retried by the server after this request is
			// cancelled, but the management window must never be held hostage by one
			// slow command.  The subsequent snapshot reconciles the durable result.
			const controller = new AbortController();
			try {
				await withDeadline(action(controller.signal), controller, 12_000);
				setAnnouncement(success);
				await refresh();
			} catch (cause) {
				setError(
					controller.signal.aborted
						? `Project Environments did not complete the request from ${serverName} within 12 seconds. The server may still finish it; the inventory has been refreshed.`
						: cause instanceof Error
							? cause.message
							: String(cause),
				);
				setAnnouncement('');
			} finally {
				setBusy(false);
			}
		},
		[refresh, serverName],
	);
	const submitForm = useCallback(
		async (action: (signal: AbortSignal) => Promise<unknown>, success: string) => {
			setBusy(true);
			setError('');
			setAnnouncement('Operation started.');
			const controller = new AbortController();
			try {
				await withDeadline(action(controller.signal), controller, 12_000);
				setAnnouncement(success);
				await refresh();
			} catch (cause) {
				setAnnouncement('');
				// DeclarativeProviderForm owns submit failures so it can keep the
				// user's values visible and place the error beside the submission.
				throw controller.signal.aborted
					? new Error(`Project Environments did not complete the request from ${serverName} within 12 seconds. Retry when the server is available.`)
					: cause instanceof Error ? cause : new Error(String(cause));
			} finally {
				setBusy(false);
			}
		},
		[refresh, serverName],
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
								form: editProfileForm(provider.profileForm),
								initialValues: profile.initialValues,
								mode: 'profile',
								});
							}
						}}
						onTestProfile={(profileId) =>
							run((signal) => client!.testProfile(profileId, { signal }), 'Provider or connection test completed.')
						}
						onRemoveProfile={(profileId) =>
							run((signal) => client!.removeProfile(profileId, { signal }), 'Provider or connection removed.')
						}
						onRemoveConnection={(environment) =>
							run(
								(signal) => client!.removeEnvironment(environment.id, { signal }),
								'Connection removed from this Terminay Server.',
							)
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
								(signal) =>
									client!.invokeAction(
										environment.id,
										action.id,
										{},
										{
											signal,
											...(action.confirmation === undefined
												? {}
												: {
													expectedRevision:
														action.confirmation.expectedRevision,
												}),
										},
									),
								`${action.label} completed.`,
							);
						}}
						detail={formTarget === null ? undefined : (
						<DeclarativeProviderForm
						form={formTarget.form}
						initialValues={formTarget.initialValues}
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
									(signal) => client!.createEnvironment(formTarget.providerId, formTarget.profileId!, values, { signal }),
									'Environment creation started.',
								);
							} else if (formTarget.profileId === undefined) {
								await submitForm(
									(signal) => client!.createProfile(formTarget.providerId, values, { signal }),
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
									(signal) => client!.updateProfile(formTarget.profileId!, values, { signal }),
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

/** A stalled transport may ignore AbortSignal. Settle the UI deadline anyway
 * while leaving server-side reconciliation free to finish the durable work. */
function withDeadline<T>(request: Promise<T>, controller: AbortController, timeoutMs: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const settle = (callback: () => void) => {
			if (settled) return;
			settled = true;
			window.clearTimeout(timer);
			callback();
		};
		const timer = window.setTimeout(() => {
			controller.abort();
			settle(() => reject(new Error('project environment request timed out')));
		}, timeoutMs);
		void request.then(
			(value) => settle(() => resolve(value)),
			(cause) => settle(() => reject(cause)),
		);
	});
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

/**
 * Provider definitions describe creation. Editing uses the same public form
 * schema, but never reads secrets back from the server. A blank secret field
 * therefore means "keep the current secret", not "erase it".
 */
function editProfileForm(form: DeclarativeFormDto): DeclarativeFormDto {
	return {
		...form,
		title: form.title.replace(/^New\s+/i, 'Edit '),
		submitLabel: form.submitLabel.replace(/^Test and save\s+/i, 'Test and save changes to '),
		description: 'Saved non-secret values are shown below. Leave a secret blank to keep its current value.',
		sections: form.sections.map((section) => ({
			...section,
			fields: section.fields.map((field) => field.kind !== 'secret'
				? field
				: {
					...field,
					required: false,
					placeholder: 'Leave blank to keep the current value',
					description: 'Stored securely and never displayed. Leave blank to keep the current value.',
				}),
		})),
	};
}
