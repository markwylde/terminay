/**
 * The notice for schedules that came due while Terminay was closed.
 *
 * Missed occurrences are never run on their own. This says so, briefly and
 * without alarm, and offers to run each automation now or to dismiss the
 * notice. Both are server operations, so the notice clears on every client
 * together.
 */

import { useState } from 'react';
import { refusalMessage } from './automationsModel';
import type { ServerAutomations } from './useServerAutomations';

export type MissedRunsNoticeProps = Readonly<{
	automations: ReadonlyMap<string, ServerAutomations>;
}>;

function formatWhen(at: number): string {
	return new Date(at).toLocaleString([], {
		weekday: 'short',
		hour: '2-digit',
		minute: '2-digit',
	});
}

export function MissedRunsNotice({ automations }: MissedRunsNoticeProps) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const servers = [...automations.values()].filter(
		(server) => server.status === 'ready' && server.missed.length > 0,
	);
	if (servers.length === 0) return null;
	const namesServers = automations.size > 1;

	const act = async (work: () => Promise<unknown>) => {
		setBusy(true);
		setError(undefined);
		try {
			await work();
		} catch (cause) {
			setError(refusalMessage(cause));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="automations-missed-backdrop">
			<div
				className="automations-missed"
				role="dialog"
				aria-modal="true"
				aria-labelledby="automations-missed-title"
				data-terminay-missed-runs="true"
			>
				<h2 id="automations-missed-title" className="automations-missed__title">
					While Terminay was closed
				</h2>
				<p className="automations-missed__text">
					These automations were scheduled to run while Terminay was closed.
					Nothing ran in the meantime — you can run them now if you like.
				</p>
				<ul className="automations-missed__list">
					{servers.flatMap((server) =>
						server.missed.map((record) => {
							const name =
								server.automations.find(
									(automation) => automation.id === record.automationId,
								)?.name ?? 'An automation';
							return (
								<li
									key={`${server.serverId}:${record.automationId}`}
									className="automations-missed__item"
									data-terminay-missed-run={record.automationId}
								>
									<span className="automations-missed__name">
										{name}
										{namesServers ? ` · ${server.label}` : ''}
									</span>
									<span className="automations-muted">
										{record.missedCount === 1
											? `missed ${formatWhen(record.latestDueAt)}`
											: `missed ${record.missedCount} times, last ${formatWhen(record.latestDueAt)}`}
									</span>
									<button
										type="button"
										className="automations-button"
										disabled={busy}
										data-terminay-missed-run-now={record.automationId}
										onClick={() =>
											void act(async () => {
												await server.client.run(record.automationId);
												server.refresh();
											})
										}
									>
										Run now
									</button>
								</li>
							);
						}),
					)}
				</ul>
				{error === undefined ? null : (
					<p className="automations-error" role="alert">
						{error}
					</p>
				)}
				<div className="automations-missed__footer">
					<button
						type="button"
						className="automations-button automations-button--primary"
						disabled={busy}
						data-terminay-missed-dismiss="true"
						onClick={() =>
							void act(async () => {
								await Promise.all(
									servers.map((server) => server.client.dismissMissed()),
								);
								for (const server of servers) server.refresh();
							})
						}
					>
						Dismiss
					</button>
				</div>
			</div>
		</div>
	);
}
