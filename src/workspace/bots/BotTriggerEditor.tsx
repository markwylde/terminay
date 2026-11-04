import type {
	BotProfile,
	BotRecoveryPolicy,
	BotSourceTest,
	BotTrigger,
} from '@terminay/protocol';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
	describeCondition,
	emptyTriggerForm,
	formCondition,
	formFromTrigger,
	formToDraft,
	SOURCE_GROUPS,
	type SourceGroup,
	sourceGroup,
	TRIGGER_KIND_LABELS,
	type TriggerForm,
	type TriggerKind,
} from './triggersModel';
import { refusalText, type ServerBots } from './useServerBots';

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
		trigger
			? formFromTrigger(trigger, Date.now())
			: emptyTriggerForm(Date.now()),
	);
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState(false);
	const [test, setTest] = useState<BotSourceTest>();
	const [testing, setTesting] = useState(false);
	const [preview, setPreview] = useState<number[]>([]);
	const [confirmReset, setConfirmReset] = useState(false);
	const [memory, setMemory] = useState<{
		total: number;
		ids: string[];
		next: number | null;
	}>();
	const testingAbort = useRef<AbortController | undefined>(undefined);
	const update = (patch: Partial<TriggerForm>) => {
		testingAbort.current?.abort();
		setTest(undefined);
		setForm((v) => ({ ...v, ...patch }));
	};
	const condition = useMemo(() => formCondition(form), [form]);
	const key = condition.ok ? JSON.stringify(condition.condition) : '';
	const periodic = ['command', 'http', 'every'].includes(form.kind);
	const continuous = form.kind === 'files' || form.kind === 'sse';
	const group = sourceGroup(form.kind);
	useEffect(() => {
		setPreview([]);
		if (
			!condition.ok ||
			!['cron', 'every', 'once', 'command', 'http'].includes(form.kind)
		)
			return;
		let live = true;
		const timer = setTimeout(() => {
			if (condition.ok)
				void server.client
					.previewTrigger(bot.id, condition.condition)
					.then((v) => {
						if (live) setPreview(v);
					})
					.catch((e) => {
						if (live) setError(refusalText(e));
					});
		}, 250);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	}, [key, server.client, bot.id]);
	useEffect(() => () => testingAbort.current?.abort(), []);
	const switchKind = (kind: TriggerKind) =>
		update({
			kind,
			recovery:
				kind === 'files' || kind === 'sse'
					? 'recover-available'
					: kind === 'command' || kind === 'http'
						? 'once'
						: 'skip',
			...(kind === 'http' && form.match === 'exit'
				? { match: 'changed' as const }
				: {}),
		});
	const field = (
		label: string,
		name: keyof TriggerForm,
		type = 'text',
		props: Readonly<Record<string, unknown>> = {},
	) => (
		<label className="bots-field">
			<span>{label}</span>
			<input
				type={type}
				value={String(form[name])}
				onChange={(e) => update({ [name]: e.target.value })}
				data-terminay-bot-trigger-field={name}
				{...props}
			/>
		</label>
	);
	const runTest = async () => {
		if (!condition.ok) {
			setError(condition.problem);
			return;
		}
		const abort = new AbortController();
		testingAbort.current = abort;
		setTesting(true);
		setError(undefined);
		try {
			const result = await server.client.testSource(
				bot.id,
				condition.condition,
				trigger?.id,
				{ signal: abort.signal },
			);
			if (!abort.signal.aborted) setTest(result);
		} catch (e) {
			if (!abort.signal.aborted) setError(refusalText(e));
		} finally {
			if (testingAbort.current === abort) setTesting(false);
		}
	};
	const save = async () => {
		const result = formToDraft(form);
		if (!result.ok) {
			setError(result.problem);
			return;
		}
		setBusy(true);
		setError(undefined);
		try {
			if (trigger)
				await server.client.updateTrigger(bot.id, trigger.id, result.draft);
			else await server.client.createTrigger(bot.id, result.draft);
			onSaved();
		} catch (e) {
			setError(refusalText(e));
		} finally {
			setBusy(false);
		}
	};
	const stamp = (value: number | null | undefined) =>
		value ? new Date(value).toLocaleString() : '—';
	return (
		<form
			className="bots-source-editor"
			aria-label="Trigger editor"
			data-terminay-bot-trigger-editor="true"
			onSubmit={(e) => {
				e.preventDefault();
				void save();
			}}
		>
			<header className="bots-source-editor__head">
				<div>
					<span className="bots-lab">
						{trigger ? 'Edit trigger' : 'New trigger'}
					</span>
					<h3 className="bots-h3">{form.name || 'Watch something'}</h3>
				</div>
				<button
					type="button"
					className="bots-btn bots-btn--sm"
					onClick={onClose}
				>
					Back to list
				</button>
			</header>
			{!condition.ok ? (
				<div
					className="bots-note bots-note--warn"
					data-terminay-bot-trigger-preview="true"
				>
					{condition.problem}
				</div>
			) : null}
			{error ? (
				<div role="alert" className="bots-note bots-note--error">
					{error}
				</div>
			) : null}
			{field('Name', 'name', 'text', { maxLength: 80 })}
			<section className="bots-source-section" aria-label="When">
				<h4 className="bots-lab">When</h4>
				<div className="bots-two">
					<label className="bots-field">
						<span>Source group</span>
						<select
							aria-label="Source group"
							value={group}
							onChange={(e) =>
								switchKind(SOURCE_GROUPS[e.target.value as SourceGroup][0]!)
							}
						>
							{Object.keys(SOURCE_GROUPS).map((g) => (
								<option key={g}>{g}</option>
							))}
						</select>
					</label>
					<label className="bots-field">
						<span>Source type</span>
						<select
							aria-label="Source type"
							value={form.kind}
							onChange={(e) => switchKind(e.target.value as TriggerKind)}
							data-terminay-bot-trigger-type="true"
						>
							{form.kind === 'event' ? (
								<option value="event" disabled>
									Unsupported project event
								</option>
							) : null}
							{SOURCE_GROUPS[group].map((k) => (
								<option key={k} value={k}>
									{TRIGGER_KIND_LABELS[k]}
								</option>
							))}
						</select>
					</label>
				</div>
				{form.kind === 'command' ? (
					<>
						{field('Command / shell script', 'command')}
						{field('Working directory', 'cwd')}
					</>
				) : null}
				{form.kind === 'http' || form.kind === 'sse' ? (
					<>
						{field('URL', 'url', 'url')}
						{form.kind === 'sse'
							? field('Event name (optional)', 'eventName')
							: field('Response JSON Pointer (optional)', 'select')}
						<details>
							<summary>
								Headers ({Object.keys(form.storedHeaders).length || 'optional'})
							</summary>
							<label className="bots-field">
								<span>Headers as JSON — stored values are masked</span>
								<textarea
									value={form.headers}
									onChange={(e) => update({ headers: e.target.value })}
									spellCheck={false}
									rows={4}
								/>
							</label>
							<p className="bots-faint">
								Values are kept in the server vault. Leave •••• to keep a stored
								value.
							</p>
						</details>
					</>
				) : null}
				{form.kind === 'files' ? (
					<>
						{field('File or folder path', 'path')}
						<label className="bots-check">
							<input
								type="checkbox"
								checked={form.recursive}
								onChange={(e) => update({ recursive: e.target.checked })}
							/>{' '}
							Include subfolders
						</label>
						{field('Debounce (milliseconds)', 'debounce', 'number', {
							min: 0,
							max: 60000,
						})}
						<details>
							<summary>File filters</summary>
							{field('Include pattern (optional)', 'include')}
							{field('Exclude pattern (optional)', 'exclude')}
						</details>
					</>
				) : null}
				{form.kind === 'cron' ? (
					<>
						{field('Cron expression', 'cron')}
						<p className="bots-faint">
							Five fields, in the server’s time zone. Example: 0 9 * * 1-5.
						</p>
					</>
				) : null}
				{form.kind === 'once'
					? field('Date and time', 'at', 'datetime-local')
					: null}
				{periodic ? (
					<div className="bots-two">
						{field('Check every', 'every', 'number', { min: 1 })}
						<label className="bots-field">
							<span>Unit</span>
							<select
								aria-label="Unit"
								value={form.everyUnit}
								onChange={(e) =>
									update({ everyUnit: e.target.value as 'minutes' | 'hours' })
								}
							>
								<option value="minutes">Minutes</option>
								<option value="hours">Hours</option>
							</select>
						</label>
					</div>
				) : null}
				{form.kind === 'command' || form.kind === 'http' ? (
					<>
						<label className="bots-field">
							<span>Fire when</span>
							<select
								aria-label="Fire when"
								value={form.match}
								onChange={(e) =>
									update({ match: e.target.value as TriggerForm['match'] })
								}
							>
								<option value="changed">Output changes</option>
								<option value="items">New JSON items appear</option>
								<option value="contains">Text contains</option>
								{form.kind === 'command' ? (
									<>
										<option value="regex">
											Text matches a regular expression
										</option>
										<option value="exit">Exit code equals</option>
									</>
								) : null}
							</select>
						</label>
						{form.match === 'contains' || form.match === 'regex'
							? field('Text to match', 'matchText')
							: null}
						{form.match === 'exit'
							? field('Exit code', 'exitCode', 'number', { min: 0, max: 255 })
							: null}
						{['contains', 'regex', 'exit'].includes(form.match) ? (
							<label className="bots-check">
								<input
									type="checkbox"
									checked={form.repeat}
									onChange={(e) => update({ repeat: e.target.checked })}
								/>{' '}
								Fire on every matching check (otherwise, when it becomes
								matching)
							</label>
						) : null}
						{form.match === 'items' ? (
							<>
								<div className="bots-two">
									{field('Items JSON Pointer (blank = root array)', 'items')}
									{field('Item identity JSON Pointer', 'identity')}
								</div>
								<label className="bots-field">
									<span>First successful check</span>
									<select
										aria-label="First successful check"
										value={form.initial}
										onChange={(e) =>
											update({
												initial: e.target.value as 'process' | 'baseline',
											})
										}
									>
										<option value="process">Process existing items</option>
										<option value="baseline">
											Remember existing items without running
										</option>
									</select>
								</label>
								<p className="bots-faint">
									Each new identity starts a separate session. Your script
									handles pagination.
								</p>
							</>
						) : null}
						<details>
							<summary>Execution limit</summary>
							{field('Timeout (milliseconds)', 'timeout', 'number', {
								min: 1000,
								max: 300000,
							})}
						</details>
					</>
				) : null}
				<label className="bots-field">
					<span>If Terminay Server was offline</span>
					<select
						aria-label="If Terminay Server was offline"
						value={form.recovery}
						onChange={(e) =>
							update({ recovery: e.target.value as BotRecoveryPolicy })
						}
					>
						{continuous ? (
							<>
								<option value="recover-available">
									Recover available changes / events
								</option>
								<option value="ignore-gap">
									Ignore the gap and resume watching
								</option>
							</>
						) : (
							<>
								<option value="skip">Skip missed runs</option>
								<option value="once">Run once on return</option>
								<option value="replay">Run each missed occurrence</option>
							</>
						)}
					</select>
				</label>
				<p className="bots-faint">
					{continuous
						? 'Recovery depends on the source: file rescans find net changes; SSE replay needs event IDs and server support.'
						: form.recovery === 'replay' &&
								form.kind !== 'cron' &&
								form.kind !== 'every' &&
								form.kind !== 'once'
							? 'Replayed checks read current state; they cannot reconstruct historical responses.'
							: 'Missed work is measured on the server, independently of connected clients.'}
				</p>
				{preview.length ? (
					<div className="bots-note" data-terminay-bot-trigger-preview="true">
						<b>{condition.ok ? describeCondition(condition.condition) : ''}</b>
						<div className="bots-faint">
							Next{' '}
							{form.kind === 'command' || form.kind === 'http'
								? 'checks'
								: 'runs'}
							: {preview.map((at) => new Date(at).toLocaleString()).join(' · ')}
						</div>
					</div>
				) : null}
			</section>
			<section className="bots-source-section">
				<h4 className="bots-lab">Then ask the bot</h4>
				<label className="bots-field">
					<span>Prompt</span>
					<textarea
						value={form.prompt}
						onChange={(e) => update({ prompt: e.target.value })}
						rows={5}
						data-terminay-bot-trigger-field="prompt"
					/>
				</label>
				<p className="bots-faint">
					The source event is attached as data. Runs inside {bot.name}’s
					container.{continuous ? ' Continuous watching keeps it running.' : ''}
				</p>
			</section>
			{trigger ? (
				<section className="bots-source-section">
					<h4 className="bots-lab">Observation memory</h4>
					<p className="bots-faint">
						{trigger.health?.remembered ?? 0} identities remembered across
						restarts.
					</p>
					<div className="bots-inline">
						<button
							type="button"
							className="bots-btn bots-btn--sm"
							onClick={() =>
								void server.client
									.sourceMemory(bot.id, trigger.id)
									.then(setMemory)
									.catch((e) => setError(refusalText(e)))
							}
						>
							View remembered IDs
						</button>
						<button
							type="button"
							className="bots-btn bots-btn--sm"
							onClick={() => setConfirmReset(true)}
						>
							Reset memory…
						</button>
					</div>
					{memory ? (
						<>
							<pre className="bots-source-result">
								{memory.ids.join('\n') || 'No remembered IDs'}
							</pre>
							{memory.next !== null ? (
								<button
									type="button"
									className="bots-link"
									onClick={() =>
										void server.client
											.sourceMemory(bot.id, trigger.id, memory.next!)
											.then(setMemory)
									}
								>
									Next IDs
								</button>
							) : null}
						</>
					) : null}
					{confirmReset ? (
						<div className="bots-note bots-note--warn">
							Resetting can process existing items again.{' '}
							<button
								type="button"
								className="bots-btn bots-btn--sm"
								onClick={() =>
									void server.client
										.resetSource(bot.id, trigger.id, true)
										.then(() => {
											setConfirmReset(false);
											setMemory(undefined);
										})
										.catch((e) => setError(refusalText(e)))
								}
							>
								Confirm reset
							</button>
							<button
								type="button"
								className="bots-link"
								onClick={() => setConfirmReset(false)}
							>
								Cancel
							</button>
						</div>
					) : null}
				</section>
			) : null}
			{!['cron', 'every', 'once', 'event'].includes(form.kind) ? (
				<section className="bots-source-section">
					<button
						type="button"
						className="bots-btn"
						disabled={testing || bot.enabled === false}
						onClick={() => void runTest()}
					>
						{testing ? 'Testing…' : 'Test source'}
					</button>
					{testing ? (
						<button
							type="button"
							className="bots-link"
							onClick={() => {
								testingAbort.current?.abort();
								setTesting(false);
							}}
						>
							Cancel test
						</button>
					) : null}
					<p className="bots-faint">
						Executes the configured command/request; it can have side effects.
						No AI session starts and live memory is unchanged.
					</p>
					{test ? (
						<>
							<b>
								{test.wouldFire} event{test.wouldFire === 1 ? '' : 's'} would
								fire
							</b>
							<pre className="bots-source-result">{test.diagnostics}</pre>
						</>
					) : null}
				</section>
			) : null}
			{trigger?.health ? (
				<div className="bots-faint">
					<div>Last checked: {stamp(trigger.health.lastAttempt)}</div>
					<div>Last successful check: {stamp(trigger.health.lastSuccess)}</div>
					<div>Last fired: {stamp(trigger.health.lastFired)}</div>
					<div>Next check: {stamp(trigger.health.nextCheck)}</div>
					<div>Next retry: {stamp(trigger.health.nextRetry)}</div>
					{trigger.health.error ? <div>{trigger.health.error}</div> : null}
					{trigger.health.gap ? <div>{trigger.health.gap}</div> : null}
				</div>
			) : null}
			{trigger &&
			JSON.stringify(trigger.condition, (k, v) => (k === 'anchor' ? 0 : v)) !==
				JSON.stringify(condition.ok ? condition.condition : null, (k, v) =>
					k === 'anchor' ? 0 : v,
				) ? (
				<p className="bots-note bots-note--warn">
					Changing source settings resets comparison memory. Changing only the
					name or prompt preserves it.
				</p>
			) : null}
			<footer className="bots-source-editor__footer">
				<label className="bots-check">
					<input
						type="checkbox"
						checked={form.enabled}
						onChange={(e) => update({ enabled: e.target.checked })}
					/>{' '}
					Enabled
				</label>
				<button type="button" className="bots-btn" onClick={onClose}>
					Cancel
				</button>
				<button
					type="submit"
					data-terminay-bot-trigger-save="true"
					className="bots-btn bots-btn--primary"
					disabled={busy || form.kind === 'event'}
				>
					{busy ? 'Saving…' : 'Save trigger'}
				</button>
			</footer>
		</form>
	);
}
