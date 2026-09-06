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

/** A process's most useful name, disambiguated by pid so two renderers are
 * never two identical rows. */
function processName(entry: ProcessSample): string {
	return entry.serviceName ?? entry.name ?? entry.type;
}

function Sparkline({
	values,
	label,
}: {
	readonly values: readonly number[];
	readonly label: string;
}) {
	if (values.length < 2)
		return <div className="perf-spark perf-spark--empty" aria-hidden="true" />;
	// Scale to the series' own range, not to zero. A flat-but-high series (a
	// steady 250 MB, say) would otherwise fill the whole card as a solid block
	// and hide the shape that actually matters.
	const low = Math.min(...values);
	const high = Math.max(...values);
	const span = high - low;
	const floor = span === 0 ? low - 1 : low - span * 0.25;
	const ceiling = span === 0 ? low + 1 : high + span * 0.15;
	const step = 100 / (values.length - 1);
	const points = values.map((value, index) => {
		const scaled = (value - floor) / (ceiling - floor);
		const y = 26 - Math.min(1, Math.max(0, scaled)) * 24;
		return `${(index * step).toFixed(2)},${y.toFixed(2)}`;
	});
	return (
		<svg
			className="perf-spark"
			viewBox="0 0 100 28"
			preserveAspectRatio="none"
			role="img"
			aria-label={label}
		>
			<title>{label}</title>
			<polyline
				className="perf-spark-area"
				points={`0,28 ${points.join(' ')} 100,28`}
			/>
			<polyline className="perf-spark-line" points={points.join(' ')} />
		</svg>
	);
}

function StatCard({
	label,
	value,
	series,
	seriesLabel,
}: {
	readonly label: string;
	readonly value: string;
	readonly series: readonly number[];
	readonly seriesLabel: string;
}) {
	return (
		<div className="perf-card">
			<span className="perf-card-label">{label}</span>
			<span className="perf-card-value">{value}</span>
			<Sparkline values={series} label={seriesLabel} />
		</div>
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
		<>
			<div className="perf-summary">
				<div className="perf-summary-stat">
					<span className="perf-summary-value">{formatMs(total)}</span>
					<span className="perf-summary-label">
						{startup.complete ? 'to workspace' : 'elapsed, still starting'}
					</span>
				</div>
				{slowest === undefined ? null : (
					<div className="perf-summary-stat perf-summary-stat--slow">
						<span className="perf-summary-value">
							{formatMs(slowest.durationMs)}
						</span>
						<span className="perf-summary-label">{slowest.label}</span>
					</div>
				)}
			</div>

			<div className="perf-phases">
				<div className="perf-scale" aria-hidden="true">
					<span>0</span>
					<span>{formatMs(total / 2)}</span>
					<span>{formatMs(total)}</span>
				</div>
				{topLevel.map((phase) => {
					const children = startup.phases.filter(
						(candidate) => candidate.parentId === phase.id,
					);
					const isOpen = expanded.has(phase.id);
					const share = ((phase.durationMs ?? 0) / total) * 100;
					const dominant = slowest?.id === phase.id && share >= 15;
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
								<span className="perf-phase-bar">
									<span
										className={`perf-phase-fill perf-phase-fill--${phase.outcome}`}
										style={{
											insetInlineStart: `${(phase.startOffsetMs / total) * 100}%`,
											inlineSize: `max(2px, ${share}%)`,
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
											<span className="perf-phase-bar">
												<span
													className="perf-phase-fill"
													style={{
														insetInlineStart: `${(child.startOffsetMs / total) * 100}%`,
														inlineSize: `max(2px, ${((child.durationMs ?? 0) / total) * 100}%)`,
													}}
												/>
											</span>
											<span>{formatMs(child.durationMs)}</span>
										</li>
									))}
								</ul>
							) : null}
						</div>
					);
				})}
			</div>
		</>
	);
}

