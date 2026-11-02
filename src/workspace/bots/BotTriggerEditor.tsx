/**
 * Create or edit a trigger. The schedule is described in plain words and its
 * next five firings are previewed by the server before saving.
 */

import type { BotProfile, BotTrigger } from '@terminay/protocol';
import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
	cronForPresetKind,
	presetForCron,
	SCHEDULE_PRESET_KINDS,
	SCHEDULE_PRESET_LABELS,
} from '../automations/automationsModel';
import {
	BOT_EVENT_KINDS,
	describeCondition,
	emptyTriggerForm,
	eventLabel,
	formCondition,
	formFromTrigger,
	formToDraft,
	TRIGGER_KIND_LABELS,
	type TriggerForm,
	type TriggerKind,
} from './triggersModel';
import { refusalText, type ServerBots } from './useServerBots';

const KINDS: readonly TriggerKind[] = ['cron', 'every', 'once', 'event'];
const PREVIEW_DELAY_MS = 250;

export function BotTriggerEditor({
	server,
	bot,
	trigger,
	onClose,
	onSaved,
}: Readonly<{
	server: ServerBots;
	bot: BotProfile;
	trigger: BotTrigger | undefined;
	onClose: () => void;
	onSaved: () => void;
}>) {
	const [form, setForm] = useState<TriggerForm>(() =>
		trigger === undefined
			? emptyTriggerForm(Date.now())
			: formFromTrigger(trigger, Date.now()),
	);
	const [preview, setPreview] = useState<readonly number[]>();
	const [previewError, setPreviewError] = useState<string>();
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState(false);
	const update = (patch: Partial<TriggerForm>) =>
		setForm((current) => ({ ...current, ...patch }));
	const condition = useMemo(() => formCondition(form), [form]);
	const conditionKey = condition.ok ? JSON.stringify(condition.condition) : '';

	useEffect(() => {
		setPreview(undefined);
		setPreviewError(undefined);
		if (!condition.ok || condition.condition.kind === 'event') return;
		const schedule = condition.condition;
		let live = true;
		const timer = setTimeout(() => {
			server.client
				.previewTrigger(bot.id, schedule)
				.then((times) => {
					if (live) setPreview(times.slice(0, 5));
				})
				.catch((cause: unknown) => {
					if (live) setPreviewError(refusalText(cause));
				});
		}, PREVIEW_DELAY_MS);
		return () => {
			live = false;
			clearTimeout(timer);
		};
		// conditionKey stands for the condition's value.
	}, [conditionKey, server.client, bot.id]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [onClose]);

	const save = () => {
		const result = formToDraft(form);
		if (!result.ok) {
			setError(result.problem);
			return;
		}
		setBusy(true);
		setError(undefined);
		(trigger === undefined
			? server.client.createTrigger(bot.id, result.draft)
			: server.client.updateTrigger(bot.id, trigger.id, result.draft)
		)
			.then(onSaved)
			.catch((cause: unknown) => {
				setError(refusalText(cause));
				setBusy(false);
			});
	};

	const preset = presetForCron(form.cron);

	return (
		<div
			className="bots-modal"
			role="presentation"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<form
				className="bots-dialog bots-dialog--wide"
				role="dialog"
				aria-modal="true"
				aria-labelledby="bots-trigger-title"
				onSubmit={(event) => {
					event.preventDefault();
					save();
				}}
				data-terminay-bot-trigger-editor="true"
			>
				<header className="bots-dialog__head">
					<h2 id="bots-trigger-title">
						{trigger === undefined ? 'New trigger' : `Edit ${trigger.name}`}
					</h2>
					<button
						type="button"
						className="bots-icon-btn"
						onClick={onClose}
						aria-label="Close"
					>
						<X size={15} aria-hidden="true" />
					</button>
				</header>
				<label className="bots-field">
					<span>Name</span>
					<input
						value={form.name}
						maxLength={80}
						onChange={(event) => update({ name: event.target.value })}
						data-terminay-bot-trigger-field="name"
					/>
				</label>
				<div className="bots-field">
					<span>When</span>
					<fieldset className="bots-seg" aria-label="Trigger kind">
						{KINDS.map((kind) => (
							<button
								key={kind}
								type="button"
								className={form.kind === kind ? 'bots-seg--on' : ''}
								aria-pressed={form.kind === kind}
								onClick={() => update({ kind })}
								data-terminay-bot-trigger-kind={kind}
							>
								{TRIGGER_KIND_LABELS[kind]}
							</button>
						))}
					</fieldset>
				</div>
				{form.kind === 'cron' ? (
					<div className="bots-two">
						<label className="bots-field">
							<span>Repeat</span>
							<select
								value={preset.kind}
								onChange={(event) => {
									const kind = event.target.value as typeof preset.kind;
									if (kind !== 'custom')
										update({ cron: cronForPresetKind(kind, preset) });
								}}
							>
								{SCHEDULE_PRESET_KINDS.filter((k) => k !== 'everyMinute').map(
									(kind) => (
										<option key={kind} value={kind}>
											{SCHEDULE_PRESET_LABELS[kind]}
										</option>
									),
								)}
							</select>
						</label>
						<label className="bots-field">
							<span>Cron</span>
							<input
								className="bots-mono"
								value={form.cron}
								onChange={(event) => update({ cron: event.target.value })}
								data-terminay-bot-trigger-field="cron"
							/>
						</label>
					</div>
				) : form.kind === 'every' ? (
					<div className="bots-two">
						<label className="bots-field">
							<span>Every</span>
							<input
								type="number"
								min={1}
								value={form.every}
								onChange={(event) => update({ every: event.target.value })}
								data-terminay-bot-trigger-field="every"
							/>
						</label>
						<label className="bots-field">
							<span>Unit</span>
							<select
								value={form.everyUnit}
								onChange={(event) =>
									update({
										everyUnit: event.target.value as TriggerForm['everyUnit'],
									})
								}
							>
								<option value="minutes">minutes</option>
								<option value="hours">hours</option>
							</select>
						</label>
					</div>
				) : form.kind === 'once' ? (
					<label className="bots-field">
						<span>At</span>
						<input
							type="datetime-local"
							value={form.at}
							onChange={(event) => update({ at: event.target.value })}
						/>
					</label>
				) : (
					<label className="bots-field">
						<span>Event</span>
						<select
							value={form.event}
							onChange={(event) =>
								update({ event: event.target.value as TriggerForm['event'] })
							}
						>
							{BOT_EVENT_KINDS.map((kind) => (
								<option key={kind} value={kind}>
									{eventLabel(kind)}
								</option>
							))}
						</select>
						<small className="bots-faint">
							Fires for that event in any project on this server. Activity
							inside this bot’s own container never fires it.
						</small>
					</label>
				)}
				<div className="bots-preview" data-terminay-bot-trigger-preview="true">
					{condition.ok ? (
						<b>{describeCondition(condition.condition)}</b>
					) : (
						<span className="bots-need">{condition.problem}</span>
					)}
					{previewError ? (
						<span className="bots-need">{previewError}</span>
					) : preview !== undefined ? (
						<ol>
							{preview.map((at) => (
								<li key={at}>{new Date(at).toLocaleString()}</li>
							))}
						</ol>
					) : null}
				</div>
				<label className="bots-field">
					<span>Prompt</span>
					<textarea
						value={form.prompt}
						placeholder="Check the nightly build and summarise failures."
						onChange={(event) => update({ prompt: event.target.value })}
						data-terminay-bot-trigger-field="prompt"
					/>
				</label>
				<label className="bots-check">
					<input
						type="checkbox"
						checked={form.enabled}
						onChange={(event) => update({ enabled: event.target.checked })}
					/>
					Enabled
				</label>
				{error ? (
					<p className="bots-note bots-note--error" role="alert">
						{error}
					</p>
				) : null}
				<footer className="bots-dialog__foot">
					<button type="button" className="bots-btn" onClick={onClose}>
						Cancel
					</button>
					<button
						type="submit"
						className="bots-btn bots-btn--primary"
						disabled={busy}
						data-terminay-bot-trigger-save="true"
					>
						{busy ? 'Saving…' : 'Save trigger'}
					</button>
				</footer>
			</form>
		</div>
	);
}
