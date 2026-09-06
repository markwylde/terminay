import { useCallback, useEffect, useMemo, useState } from 'react';
import { readDesktopPerformanceSnapshot } from '../host/nativeActions';
import { subscribeDesktopPerformanceSnapshot } from '../host/nativeEvents';
import './PerformanceLogWindow.css';

/** The shapes Desktop main computes. Everything here is a value: the window
 * never receives a file path, handle, or way to read diagnostics. */
interface StartupPhase {
	readonly id: string;
	readonly label: string;
	readonly startOffsetMs: number;
	readonly durationMs?: number;
	readonly outcome: 'running' | 'completed' | 'failed';
	readonly failureReason?: string;
	readonly parentId?: string;
}

interface ProcessSample {
	readonly type: string;
	readonly pid: number;
	readonly cpuPercent: number;
	readonly memoryWorkingSetKiB: number;
	readonly name?: string;
	readonly serviceName?: string;
}

interface RuntimeSample {
	readonly at: number;
	readonly processes: readonly ProcessSample[];
	readonly maxCpuPercent: number;
	readonly eventLoop?: { readonly meanMs: number; readonly p99Ms: number };
	readonly heapUsedBytes: number;
	readonly rssBytes: number;
}

type TerminalUsage =
	| {
			readonly available: true;
			readonly cpuPercent: number;
			readonly rssBytes: number;
			readonly diskReadBytesPerSecond?: number;
			readonly diskWriteBytesPerSecond?: number;
			readonly processCount: number;
	  }
	| { readonly available: false; readonly reason: string };

interface TerminalRow {
	readonly sessionId: string;
	readonly projectId: string;
	readonly usage: TerminalUsage;
}

interface PerformanceSnapshot {
	readonly startup: {
		readonly phases: readonly StartupPhase[];
		readonly complete: boolean;
		readonly totalMs: number;
	};
	readonly samples: readonly RuntimeSample[];
	readonly terminals: {
		readonly diskAvailable: boolean;
		readonly sessions: readonly TerminalRow[];
	};
}

const UNAVAILABLE_REASONS: Readonly<Record<string, string>> = {
	'remote-environment': 'Runs on a remote environment',
	'not-running': 'Not running',
	unreadable: 'Could not be read',
};

function formatMs(value: number | undefined): string {
	if (value === undefined) return '—';
	if (value < 1) return '<1 ms';
	if (value < 1000) return `${Math.round(value)} ms`;
	return `${(value / 1000).toFixed(value < 10_000 ? 2 : 1)} s`;
}

