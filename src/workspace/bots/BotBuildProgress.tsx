import type { BotBuildProgress, BotBuildStepState } from '@terminay/protocol';
import { Check, ChevronRight, Circle, LoaderCircle, X } from 'lucide-react';
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react';
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
function Marker({
	state,
	size = 16,
}: {
	state: BotBuildStepState;
	size?: number;
}) {
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
			<Icon size={size} aria-hidden="true" />
			<span className="bots-sr">{labels[state]}</span>
		</span>
	);
}
const DISMISSED_KEY = 'terminay.bots.buildBannerDismissed';
const dismissedListeners = new Set<() => void>();
let dismissedKeys: readonly string[] = (() => {
	try {
		const raw = localStorage.getItem(DISMISSED_KEY);
		const parsed: unknown = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed)
			? parsed.filter((v): v is string => typeof v === 'string')
			: [];
	} catch {
		return [];
	}
})();
/** Hides the banner for one build outcome, on every surface that shows it. */
function dismissBuild(key: string): void {
	if (dismissedKeys.includes(key)) return;
	dismissedKeys = [...dismissedKeys, key].slice(-20);
	try {
		localStorage.setItem(DISMISSED_KEY, JSON.stringify(dismissedKeys));
	} catch {
		/* Dismissal still holds for this window. */
	}
	for (const listener of dismissedListeners) listener();
}
function useDismissed(key: string): boolean {
	return useSyncExternalStore(
		(listener) => {
			dismissedListeners.add(listener);
			return () => dismissedListeners.delete(listener);
		},
		() => dismissedKeys.includes(key),
	);
}

