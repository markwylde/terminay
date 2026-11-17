/** Warnings for user messages whose execution failed to start, with Retry and Dismiss. */
import type { BotMessage } from '@terminay/protocol';

export function BotStartFailures({
	failures,
	recovering,
	onRecover,
}: Readonly<{
	failures: readonly BotMessage[];
	/** The message being retried or dismissed, if any. */
	recovering: string | undefined;
	onRecover: (message: BotMessage, action: 'retry' | 'dismiss') => void;
}>) {
	return failures.map((m) => (
		<div
			key={m.id}
			className="bots-note bots-note--warn bots-start-failure"
			data-terminay-bot-start-failure={m.id}
		>
			<span>{m.dispatch?.error}</span>
			<span className="bots-start-failure__actions">
				<button
					type="button"
					className="bots-btn bots-btn--sm"
					disabled={recovering !== undefined}
					data-terminay-bot-start-failure-retry="true"
					onClick={() => onRecover(m, 'retry')}
				>
					{recovering === m.id ? 'Retrying…' : 'Retry'}
				</button>
				<button
					type="button"
					className="bots-btn bots-btn--sm bots-btn--ghost"
					disabled={recovering !== undefined}
					data-terminay-bot-start-failure-dismiss="true"
					onClick={() => onRecover(m, 'dismiss')}
				>
					Dismiss
				</button>
			</span>
		</div>
	));
}
