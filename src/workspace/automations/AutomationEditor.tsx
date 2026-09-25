/**
 * Create or edit one automation.
 *
 * The form is the editor's; the definition is the server's. Saving sends a
 * draft and the server validates the trigger and action together, so the
 * reason a save is refused is always the server's own, shown beside the form.
 */

import {
	AUTOMATION_EVENT_KINDS,
	type AutomationDraft,
	type MacroDefinition,
	type MacroFieldDefinition,
	type MacroFieldValue,
	MacroClient,
	type ShellProfileCatalogueEntry,
	ShellProfilesClient,
	TerminayClientFacade,
	type TerminayClient,
} from '@terminay/client-core';
import type { CronPreset, CronWeekday } from '@terminay/cron';
import {
	type FormEvent,
	type ReactNode,
	useEffect,
	useId,
	useMemo,
	useState,
} from 'react';
import {
	ACTION_LABELS,
	AUTOMATION_EVENT_LABELS,
	type AutomationActionKind,
	type AutomationForm,
	actionKindsFor,
	combinationProblem,
	cronForPresetKind,
	formToDraft,
	formTrigger,
	presetForCron,
	previewSchedule,
	refusalMessage,
	SCHEDULE_PRESET_KINDS,
	SCHEDULE_PRESET_LABELS,
	type SchedulePresetKind,
} from './automationsModel';

const WEEKDAYS = [
	'Sunday',
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday',
] as const;

export type AutomationEditorProps = Readonly<{
	initial: AutomationForm;
	applicationClient?: TerminayClient;
	onSave: (draft: AutomationDraft) => Promise<void>;
	onCancel: () => void;
	now: number;
	/** The IANA zone the server evaluates schedules in. Previews use it. */
	timeZone?: string;
	/** The page header, given the Cancel and Save controls to place in it. */
	renderHeader: (controls: ReactNode) => ReactNode;
}>;

function pad(value: number): string {
	return String(value).padStart(2, '0');
}