export function BuildBanner({
	engine,
	label,
	visible = true,
}: {
	engine: BotEngineView;
	label?: string;
	/** False while the surface holding the banner is hidden, e.g. a background tab. */
	visible?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const close = useCallback(() => setOpen(false), []);
	const last = useRef<BotBuildProgress | null>(null);
	const banner = useRef<HTMLDivElement>(null);
	if (engine.status?.build) last.current = engine.status.build;
	const progress = engine.status?.build ?? last.current;
	const key = progress ? `${progress.id}:${progress.state}` : '';
	const dismissed = useDismissed(key);
	const completed = progress?.state === 'completed';
	// A success notice needs to be seen once: leaving the surface after it was
	// shown (the tab hidden, or the banner unmounted) retires it.
	const seen = useRef<string>(undefined);
	useEffect(() => {
		const el = banner.current;
		if (!completed || dismissed || !visible || !el) return;
		const observer = new IntersectionObserver(([entry]) => {
			if (entry?.isIntersecting) seen.current = key;
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, [completed, dismissed, visible, key]);
	useEffect(() => {
		if (!visible && seen.current === key && key) dismissBuild(key);
	}, [visible, key]);
	useEffect(
		() => () => {
			if (seen.current) dismissBuild(seen.current);
		},
		[],
	);
	if (!progress) return null;
	const running = progress.state === 'running';
	const activity = progress.steps
		.filter((s) => s.state === 'running')
		.at(-1)?.description;
	return (
		<>
			{dismissed ? null : (
				<div
					ref={banner}
					className={`bots-build-banner bots-build-banner--${progress.state}`}
					data-terminay-build-banner-state={progress.state}
				>
					<button
						type="button"
						className="bots-build-banner__main"
						onClick={() => setOpen(true)}
						data-terminay-build-banner
						title={[label, activity].filter(Boolean).join(' · ')}
					>
						<Marker
							state={running ? 'running' : completed ? 'completed' : 'failed'}
						/>
						<span className="bots-build-banner__text">
							{label ? `${label} · ` : ''}
							{running
								? (activity ?? 'Building bot image…')
								: completed
									? 'Bot image ready'
									: progress.state === 'interrupted'
										? 'Image build interrupted'
										: 'Image build failed'}
						</span>
						<span className="bots-build-banner__link">
							{completed ? 'Details' : 'View progress'}
						</span>
					</button>
					{/* Failures stay: the banner is their only route back to Retry. */}
					{completed ? (
						<button
							type="button"
							className="bots-build-banner__close"
							aria-label="Dismiss"
							title="Dismiss"
							onClick={() => dismissBuild(key)}
							data-terminay-build-banner-dismiss
						>
							<X size={14} aria-hidden="true" />
						</button>
					) : null}
				</div>
			)}
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
	const done =
		steps?.filter((s) => s.state === 'completed' || s.state === 'cached')
			.length ?? 0;
	const total = steps?.length ?? 0;
	const headState: BotBuildStepState =
		progress?.state === 'completed'
			? 'completed'
			: progress?.state === 'running' || !progress
				? 'running'
				: 'failed';
	return createPortal(
		<div
			className="bots-ui bots-sheet-backdrop"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onBack();
			}}
		>
			<div
				ref={root}
				className="bots-sheet bots-build-page"
				role="dialog"
				aria-modal="true"
				aria-labelledby="bots-build-title"
				data-terminay-build-page
				data-terminay-build-id={progress?.id}
				data-terminay-build-state={progress?.state}
			>
				<header className="bots-sheet__head">
					<Marker state={headState} size={18} />
					<div className="bots-grow">
						<p className="bots-lab">
							Bot environment{label ? ` · ${label}` : ''}
						</p>
						<h1 id="bots-build-title" aria-live="polite">
							{outcome}
						</h1>
						<p className="bots-faint">
							{progress
								? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s · ${done} of ${total} steps`
								: 'Reading build progress…'}
						</p>
					</div>
					<button
						type="button"
						className="bots-iconbtn"
						aria-label="Close"
						title="Close (Esc)"
						onClick={onBack}
					>
						<X size={16} aria-hidden="true" />
					</button>
				</header>
				<div
					className={`bots-sheet__bar bots-sheet__bar--${headState}`}
					role="progressbar"
					aria-label="Build progress"
					aria-valuemin={0}
					aria-valuemax={total}
					aria-valuenow={done}
				>
					<span style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
				</div>
				<div className="bots-sheet__body">
					{engine.error || !engine.status ? (
						<p role="status" className="bots-note bots-note--warn">
							Connection unavailable. Reconnecting will restore the latest build
							progress.
						</p>
					) : null}
					{progress?.previousImageAvailable &&
					progress.state !== 'completed' ? (
						<p className="bots-note">
							Your previous successful image remains available.
						</p>
					) : null}
					<ol className="bots-build-timeline" aria-label="Image build steps">
						{steps?.map((step) => (
							<BuildStep key={`${progress?.id}:${step.id}`} step={step} />
						))}
					</ol>
					{progress?.truncated ? (
						<p className="bots-faint bots-sheet__foot-note">
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
							<summary>
								<ChevronRight size={14} aria-hidden="true" /> All build output
							</summary>
							<pre>{log ?? 'Reading output…'}</pre>
							<p className="bots-faint">The most recent 256 KiB is retained.</p>
						</details>
					) : null}
				</div>
				{progress && ['failed', 'interrupted'].includes(progress.state) ? (
					<footer className="bots-sheet__foot">
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
					</footer>
				) : null}
			</div>
		</div>,
		document.body,
	);
}

function BuildStep({ step }: { step: BotBuildProgress['steps'][number] }) {
	const [open, setOpen] = useState(step.state === 'failed');
	useEffect(() => {
		if (step.state === 'failed') setOpen(true);
	}, [step.state]);
	return (
		<li
			className={`bots-build-step bots-build-step--${step.state}`}
			data-terminay-build-step={step.state}
		>
			<div className="bots-build-step__row">
				<Marker state={step.state} size={12} />
				<h2>{step.description}</h2>
				<span className="bots-build-step__state">{labels[step.state]}</span>
				{step.log ? (
					<button
						type="button"
						className="bots-build-step__toggle"
						aria-expanded={open}
						aria-label={`${open ? 'Hide' : 'Show'} output for ${step.description}`}
						title={open ? 'Hide output' : 'Show output'}
						onClick={() => setOpen((v) => !v)}
					>
						<ChevronRight size={14} aria-hidden="true" />
					</button>
				) : (
					<span className="bots-build-step__toggle" aria-hidden="true" />
				)}
			</div>
			{step.log && open ? (
				<div className="bots-build-step__log">
					<pre>{step.log}</pre>
					{step.truncated ? (
						<p className="bots-faint">
							Showing the most recent output for this step.
						</p>
					) : null}
				</div>
			) : null}
		</li>
	);
}
