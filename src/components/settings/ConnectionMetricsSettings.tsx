import type { TerminayClient } from '@terminay/client-core';
import {
	CONNECTION_METRICS_OPERATIONS,
	type ConnectionMetricBreakdown,
	type ConnectionMetricDuration,
	type ConnectionMetricsSummary,
	type ConnectionMetricTrigger,
} from '@terminay/protocol';
import { useCallback, useEffect, useState } from 'react';

const TRIGGER_LABELS: Readonly<Record<ConnectionMetricTrigger, string>> = {
	initial: 'First connect',
	'resume-probe': 'Back to the app',
	heartbeat: 'Heartbeat missed',
	'transport-closed': 'Transport closed',
	manual: 'Retry',
};

/** The columns shown per trigger; the rest are in `get_connection_metrics`. */
const COLUMNS: readonly Readonly<{ key: ConnectionMetricDuration; label: string }>[] = [
	{ key: 'detectMs', label: 'Detect' },
	{ key: 'transportMs', label: 'Transport' },
	{ key: 'syncMs', label: 'Sync' },
	{ key: 'totalMs', label: 'Total' },
];

function formatMs(value: number | undefined): string {
	if (value === undefined) return '–';
	return value >= 10_000 ? `${(value / 1000).toFixed(0)}s` : value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
}

function cell(breakdown: ConnectionMetricBreakdown, key: ConnectionMetricDuration): string {
	const stats = breakdown.durations[key];
	if (stats === undefined) return '–';
	return `${formatMs(stats.p50)} / ${formatMs(stats.p95)}`;
}

/**
 * The server's connection timing summary, under Record connection timings.
 * p50 / p95 per trigger; the full breakdown is in `get_connection_metrics`.
 */
export function ConnectionMetricsSettings({
	client,
	enabled,
}: Readonly<{ client: TerminayClient; enabled: boolean }>) {
	const [summary, setSummary] = useState<ConnectionMetricsSummary>();
	const [error, setError] = useState<string>();

	const refresh = useCallback(async () => {
		try {
			const response = await client.query(CONNECTION_METRICS_OPERATIONS.summary, {});
			setSummary(response.result as unknown as ConnectionMetricsSummary);
			setError(undefined);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	}, [client]);

	useEffect(() => {
		void refresh();
	}, [refresh, enabled]);

	const clear = async () => {
		try {
			await client.command(CONNECTION_METRICS_OPERATIONS.clear, {});
		} finally {
			await refresh();
		}
	};

	if (error !== undefined)
		return (
			<div className="settings-row settings-row--stacked" role="status">
				<span className="settings-row-description">
					This server does not report connection timings.
				</span>
			</div>
		);
	if (summary === undefined) return null;
	const triggers = (Object.keys(TRIGGER_LABELS) as ConnectionMetricTrigger[]).filter(
		(trigger) => summary.byTrigger[trigger] !== undefined,
	);
	const alive = summary.byKind['resume-alive'] ?? 0;
	return (
		<div
			className="settings-row settings-row--stacked connection-metrics"
			data-testid="connection-metrics-summary"
		>
			<div className="settings-row-info">
				<span className="settings-row-label">
					{summary.count === 0
						? 'No samples yet'
						: `${summary.count} samples${summary.since === undefined ? '' : ` since ${new Date(summary.since).toLocaleDateString()}`}`}
				</span>
				<span className="settings-row-description">
					{summary.count === 0
						? enabled
							? 'Samples appear after a device connects or returns to the app.'
							: 'Turn on Record connection timings to start measuring.'
						: `Median / 95th percentile. Survived a return to the app ${alive} times; ${summary.overall.retried} needed more than one attempt.`}
				</span>
			</div>
			{triggers.length > 0 ? (
				<table className="connection-metrics__table">
					<thead>
						<tr>
							<th scope="col">Trigger</th>
							<th scope="col">Count</th>
							{COLUMNS.map((column) => (
								<th key={column.key} scope="col">
									{column.label}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{triggers.map((trigger) => {
							const breakdown = summary.byTrigger[trigger] as ConnectionMetricBreakdown;
							return (
								<tr key={trigger}>
									<th scope="row">{TRIGGER_LABELS[trigger]}</th>
									<td>{breakdown.count}</td>
									{COLUMNS.map((column) => (
										<td key={column.key}>{cell(breakdown, column.key)}</td>
									))}
								</tr>
							);
						})}
					</tbody>
				</table>
			) : null}
			{summary.count > 0 ? (
				<div className="settings-row-control">
					<button
						type="button"
						className="settings-secondary-button settings-secondary-button--small"
						onClick={() => void clear()}
					>
						Clear
					</button>
				</div>
			) : null}
		</div>
	);
}