function formatPreviewTime(at: number, timeZone?: string): string {
	return new Date(at).toLocaleString([], {
		...(timeZone === undefined ? {} : { timeZone }),
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}

/** Macros and shell profiles of the automation's server, best effort. */
function useServerCatalogues(applicationClient: TerminayClient | undefined) {
	const [macros, setMacros] = useState<readonly MacroDefinition[]>([]);
	const [profiles, setProfiles] = useState<
		readonly ShellProfileCatalogueEntry[]
	>([]);
	useEffect(() => {
		if (applicationClient === undefined) return;
		let active = true;
		const facade = new TerminayClientFacade(applicationClient);
		void new MacroClient(facade)
			.get()
			.then((state) => {
				if (active) setMacros(state.macros);
			})
			.catch(() => undefined);
		void new ShellProfilesClient(facade)
			.catalogue()
			.then((catalogue) => {
				if (active) setProfiles(catalogue.entries);
			})
			.catch(() => undefined);
		return () => {
			active = false;
		};
	}, [applicationClient]);
	return { macros, profiles };
}

function MacroFieldInput({
	field,
	onChange,
	value,
}: Readonly<{
	field: MacroFieldDefinition;
	value: MacroFieldValue | undefined;
	onChange: (value: MacroFieldValue) => void;
}>) {
	const id = useId();
	const label = `${field.label || field.name}${field.required ? ' *' : ''}`;
	switch (field.type) {
		case 'checkbox':
			return (
				<Row label={label}>
					<label className="automation-editor__check">
						<input
							id={id}
							type="checkbox"
							checked={
								typeof value === 'boolean' ? value : field.defaultValue === true
							}
							onChange={(event) => onChange(event.target.checked)}
						/>
						{field.label || field.name}
					</label>
				</Row>
			);
		case 'select':
			return (
				<Row label={label} htmlFor={id}>
					<select
						id={id}
						className="automation-editor__input automation-editor__input--auto"
						value={String(value ?? field.defaultValue ?? '')}
						onChange={(event) => onChange(event.target.value)}
					>
						<option value="">Choose…</option>
						{field.options.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</Row>
			);
		case 'number':
			return (
				<Row label={label} htmlFor={id}>
					<input
						id={id}
						type="number"
						className="automation-editor__input automation-editor__input--number"
						value={String(value ?? '')}
						placeholder={String(field.defaultValue ?? field.placeholder)}
						onChange={(event) =>
							onChange(
								event.target.value === '' ? '' : Number(event.target.value),
							)
						}
					/>
				</Row>
			);
		default:
			return (
				<Row label={label} htmlFor={id}>
					<input
						id={id}
						className="automation-editor__input"
						value={String(value ?? '')}
						placeholder={field.placeholder || String(field.defaultValue ?? '')}
						onChange={(event) => onChange(event.target.value)}
					/>
				</Row>
			);
	}
}

export function AutomationEditor({
	applicationClient,
	initial,
	now,
	onCancel,
	onSave,
	renderHeader,
	timeZone,
}: AutomationEditorProps) {
	const clientTimeZone = useMemo(
		() => new Intl.DateTimeFormat().resolvedOptions().timeZone,
		[],
	);
	const [form, setForm] = useState<AutomationForm>(initial);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string>();
	const { macros, profiles } = useServerCatalogues(applicationClient);
	const baseId = useId();
	const fieldId = (name: string) => `${baseId}-${name}`;
	const update = (patch: Partial<AutomationForm>) =>
		setForm((current) => ({ ...current, ...patch }));

	useEffect(() => {
		setForm(initial);
		setError(undefined);
	}, [initial]);

	const trigger = formTrigger(form);
	const offered = actionKindsFor(trigger);
	const actionChoices: readonly AutomationActionKind[] = offered.includes(
		form.actionKind,
	)
		? offered
		: [...offered, form.actionKind];
	const problem = combinationProblem(trigger, form.actionKind);
	const preview = useMemo(
		() =>
			form.triggerKind === 'schedule'
				? previewSchedule(form.cron, now, timeZone)
				: null,
		[form.cron, form.triggerKind, now, timeZone],
	);
	const preset = presetForCron(form.cron);
	const macro = macros.find((candidate) => candidate.id === form.macroId);

	const setPresetKind = (kind: SchedulePresetKind) => {
		if (kind === 'custom') {
			// Nothing to derive; the raw expression field is the schedule.
			return;
		}
		update({ cron: cronForPresetKind(kind, preset) });
	};
	const setPreset = (next: CronPreset) => {
		update({ cron: cronForPresetKind(next.kind, next) });
	};
	const setTime = (value: string) => {
		const [hour, minute] = value.split(':').map(Number);
		if (
			hour === undefined ||
			minute === undefined ||
			Number.isNaN(hour) ||
			Number.isNaN(minute) ||
			!('hour' in preset)
		)
			return;
		setPreset({ ...preset, hour, minute });
	};

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		const result = formToDraft(form);
		if (!result.ok) {
			setError(result.error);
			return;
		}
		setSaving(true);
		setError(undefined);
		try {
			await onSave(result.draft);
		} catch (cause) {
			setError(refusalMessage(cause));
		} finally {
			setSaving(false);
		}
	};

	const controls = (
		<>
			<button
				type="button"
				className="automations-button"
				onClick={onCancel}
				disabled={saving}
			>
				Cancel
			</button>
			<button
				type="submit"
				className="automations-button automations-button--primary"
				disabled={saving}
				data-terminay-automation-save="true"
			>
				{saving ? 'Saving…' : 'Save'}
			</button>
		</>
	);

	return (
		<form
			className="automation-editor"
			data-terminay-automation-editor={form.id ?? 'new'}
			onSubmit={(event) => void submit(event)}
			noValidate
		>
			{renderHeader(controls)}
			<div className="automation-editor__body">
				{error === undefined ? null : (
					<p
						className="automations-banner automations-banner--error automation-editor__error"
						role="alert"
						data-terminay-automation-error="true"
					>
						{error}
					</p>
				)}

				<Row label="Name" htmlFor={fieldId('name')}>
					<input
						id={fieldId('name')}
						className="automation-editor__input"
						value={form.name}
						placeholder="Fix conflicted pull requests"
						onChange={(event) => update({ name: event.target.value })}
						data-terminay-automation-field="name"
					/>
				</Row>
				<Row label="Enabled">
					<label className="automation-editor__check">
						<input
							type="checkbox"
							checked={form.enabled}
							onChange={(event) => update({ enabled: event.target.checked })}
							data-terminay-automation-field="enabled"
						/>
						Run on its trigger
					</label>
				</Row>

				<h3 className="automation-editor__section">When</h3>
				<Row label="Trigger">
					<div
						className="workspace-dashboard__modes automation-editor__modes"
						role="radiogroup"
						aria-label="Trigger"
					>
						{(['schedule', 'event'] as const).map((kind) => (
							<label
								key={kind}
								className={`workspace-dashboard__mode${form.triggerKind === kind ? ' workspace-dashboard__mode--selected' : ''}`}
							>
								<input
									type="radio"
									className="automation-editor__radio-input"
									name={fieldId('trigger-kind')}
									checked={form.triggerKind === kind}
									onChange={() => update({ triggerKind: kind })}
									data-terminay-automation-trigger-kind={kind}
								/>
								{kind === 'schedule' ? 'On a schedule' : 'When something happens'}
							</label>
						))}
					</div>
				</Row>

				{form.triggerKind === 'schedule' ? (
					<>
						<Row label="Repeat" htmlFor={fieldId('preset')}>
							<div className="automation-editor__inline">
								<select
									id={fieldId('preset')}
									className="automation-editor__input automation-editor__input--auto"
									value={preset.kind}
									onChange={(event) =>
										setPresetKind(event.target.value as SchedulePresetKind)
									}
									data-terminay-automation-field="preset"
								>
									{SCHEDULE_PRESET_KINDS.map((kind) => (
										<option key={kind} value={kind}>
											{SCHEDULE_PRESET_LABELS[kind]}
										</option>
									))}
								</select>
								{preset.kind === 'everyNMinutes' ? (
									<label className="automation-editor__inline-field">
										<span>every</span>
										<input
											type="number"
											min={1}
											max={59}
											className="automation-editor__input automation-editor__input--number"
											value={preset.minutes}
											aria-label="Minutes"
											onChange={(event) => {
												const minutes = Number(event.target.value);
												if (
													Number.isInteger(minutes) &&
													minutes >= 1 &&
													minutes <= 59
												)
													setPreset({ ...preset, minutes });
											}}
										/>
										<span>minutes</span>
									</label>
								) : null}
								{preset.kind === 'hourly' ? (
									<label className="automation-editor__inline-field">
										<span>at minute</span>
										<input
											type="number"
											min={0}
											max={59}
											className="automation-editor__input automation-editor__input--number"
											value={preset.minute}
											aria-label="At minute"
											onChange={(event) => {
												const minute = Number(event.target.value);
												if (
													Number.isInteger(minute) &&
													minute >= 0 &&
													minute <= 59
												)
													setPreset({ ...preset, minute });
											}}
										/>
									</label>
								) : null}
								{preset.kind === 'weekly' ? (
									<label className="automation-editor__inline-field">
										<span>on</span>
										<select
											className="automation-editor__input automation-editor__input--auto"
											value={preset.dayOfWeek}
											aria-label="Day"
											onChange={(event) =>
												setPreset({
													...preset,
													dayOfWeek: Number(event.target.value) as CronWeekday,
												})
											}
										>
											{WEEKDAYS.map((day, index) => (
												<option key={day} value={index}>
													{day}
												</option>
											))}
										</select>
									</label>
								) : null}
								{'hour' in preset ? (
									<label className="automation-editor__inline-field">
										<span>at</span>
										<input
											type="time"
											className="automation-editor__input automation-editor__input--time"
											value={`${pad(preset.hour)}:${pad(preset.minute)}`}
											aria-label="At"
											onChange={(event) => setTime(event.target.value)}
										/>
									</label>
								) : null}
							</div>
						</Row>
						<Row label="Cron" htmlFor={fieldId('cron')}>
							<input
								id={fieldId('cron')}
								className="automation-editor__input automation-editor__input--mono automation-editor__input--cron"
								value={form.cron}
								spellCheck={false}
								onChange={(event) => update({ cron: event.target.value })}
								data-terminay-automation-field="cron"
							/>
						</Row>
						<Row label="">
							<div
								className="automation-editor__preview"
								data-terminay-automation-schedule-preview={
									preview?.ok === true ? 'valid' : 'invalid'
								}
								aria-live="polite"
							>
								{preview === null ? null : preview.ok ? (
									<>
										<span
											className="automation-editor__description"
											data-terminay-automation-schedule-description="true"
										>
											{preview.description}
										</span>
										<ol className="automation-editor__next-list">
											{preview.next.map((at) => (
												<li key={at}>{formatPreviewTime(at, timeZone)}</li>
											))}
										</ol>
										{timeZone !== undefined && timeZone !== clientTimeZone ? (
											<span
												className="automation-editor__next"
												data-terminay-automation-schedule-zone={timeZone}
											>
												Times are in {timeZone}, the server’s time zone.
											</span>
										) : null}
									</>
								) : (
									<span className="automation-editor__warning">
										{preview.error}
									</span>
								)}
							</div>
						</Row>
					</>
				) : (
					<Row label="Event" htmlFor={fieldId('event')}>
						<select
							id={fieldId('event')}
							className="automation-editor__input automation-editor__input--auto"
							value={form.event}
							onChange={(event) =>
								update({
									event: event.target.value as AutomationForm['event'],
								})
							}
							data-terminay-automation-field="event"
						>
							{AUTOMATION_EVENT_KINDS.map((kind) => (
								<option key={kind} value={kind}>
									{AUTOMATION_EVENT_LABELS[kind]}
								</option>
							))}
						</select>
					</Row>
				)}

				<h3 className="automation-editor__section">Do</h3>
				<Row label="Action" htmlFor={fieldId('action')}>
					<select
						id={fieldId('action')}
						className="automation-editor__input automation-editor__input--auto"
						value={form.actionKind}
						onChange={(event) =>
							update({ actionKind: event.target.value as AutomationActionKind })
						}
						data-terminay-automation-field="action"
					>
						{actionChoices.map((kind) => (
							<option key={kind} value={kind}>
								{ACTION_LABELS[kind]}
							</option>
						))}
					</select>
					{problem === undefined ? null : (
						<p
							className="automation-editor__hint"
							data-terminay-automation-combination-hint
						>
							{problem} Choose “Run a command”, or a terminal event.
						</p>
					)}
				</Row>

				{form.actionKind === 'runCommand' ? (
					<>
						<Row label="Command" htmlFor={fieldId('command')}>
							<input
								id={fieldId('command')}
								className="automation-editor__input automation-editor__input--mono"
								value={form.command}
								spellCheck={false}
								placeholder="~/bin/fix-conflicted-prs.sh"
								onChange={(event) => update({ command: event.target.value })}
								data-terminay-automation-field="command"
							/>
						</Row>
						<Row label="Working directory" htmlFor={fieldId('cwd')}>
							<input
								id={fieldId('cwd')}
								className="automation-editor__input automation-editor__input--mono"
								value={form.cwd}
								placeholder="~ (home directory)"
								spellCheck={false}
								onChange={(event) => update({ cwd: event.target.value })}
							/>
						</Row>
						<Row label="Shell" htmlFor={fieldId('profile')}>
							<select
								id={fieldId('profile')}
								className="automation-editor__input automation-editor__input--auto"
								value={form.shellProfileId}
								onChange={(event) =>
									update({ shellProfileId: event.target.value })
								}
							>
								<option value="">Server default</option>
								{profiles.map((profile) => (
									<option
										key={profile.id}
										value={profile.id}
										disabled={!profile.availability.available}
									>
										{profile.name}
									</option>
								))}
							</select>
						</Row>
						<Row label="Stop after" htmlFor={fieldId('max')}>
							<label className="automation-editor__inline-field">
								<input
									id={fieldId('max')}
									type="number"
									min={1}
									className="automation-editor__input automation-editor__input--number"
									value={form.maxDurationMinutes}
									onChange={(event) =>
										update({ maxDurationMinutes: event.target.value })
									}
								/>
								<span>minutes</span>
							</label>
						</Row>
					</>
				) : null}

				{form.actionKind === 'runMacro' ? (
					<>
						<Row label="Macro" htmlFor={fieldId('macro')}>
							<select
								id={fieldId('macro')}
								className="automation-editor__input automation-editor__input--auto"
								value={form.macroId}
								onChange={(event) =>
									update({ macroId: event.target.value, fieldValues: {} })
								}
								data-terminay-automation-field="macro"
							>
								<option value="">Choose a Macro…</option>
								{macros.map((candidate) => (
									<option key={candidate.id} value={candidate.id}>
										{candidate.title}
									</option>
								))}
							</select>
						</Row>
						{macro?.fields.map((field) => (
							<MacroFieldInput
								key={field.id}
								field={field}
								value={form.fieldValues[field.name]}
								onChange={(value) =>
									update({
										fieldValues: { ...form.fieldValues, [field.name]: value },
									})
								}
							/>
						))}
					</>
				) : null}

				{form.actionKind === 'writeText' ? (
					<>
						<Row label="Text" htmlFor={fieldId('text')}>
							<textarea
								id={fieldId('text')}
								className="automation-editor__input automation-editor__input--mono automation-editor__textarea"
								rows={3}
								value={form.text}
								onChange={(event) => update({ text: event.target.value })}
								data-terminay-automation-field="text"
							/>
						</Row>
						<Row label="">
							<label className="automation-editor__check">
								<input
									type="checkbox"
									checked={form.submit}
									onChange={(event) => update({ submit: event.target.checked })}
								/>
								Press Enter after writing
							</label>
						</Row>
					</>
				) : null}

				<h3 className="automation-editor__section">After it runs</h3>
				<Row label="Terminal">
					<label className="automation-editor__check">
						<input
							type="checkbox"
							checked={form.keepTerminalAfterRun}
							onChange={(event) =>
								update({ keepTerminalAfterRun: event.target.checked })
							}
							data-terminay-automation-field="keep-terminal"
						/>
						Keep it open after the command exits
					</label>
				</Row>
				<Row label="Recording">
					<label className="automation-editor__check">
						<input
							type="checkbox"
							checked={form.recordSession}
							onChange={(event) =>
								update({ recordSession: event.target.checked })
							}
						/>
						Record the session
					</label>
				</Row>
				<Row label="Cooldown" htmlFor={fieldId('cooldown')}>
					<label className="automation-editor__inline-field">
						<input
							id={fieldId('cooldown')}
							type="number"
							min={0}
							className="automation-editor__input automation-editor__input--number"
							value={form.cooldownSeconds}
							onChange={(event) =>
								update({ cooldownSeconds: event.target.value })
							}
						/>
						<span>seconds before firing again for the same terminal</span>
					</label>
				</Row>
			</div>
		</form>
	);
}

function Row({
	children,
	htmlFor,
	label,
}: Readonly<{ label: string; htmlFor?: string; children: ReactNode }>) {
	return (
		<div className="automation-editor__row">
			{htmlFor === undefined ? (
				<span className="automation-editor__label">{label}</span>
			) : (
				<label className="automation-editor__label" htmlFor={htmlFor}>
					{label}
				</label>
			)}
			<div className="automation-editor__control">{children}</div>
		</div>
	);
}
