import type { CSSProperties, JSX } from 'react';
import { AlertTriangle, Mic, RotateCcw, Square, X } from 'lucide-react';
import './dictationOverlay.css';

export type DictationOverlayStatus =
	| 'recording'
	| 'stopping'
	| 'processing'
	| 'transcribing'
	| 'complete'
	| 'failure'
	| 'failed';

export interface DictationOverlayState {
	status: DictationOverlayStatus;
	elapsedMs: number;
	waveformLevels: number[];
	transcript?: string;
	error?: string;
}

export interface DictationOverlayProps extends DictationOverlayState {
	accentColor?: string;
	className?: string;
	onStop: () => void;
	onRetry?: () => void;
	onCancel?: () => void;
}

const FALLBACK_LEVELS = [
	0.24, 0.36, 0.52, 0.68, 0.44, 0.28, 0.62, 0.82, 0.56, 0.32, 0.48, 0.72,
	0.88, 0.54, 0.34, 0.64, 0.76, 0.42,
];

const STATUS_LABELS: Record<DictationOverlayStatus, string> = {
	recording: 'Listening',
	stopping: 'Stopping',
	processing: 'Transcribing',
	transcribing: 'Transcribing',
	complete: 'Dictation ready',
	failure: 'Dictation failed',
	failed: 'Dictation failed',
};

function formatElapsedMs(elapsedMs: number): string {
	const safeMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
	const totalSeconds = Math.floor(safeMs / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function normalizeLevel(level: number): number {
	if (!Number.isFinite(level)) {
		return 0.12;
	}

	const normalized = level > 1 ? level / 100 : level;
	return Math.min(1, Math.max(0.08, normalized));
}

function getStatusText({
	status,
	transcript,
	error,
}: Pick<DictationOverlayProps, 'status' | 'transcript' | 'error'>): string {
	if (status === 'failed' || status === 'failure') {
		return error ?? 'Could not capture dictation.';
	}

	if (status === 'complete') {
		return transcript ? `Ready: ${transcript}` : STATUS_LABELS.complete;
	}

	return STATUS_LABELS[status];
}

export function DictationOverlay({
	status,
	elapsedMs,
	waveformLevels,
	accentColor = '#57b7ff',
	transcript,
	error,
	className,
	onStop,
	onRetry,
	onCancel,
}: DictationOverlayProps): JSX.Element {
	const isFailure = status === 'failed' || status === 'failure';
	const visualStatus = isFailure
		? 'failed'
		: status === 'processing'
			? 'transcribing'
			: status;
	const levels = waveformLevels.length > 0 ? waveformLevels : FALLBACK_LEVELS;
	const statusText = getStatusText({ status, transcript, error });
	const isStopDisabled =
		status === 'stopping' ||
		status === 'transcribing' ||
		status === 'processing';
	const rootClassName = [
		'dictation-overlay',
		`dictation-overlay--${visualStatus}`,
		className,
	]
		.filter(Boolean)
		.join(' ');

	return (
		<div
			className={rootClassName}
			style={{ '--dictation-accent': accentColor } as CSSProperties}
			role="status"
			aria-live={isFailure ? 'assertive' : 'polite'}
			aria-atomic="true"
		>
			<div className="dictation-overlay__shell">
				<div className="dictation-overlay__indicator" aria-hidden="true">
					{isFailure ? <AlertTriangle size={18} /> : <Mic size={18} />}
				</div>

				<div className="dictation-overlay__body">
					<div className="dictation-overlay__meta">
						<span className="dictation-overlay__status">{statusText}</span>
						<span className="dictation-overlay__time">
							{formatElapsedMs(elapsedMs)}
						</span>
					</div>

					<div
						className="dictation-overlay__waveform"
						aria-label="Input level"
						role="img"
					>
						{levels.map((level, index) => (
							<span
								key={`${index}-${level}`}
								className="dictation-overlay__bar"
								style={
									{
										'--dictation-bar-scale': normalizeLevel(level),
									} as CSSProperties
								}
							/>
						))}
					</div>
				</div>

				<div className="dictation-overlay__actions">
					{isFailure ? (
						<>
							{onRetry ? (
								<button
									type="button"
									className="dictation-overlay__button dictation-overlay__button--secondary"
									onClick={onRetry}
									aria-label="Retry dictation"
									title="Retry"
								>
									<RotateCcw size={14} aria-hidden="true" />
									<span>Retry</span>
								</button>
							) : null}
							{onCancel ? (
								<button
									type="button"
									className="dictation-overlay__button dictation-overlay__button--ghost"
									onClick={onCancel}
									aria-label="Cancel dictation"
									title="Cancel"
								>
									<X size={14} aria-hidden="true" />
									<span>Cancel</span>
								</button>
							) : null}
						</>
					) : (
						<button
							type="button"
							className="dictation-overlay__button dictation-overlay__button--stop"
							onClick={onStop}
							disabled={isStopDisabled}
							aria-label="Stop dictation"
							title="Stop dictation"
						>
							<Square size={13} aria-hidden="true" fill="currentColor" />
							<span>Stop</span>
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