function formatBytes(bytes: number): string {
	if (bytes <= 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB'];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function formatRate(bytesPerSecond: number | undefined): string {
	if (bytesPerSecond === undefined) return '—';
	return `${formatBytes(bytesPerSecond)}/s`;
}

/** Sparkline over the retained window. Presentation only. */
function Sparkline({
	values,
	max,
	label,
}: {
	readonly values: readonly number[];
	readonly max: number;
	readonly label: string;
}) {
	if (values.length < 2)
		return <div className="perf-spark perf-spark--empty" />;
	const ceiling = Math.max(max, 1);
	const step = 100 / (values.length - 1);
	const points = values
		.map((value, index) => {
			const y = 30 - Math.min(1, Math.max(0, value / ceiling)) * 28;
			return `${(index * step).toFixed(2)},${y.toFixed(2)}`;
		})
		.join(' ');
	return (
		<svg
			className="perf-spark"
			viewBox="0 0 100 30"
			preserveAspectRatio="none"
			role="img"
			aria-label={label}
		>
			<polyline points={points} fill="none" strokeWidth="1.5" />
		</svg>
	);
}

function StartupBreakdown({
	startup,
}: {
	readonly startup: PerformanceSnapshot['startup'];
}) {
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
	const topLevel = startup.phases.filter(
		(phase) => phase.parentId === undefined,
	);
	const total = Math.max(
		startup.totalMs,
		...topLevel.map((phase) => (phase.durationMs ?? 0) + phase.startOffsetMs),
		1,
	);
	const slowest = topLevel.reduce<StartupPhase | undefined>(
		(worst, phase) =>
			(phase.durationMs ?? 0) > (worst?.durationMs ?? -1) ? phase : worst,
		undefined,
	);

	if (topLevel.length === 0) {
		return <p className="perf-empty">No startup timing was recorded.</p>;
	}

	return (
		<div className="perf-phases">
			{topLevel.map((phase) => {
				const children = startup.phases.filter(
					(candidate) => candidate.parentId === phase.id,
				);
				const isOpen = expanded.has(phase.id);
				const share = ((phase.durationMs ?? 0) / total) * 100;
				const dominant = slowest?.id === phase.id && share >= 20;
				return (
					<div className="perf-phase" key={phase.id}>
						<button
							type="button"
							className={`perf-phase-row${dominant ? ' perf-phase-row--dominant' : ''}`}
							aria-expanded={children.length > 0 ? isOpen : undefined}
							disabled={children.length === 0}
							onClick={() =>
								setExpanded((current) => {
									const next = new Set(current);
									if (next.has(phase.id)) next.delete(phase.id);
									else next.add(phase.id);
									return next;
								})
							}
						>
							<span className="perf-phase-caret" aria-hidden="true">
								{children.length === 0 ? '' : isOpen ? '▾' : '▸'}
							</span>
							<span className="perf-phase-label">{phase.label}</span>
							<span className="perf-phase-bar" aria-hidden="true">
								<span
									className={`perf-phase-fill perf-phase-fill--${phase.outcome}`}
									style={{
										insetInlineStart: `${(phase.startOffsetMs / total) * 100}%`,
										inlineSize: `${Math.max(share, 0.5)}%`,
									}}
								/>
							</span>
							<span className="perf-phase-duration">
								{phase.outcome === 'running'
									? 'running'
									: formatMs(phase.durationMs)}
							</span>
						</button>
						{phase.failureReason === undefined ? null : (
							<p className="perf-phase-failure">
								Startup failed here: {phase.failureReason}
							</p>
						)}
						{isOpen && children.length > 0 ? (
							<ul className="perf-subphases">
								{children.map((child) => (
									<li key={child.id}>
										<span>{child.label}</span>
										<span>{formatMs(child.durationMs)}</span>
									</li>
								))}
							</ul>
						) : null}
					</div>
				);
			})}
			<p className="perf-phase-total">
				{startup.complete
					? `Workspace ready in ${formatMs(startup.totalMs)}`
					: `Started ${formatMs(startup.totalMs)} ago and still starting`}
				{slowest === undefined
					? ''
					: ` · slowest phase: ${slowest.label} (${formatMs(slowest.durationMs)})`}
			</p>
		</div>
	);
}

export function PerformanceLogWindow() {
	const [snapshot, setSnapshot] = useState<PerformanceSnapshot | null>(null);
	const [unavailable, setUnavailable] = useState(false);

	const accept = useCallback((value: unknown) => {
		if (typeof value === 'object' && value !== null && !Array.isArray(value))
			setSnapshot(value as unknown as PerformanceSnapshot);
	}, []);

	useEffect(() => {
		let cancelled = false;
		void readDesktopPerformanceSnapshot()
			.then((value) => {
				if (cancelled) return;
				if (value === null) setUnavailable(true);
				else accept(value);
			})
			.catch(() => {
				if (!cancelled) setUnavailable(true);
			});
		const stop = subscribeDesktopPerformanceSnapshot((value) => {
			if (!cancelled) accept(value);
		});
		return () => {
			cancelled = true;
			stop();
		};
	}, [accept]);

	const latest = snapshot?.samples.at(-1);
	const cpuSeries = useMemo(
		() => (snapshot?.samples ?? []).map((sample) => sample.maxCpuPercent),
		[snapshot],
	);
	const rssSeries = useMemo(
		() => (snapshot?.samples ?? []).map((sample) => sample.rssBytes),
		[snapshot],
	);

	if (unavailable) {
		return (
			<main className="perf-window">
				<p className="perf-empty">
					The Performance Log is only available for the Local server on Terminay
					Desktop.
				</p>
			</main>
		);
	}

	if (snapshot === null) {
		return (
			<main className="perf-window" aria-busy="true">
				<p className="perf-empty">Collecting…</p>
			</main>
		);
	}

	const { terminals } = snapshot;

	return (
		<main className="perf-window">
			<section className="perf-section">
				<h2 className="perf-heading">Startup</h2>
				<StartupBreakdown startup={snapshot.startup} />
			</section>

			<section className="perf-section">
				<h2 className="perf-heading">This application</h2>
				<div className="perf-cards">
					<div className="perf-card">
						<span className="perf-card-label">Busiest process</span>
						<span className="perf-card-value">
							{latest === undefined
								? '—'
								: `${latest.maxCpuPercent.toFixed(1)}%`}
						</span>
						<Sparkline
							values={cpuSeries}
							max={100}
							label="Busiest process CPU over the retained window"
						/>
					</div>
					<div className="perf-card">
						<span className="perf-card-label">Main memory</span>
						<span className="perf-card-value">
							{latest === undefined ? '—' : formatBytes(latest.rssBytes)}
						</span>
						<Sparkline
							values={rssSeries}
							max={Math.max(...rssSeries, 1)}
							label="Main process resident memory over the retained window"
						/>
					</div>
					<div className="perf-card">
						<span className="perf-card-label">Event loop (p99)</span>
						<span className="perf-card-value">
							{latest?.eventLoop === undefined
								? '—'
								: formatMs(latest.eventLoop.p99Ms)}
						</span>
					</div>
				</div>
				<table className="perf-table">
					<thead>
						<tr>
							<th scope="col">Process</th>
							<th scope="col">CPU</th>
							<th scope="col">Memory</th>
						</tr>
					</thead>
					<tbody>
						{(latest?.processes ?? []).map((entry) => (
							<tr key={entry.pid}>
								<td>{entry.serviceName ?? entry.name ?? entry.type}</td>
								<td>{entry.cpuPercent.toFixed(1)}%</td>
								<td>{formatBytes(entry.memoryWorkingSetKiB * 1024)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</section>

			<section className="perf-section">
				<h2 className="perf-heading">Terminals</h2>
				{terminals.diskAvailable ? null : (
					<p className="perf-note">
						Per-terminal disk activity is not available on this platform.
					</p>
				)}
				{terminals.sessions.length === 0 ? (
					<p className="perf-empty">No terminals are open.</p>
				) : (
					<table className="perf-table">
						<thead>
							<tr>
								<th scope="col">Terminal</th>
								<th scope="col">CPU</th>
								<th scope="col">Memory</th>
								{terminals.diskAvailable ? (
									<>
										<th scope="col">Disk read</th>
										<th scope="col">Disk write</th>
									</>
								) : null}
							</tr>
						</thead>
						<tbody>
							{terminals.sessions.map((row) => (
								<tr key={row.sessionId}>
									<th scope="row" className="perf-terminal-name">
										{row.sessionId}
										<span className="perf-terminal-project">
											{row.projectId}
										</span>
									</th>
									{row.usage.available ? (
										<>
											<td>{row.usage.cpuPercent.toFixed(1)}%</td>
											<td>{formatBytes(row.usage.rssBytes)}</td>
											{terminals.diskAvailable ? (
												<>
													<td>
														{formatRate(row.usage.diskReadBytesPerSecond)}
													</td>
													<td>
														{formatRate(row.usage.diskWriteBytesPerSecond)}
													</td>
												</>
											) : null}
										</>
									) : (
										<td
											className="perf-unavailable"
											colSpan={terminals.diskAvailable ? 4 : 2}
										>
											Not available —{' '}
											{UNAVAILABLE_REASONS[row.usage.reason] ??
												row.usage.reason}
										</td>
									)}
								</tr>
							))}
						</tbody>
					</table>
				)}
			</section>
		</main>
	);
}
