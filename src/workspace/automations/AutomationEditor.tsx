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
import { type FormEvent, useEffect, useId, useMemo, useState } from 'react';
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
	const label = (
		<label className="automation-editor__label" htmlFor={id}>
			{field.label || field.name}
			{field.required ? ' *' : ''}
		</label>
	);
	switch (field.type) {
		case 'checkbox':
			return (
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
			);
		case 'select':
			return (
				<div className="automation-editor__field">
					{label}
					<select
						id={id}
						className="automation-editor__input"
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
				</div>
			);
		case 'number':
			return (
				<div className="automation-editor__field">
					{label}
					<input
						id={id}
						type="number"
						className="automation-editor__input"
						value={String(value ?? '')}
						placeholder={String(field.defaultValue ?? field.placeholder)}
						onChange={(event) =>
							onChange(
								event.target.value === '' ? '' : Number(event.target.value),
							)
						}
					/>
				</div>
			);
		default:
			return (
				<div className="automation-editor__field">
					{label}
					<input
						id={id}
						className="automation-editor__input"
						value={String(value ?? '')}
						placeholder={
							field.placeholder || String(field.defaultValue ?? '')
						}
						onChange={(event) => onChange(event.target.value)}
					/>
				</div>
			);
	}
}

export function AutomationEditor({
	applicationClient,
	initial,
	now,
	onCancel,
	onSave,
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

	return (
		<form
			className="automation-editor"
			data-terminay-automation-editor={form.id ?? 'new'}
			onSubmit={(event) => void submit(event)}
			noValidate
		>
			<header className="automation-editor__header">
				<h3 className="automation-editor__title">
					{form.id === undefined ? 'New automation' : 'Edit automation'}
				</h3>
			</header>

			<div className="automation-editor__row">
				<div className="automation-editor__field automation-editor__field--grow">
					<label className="automation-editor__label" htmlFor={fieldId('name')}>
						Name
					</label>
					<input
						id={fieldId('name')}
						className="automation-editor__input"
						value={form.name}
						placeholder="Fix conflicted pull requests"
						onChange={(event) => update({ name: event.target.value })}
						data-terminay-automation-field="name"
					/>
				</div>
				<label className="automation-editor__check">
					<input
						type="checkbox"
						checked={form.enabled}
						onChange={(event) => update({ enabled: event.target.checked })}
						data-terminay-automation-field="enabled"
					/>
					Enabled
				</label>
			</div>

			<fieldset className="automation-editor__group">
				<legend className="automation-editor__legend">When</legend>
				<div className="automation-editor__segmented" role="radiogroup">
					{(['schedule', 'event'] as const).map((kind) => (
						<label key={kind} className="automation-editor__radio">
							<input
								type="radio"
								name={fieldId('trigger-kind')}
								checked={form.triggerKind === kind}
								onChange={() => update({ triggerKind: kind })}
								data-terminay-automation-trigger-kind={kind}
							/>
							{kind === 'schedule' ? 'On a schedule' : 'When something happens'}
						</label>
					))}
				</div>

				{form.triggerKind === 'schedule' ? (
					<>
						<div className="automation-editor__row">
							<div className="automation-editor__field">
								<label
									className="automation-editor__label"
									htmlFor={fieldId('preset')}
								>
									Repeat
								</label>
								<select
									id={fieldId('preset')}
									className="automation-editor__input"
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
							</div>
							{preset.kind === 'everyNMinutes' ? (
								<div className="automation-editor__field">
									<label
										className="automation-editor__label"
										htmlFor={fieldId('minutes')}
									>
										Minutes
									</label>
									<input
										id={fieldId('minutes')}
										type="number"
										min={1}
										max={59}
										className="automation-editor__input"
										value={preset.minutes}
										onChange={(event) => {
											const minutes = Number(event.target.value);
											if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 59)
												setPreset({ ...preset, minutes });
										}}
									/>
								</div>
							) : null}
							{preset.kind === 'hourly' ? (
								<div className="automation-editor__field">
									<label
										className="automation-editor__label"
										htmlFor={fieldId('minute')}
									>
										At minute
									</label>
									<input
										id={fieldId('minute')}
										type="number"
										min={0}
										max={59}
										className="automation-editor__input"
										value={preset.minute}
										onChange={(event) => {
											const minute = Number(event.target.value);
											if (Number.isInteger(minute) && minute >= 0 && minute <= 59)
												setPreset({ ...preset, minute });
										}}
									/>
								</div>
							) : null}
							{preset.kind === 'weekly' ? (
								<div className="automation-editor__field">
									<label
										className="automation-editor__label"
										htmlFor={fieldId('day')}
									>
										On
									</label>
									<select
										id={fieldId('day')}
										className="automation-editor__input"
										value={preset.dayOfWeek}
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
								</div>
							) : null}
							{'hour' in preset ? (
								<div className="automation-editor__field">
									<label
										className="automation-editor__label"
										htmlFor={fieldId('time')}
									>
										At
									</label>
									<input
										id={fieldId('time')}
										type="time"
										className="automation-editor__input"
										value={`${pad(preset.hour)}:${pad(preset.minute)}`}
										onChange={(event) => setTime(event.target.value)}
									/>
								</div>
							) : null}
						</div>
						<div className="automation-editor__field">
							<label className="automation-editor__label" htmlFor={fieldId('cron')}>
								Cron expression
							</label>
							<input
								id={fieldId('cron')}
								className="automation-editor__input automation-editor__input--mono"
								value={form.cron}
								spellCheck={false}
								onChange={(event) => update({ cron: event.target.value })}
								data-terminay-automation-field="cron"
							/>
						</div>
						<div
							className="automation-editor__preview"
							data-terminay-automation-schedule-preview={
								preview?.ok === true ? 'valid' : 'invalid'
							}
							aria-live="polite"
						>
							{preview === null ? null : preview.ok ? (
								<>
									<p
										className="automation-editor__description"
										data-terminay-automation-schedule-description="true"
									>
										{preview.description}
									</p>
									<ol className="automation-editor__next">
										{preview.next.map((at) => (
											<li key={at}>{formatPreviewTime(at, timeZone)}</li>
										))}
									</ol>
									{timeZone !== undefined && timeZone !== clientTimeZone ? (
										<p
											className="automations-muted"
											data-terminay-automation-schedule-zone={timeZone}
										>
											Times are in {timeZone}, the server’s time zone.
										</p>
									) : null}
								</>
							) : (
								<p className="automation-editor__warning">{preview.error}</p>
							)}
						</div>
					</>
				) : (
					<div className="automation-editor__field">
						<label className="automation-editor__label" htmlFor={fieldId('event')}>
							Event
						</label>
						<select
							id={fieldId('event')}
							className="automation-editor__input"
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
					</div>
				)}
			</fieldset>

			<fieldset className="automation-editor__group">
				<legend className="automation-editor__legend">Do</legend>
				<div className="automation-editor__field">
					<label className="automation-editor__label" htmlFor={fieldId('action')}>
						Action
					</label>
					<select
						id={fieldId('action')}
						className="automation-editor__input"
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
						<p className="automation-editor__hint" data-terminay-automation-combination-hint>
							{problem} Choose “Run a command”, or a terminal event.
						</p>
					)}
				</div>

				{form.actionKind === 'runCommand' ? (
					<>
						<div className="automation-editor__field">
							<label
								className="automation-editor__label"
								htmlFor={fieldId('command')}
							>
								Command
							</label>
							<input
								id={fieldId('command')}
								className="automation-editor__input automation-editor__input--mono"
								value={form.command}
								spellCheck={false}
								placeholder="~/bin/fix-conflicted-prs.sh"
								onChange={(event) => update({ command: event.target.value })}
								data-terminay-automation-field="command"
							/>
						</div>
						<div className="automation-editor__row">
							<div className="automation-editor__field">
								<label
									className="automation-editor__label"
									htmlFor={fieldId('profile')}
								>
									Shell profile
								</label>
								<select
									id={fieldId('profile')}
									className="automation-editor__input"
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
							</div>
							<div className="automation-editor__field automation-editor__field--grow">
								<label
									className="automation-editor__label"
									htmlFor={fieldId('cwd')}
								>
									Working directory
								</label>
								<input
									id={fieldId('cwd')}
									className="automation-editor__input automation-editor__input--mono"
									value={form.cwd}
									placeholder="Home directory"
									spellCheck={false}
									onChange={(event) => update({ cwd: event.target.value })}
								/>
							</div>
							<div className="automation-editor__field">
								<label
									className="automation-editor__label"
									htmlFor={fieldId('max')}
								>
									Stop after (minutes)
								</label>
								<input
									id={fieldId('max')}
									type="number"
									min={1}
									className="automation-editor__input"
									value={form.maxDurationMinutes}
									onChange={(event) =>
										update({ maxDurationMinutes: event.target.value })
									}
								/>
							</div>
						</div>
					</>
				) : null}

				{form.actionKind === 'runMacro' ? (
					<>
						<div className="automation-editor__field">
							<label
								className="automation-editor__label"
								htmlFor={fieldId('macro')}
							>
								Macro
							</label>
							<select
								id={fieldId('macro')}
								className="automation-editor__input"
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
						</div>
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
						<div className="automation-editor__field">
							<label className="automation-editor__label" htmlFor={fieldId('text')}>
								Text
							</label>
							<textarea
								id={fieldId('text')}
								className="automation-editor__input automation-editor__input--mono"
								rows={3}
								value={form.text}
								onChange={(event) => update({ text: event.target.value })}
								data-terminay-automation-field="text"
							/>
						</div>
						<label className="automation-editor__check">
							<input
								type="checkbox"
								checked={form.submit}
								onChange={(event) => update({ submit: event.target.checked })}
							/>
							Press Enter after writing
						</label>
					</>
				) : null}
			</fieldset>

			<fieldset className="automation-editor__group">
				<legend className="automation-editor__legend">Run settings</legend>
				<div className="automation-editor__row">
					<label className="automation-editor__check">
						<input
							type="checkbox"
							checked={form.keepTerminalAfterRun}
							onChange={(event) =>
								update({ keepTerminalAfterRun: event.target.checked })
							}
							data-terminay-automation-field="keep-terminal"
						/>
						Keep terminal after run
					</label>
					<label className="automation-editor__check">
						<input
							type="checkbox"
							checked={form.recordSession}
							onChange={(event) =>
								update({ recordSession: event.target.checked })
							}
						/>
						Record session
					</label>
					<div className="automation-editor__field">
						<label
							className="automation-editor__label"
							htmlFor={fieldId('cooldown')}
						>
							Cooldown (seconds)
						</label>
						<input
							id={fieldId('cooldown')}
							type="number"
							min={0}
							className="automation-editor__input"
							value={form.cooldownSeconds}
							onChange={(event) =>
								update({ cooldownSeconds: event.target.value })
							}
						/>
					</div>
				</div>
			</fieldset>

			{error === undefined ? null : (
				<p
					className="automation-editor__error"
					role="alert"
					data-terminay-automation-error="true"
				>
					{error}
				</p>
			)}

			<footer className="automation-editor__footer">
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
			</footer>
		</form>
	);
}