export function PerformanceLogWindow() {
	const [snapshot, setSnapshot] = useState<PerformanceSnapshot | null>(null);
	const [unavailable, setUnavailable] = useState(false);

	// The payload crosses the host bridge, so shape it defensively: a partial or
	// unexpected snapshot must degrade to empty sections, never a blank window.
	const accept = useCallback((value: unknown) => {
		if (typeof value !== 'object' || value === null || Array.isArray(value))
			return;
		const raw = value as Record<string, unknown>;
		const startup = (raw.startup ?? {}) as Record<string, unknown>;
		const terminals = (raw.terminals ?? {}) as Record<string, unknown>;
		setSnapshot({
			startup: {
				phases: Array.isArray(startup.phases)
					? (startup.phases as readonly StartupPhase[])
					: [],
				complete: startup.complete === true,
				totalMs: typeof startup.totalMs === 'number' ? startup.totalMs : 0,
			},
			samples: Array.isArray(raw.samples)
				? (raw.samples as readonly RuntimeSample[])
				: [],
			terminals: {
				diskAvailable: terminals.diskAvailable === true,
				sessions: Array.isArray(terminals.sessions)
					? (terminals.sessions as readonly TerminalRow[])
					: [],
			},
		});
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

	const samples = snapshot?.samples ?? [];
	const latest = samples.at(-1);
	const cpuSeries = useMemo(
		() => samples.map((sample) => sample.maxCpuPercent),
		[samples],
	);
	const rssSeries = useMemo(
		() => samples.map((sample) => sample.rssBytes),
		[samples],
	);
	const eventLoopSeries = useMemo(
		() => samples.map((sample) => sample.eventLoop?.p99Ms ?? 0),
		[samples],
	);

	if (unavailable) {
		return (
			<div className="perf-window">
				<header className="perf-header">
					<h1>Performance</h1>
				</header>
				<div className="perf-body">
					<p className="perf-empty">
						The Performance Log is only available for the Local server on
						Terminay Desktop.
					</p>
				</div>
			</div>
		);
	}

	if (snapshot === null) {
		return (
			<div className="perf-window" aria-busy="true">
				<header className="perf-header">
					<h1>Performance</h1>
				</header>
				<div className="perf-body">
					<p className="perf-empty">Collecting…</p>
				</div>
			</div>
		);
	}

	const { terminals } = snapshot;
	const liveTerminals = terminals.sessions.filter(
		(row) => row.usage.available,
	).length;

	return (
		<div className="perf-window">
			<header className="perf-header">
				<h1>Performance</h1>
				<p>
					{snapshot.startup.complete
						? `Started in ${formatMs(snapshot.startup.totalMs)}`
						: 'Starting…'}
					{` · ${liveTerminals} terminal${liveTerminals === 1 ? '' : 's'} measured`}
					{' · nothing is written to disk'}
				</p>
			</header>

			<div className="perf-body">
				<section className="perf-section">
					<h2 className="perf-heading">Startup</h2>
					<StartupBreakdown startup={snapshot.startup} />
				</section>

				<section className="perf-section">
					<h2 className="perf-heading">This application</h2>
					<div className="perf-cards">
						<StatCard
							label="Busiest process"
							value={
								latest === undefined
									? '—'
									: `${latest.maxCpuPercent.toFixed(1)}%`
							}
							series={cpuSeries}
							seriesLabel="Busiest process CPU over the retained window"
						/>
						<StatCard
							label="Main memory"
							value={latest === undefined ? '—' : formatBytes(latest.rssBytes)}
							series={rssSeries}
							seriesLabel="Main process resident memory over the retained window"
						/>
						<StatCard
							label="Event loop (p99)"
							value={
								latest?.eventLoop === undefined
									? '—'
									: formatMs(latest.eventLoop.p99Ms)
							}
							series={eventLoopSeries}
							seriesLabel="Main process event-loop p99 delay over the retained window"
						/>
					</div>
					<table className="perf-table">
						<thead>
							<tr>
								<th scope="col">Process</th>
								<th scope="col" className="perf-numeric">
									CPU
								</th>
								<th scope="col" className="perf-numeric">
									Memory
								</th>
							</tr>
						</thead>
						<tbody>
							{(latest?.processes ?? []).map((entry) => (
								<tr key={entry.pid}>
									<td>
										<span className="perf-name">{processName(entry)}</span>
										<span className="perf-sub">pid {entry.pid}</span>
									</td>
									<td className="perf-numeric">
										{entry.cpuPercent.toFixed(1)}%
									</td>
									<td className="perf-numeric">
										{formatBytes(entry.memoryWorkingSetKiB * 1024)}
									</td>
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
									<th scope="col" className="perf-numeric">
										CPU
									</th>
									<th scope="col" className="perf-numeric">
										Memory
									</th>
									{terminals.diskAvailable ? (
										<>
											<th scope="col" className="perf-numeric">
												Read
											</th>
											<th scope="col" className="perf-numeric">
												Write
											</th>
										</>
									) : null}
								</tr>
							</thead>
							<tbody>
								{terminals.sessions.map((row) => (
									<tr key={row.sessionId}>
										<th scope="row">
											<span className="perf-name">{row.sessionId}</span>
											<span
												className={`perf-sub${row.usage.available ? '' : ' perf-unavailable'}`}
											>
												{row.projectId}
												{row.usage.available
													? ''
													: ` · ${UNAVAILABLE_REASONS[row.usage.reason] ?? row.usage.reason}`}
											</span>
										</th>
										<td className="perf-numeric">
											{row.usage.available
												? `${row.usage.cpuPercent.toFixed(1)}%`
												: '—'}
										</td>
										<td className="perf-numeric">
											{row.usage.available
												? formatBytes(row.usage.rssBytes)
												: '—'}
										</td>
										{terminals.diskAvailable ? (
											<>
												<td className="perf-numeric">
													{row.usage.available
														? formatRate(row.usage.diskReadBytesPerSecond)
														: '—'}
												</td>
												<td className="perf-numeric">
													{row.usage.available
														? formatRate(row.usage.diskWriteBytesPerSecond)
														: '—'}
												</td>
											</>
										) : null}
									</tr>
								))}
							</tbody>
						</table>
					)}
				</section>
			</div>
		</div>
	);
}
