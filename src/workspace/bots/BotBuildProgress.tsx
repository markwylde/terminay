import type { BotBuildProgress, BotBuildStepState } from '@terminay/protocol';
import { ArrowLeft, Check, Circle, LoaderCircle, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BotEngineView } from './useBotEngine';
import { useNow } from './useNow';

const labels: Record<BotBuildStepState, string> = {
	pending: 'Waiting',
	running: 'In progress',
	completed: 'Complete',
	cached: 'Cached',
	failed: 'Failed',
};
function Marker({ state }: { state: BotBuildStepState }) {
	const Icon =
		state === 'failed'
			? X
			: state === 'running'
				? LoaderCircle
				: state === 'completed' || state === 'cached'
					? Check
					: Circle;
	return (
		<span className={`bots-build__marker bots-build__marker--${state}`}>
			<Icon size={16} aria-hidden="true" />
			<span className="bots-sr">{labels[state]}</span>
		</span>
	);
}
export function BuildBanner({
	engine,
	label,
}: {
	engine: BotEngineView;
	label?: string;
}) {
	const [open, setOpen] = useState(false);
	const close = useCallback(() => setOpen(false), []);
	const last = useRef<BotBuildProgress | null>(null);
	if (engine.status?.build) last.current = engine.status.build;
	const progress = engine.status?.build ?? last.current;
	if (!progress) return null;
	const running = progress?.state === 'running';
	const activity = progress?.steps
		.filter((s) => s.state === 'running')
		.at(-1)?.description;
	return (
		<>
			<button
				type="button"
				className="bots-build-banner"
				onClick={() => setOpen(true)}
				data-terminay-build-banner
				title={[label, activity].filter(Boolean).join(' · ')}
			>
				<Marker
					state={
						running
							? 'running'
							: progress?.state === 'completed'
								? 'completed'
								: 'failed'
					}
				/>
				<span className="bots-build-banner__text">
					{label ? `${label} · ` : ''}
					{running
						? (activity ?? 'Building bot image…')
						: progress?.state === 'completed'
							? 'Bot image ready'
							: progress?.state === 'interrupted'
								? 'Image build interrupted'
								: 'Image build failed'}
				</span>
				<span className="bots-build-banner__link">
					View progress <span aria-hidden="true">→</span>
				</span>
			</button>
			{open ? (
				<BuildProgressPage
					progress={progress}
					engine={engine}
					label={label}
					onBack={close}
				/>
			) : null}
		</>
	);
}
function BuildProgressPage({
	progress,
	engine,
	label,
	onBack,
}: {
	progress: BotBuildProgress | null;
	engine: BotEngineView;
	label?: string;
	onBack: () => void;
}) {
	const root = useRef<HTMLDivElement>(null);
	const now = useNow();
	const [detail, setDetail] = useState<BotBuildProgress | null>(null);
	const latest = useRef(progress);
	latest.current = progress;
	const reads = useMemo(
		() => ({ running: false, again: false, disposed: false }),
		[engine.readBuildProgress],
	);
	useEffect(() => {
		reads.disposed = false;
		return () => {
			reads.disposed = true;
		};
	}, [reads]);
	useEffect(() => {
		reads.again = true;
		if (reads.running) return;
		reads.running = true;
		void (async () => {
			try {
				do {
					reads.again = false;
					try {
						const snapshot = await engine.readBuildProgress();
						if (!reads.disposed && snapshot?.id === latest.current?.id)
							setDetail(snapshot);
					} catch {
						/* Keep the last authorized snapshot while reconnecting. */
					}
				} while (reads.again && !reads.disposed);
			} finally {
				reads.running = false;
			}
		})();
	}, [reads, engine.readBuildProgress, progress?.revision, progress?.id]);
	const steps = detail?.id === progress?.id ? detail?.steps : progress?.steps;

	const [log, setLog] = useState<string>();
	useEffect(() => setLog(undefined), [progress?.id]);
	useEffect(() => {
		const previous = document.activeElement as HTMLElement | null;
		root.current?.querySelector<HTMLButtonElement>('button')?.focus();
		const key = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				onBack();
			}
			if (e.key !== 'Tab') return;
			const controls = [
				...(root.current?.querySelectorAll<HTMLElement>(
					'button,summary,[href],[tabindex="0"]',
				) ?? []),
			].filter((e) => e.getClientRects().length && !e.hasAttribute('disabled'));
			const first = controls[0],
				last = controls.at(-1);
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last?.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first?.focus();
			}
		};
		document.addEventListener('keydown', key);
		return () => {
			document.removeEventListener('keydown', key);
			previous?.focus();
		};
	}, [onBack]);
	const elapsed = progress
		? Math.max(
				0,
				Math.floor(((progress.endedAt ?? now) - progress.startedAt) / 1000),
			)
		: 0;
	const outcome =
		progress?.state === 'completed'
			? 'Your bot image is ready'
			: progress?.state === 'failed'
				? 'Image build failed'
				: progress?.state === 'interrupted'
					? 'Image build interrupted'
					: 'Building your bot environment';
	return createPortal(
		<div
			ref={root}
			className="bots-ui bots-build-page"
			role="dialog"
			aria-modal="true"
			aria-labelledby="bots-build-title"
			data-terminay-build-page
			data-terminay-build-id={progress?.id}
		>
			<div className="bots-build-page__inner">
				<button
					type="button"
					className="bots-link bots-build-page__back"
					onClick={onBack}
				>
					<ArrowLeft size={16} aria-hidden="true" /> Back to Bots
				</button>
				<header className="bots-build-page__header">
					<p className="bots-lab">
						Bot environment{label ? ` · ${label}` : ''}
					</p>
					<h1 id="bots-build-title" aria-live="polite">
						{outcome}
					</h1>
					<p className="bots-faint">
						{progress
							? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s · ${progress.steps.filter((s) => s.state === 'completed' || s.state === 'cached').length} steps complete`
							: 'Reading build progress…'}
					</p>
				</header>
				{engine.error || !engine.status ? (
					<p role="status" className="bots-note bots-note--warn">
						Connection unavailable. Reconnecting will restore the latest build
						progress.
					</p>
				) : null}
				{progress?.previousImageAvailable && progress.state !== 'completed' ? (
					<p className="bots-faint">
						Your previous successful image remains available.
					</p>
				) : null}
				<ol className="bots-build-timeline" aria-label="Image build steps">
					{steps?.map((step) => (
						<li
							key={`${progress?.id}:${step.id}`}
							className={`bots-build-step bots-build-step--${step.state}`}
							data-terminay-build-step={step.state}
						>
							<Marker state={step.state} />
							<div className="bots-build-step__body">
								<div className="bots-build-step__heading">
									<h2>{step.description}</h2>
									<span>{labels[step.state]}</span>
								</div>
								{step.log ? (
									<details>
										<summary>Step output</summary>
										<pre>{step.log}</pre>
										{step.truncated ? (
											<p className="bots-faint">
												Showing the most recent output for this step.
											</p>
										) : null}
									</details>
								) : null}
							</div>
						</li>
					))}
				</ol>
				{progress?.truncated ? (
					<p className="bots-faint">
						Some output is unavailable after restart or was truncated to keep
						this view bounded.
					</p>
				) : null}
				{progress ? (
					<details
						key={progress.id}
						className="bots-build-output"
						onToggle={(event) => {
							if (event.currentTarget.open)
								void engine
									.readBuildLog()
									.then(setLog, () => setLog('Build output is unavailable.'));
						}}
					>
						<summary>All build output</summary>
						<pre>{log ?? 'Reading output…'}</pre>
						<p className="bots-faint">The most recent 256 KiB is retained.</p>
					</details>
				) : null}
				{progress && ['failed', 'interrupted'].includes(progress.state) ? (
					<button
						type="button"
						className="bots-btn bots-btn--primary"
						disabled={engine.busy || !engine.status?.available}
						onClick={() => {
							setLog(undefined);
							engine.buildImage();
						}}
					>
						Retry build
					</button>
				) : null}
			</div>
		</div>,
		document.body,
	);
}
