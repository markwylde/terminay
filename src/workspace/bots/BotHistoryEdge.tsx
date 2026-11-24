/**
 * The top edge of a message history that loads as the reader scrolls up:
 * the sentinel that triggers the next page, a quiet loading or failure row,
 * or the start of the conversation once nothing older remains.
 */
import { LoaderCircle } from 'lucide-react';
import type { RefObject } from 'react';

export function BotHistoryEdge({
	sentinel,
	more,
	loading,
	error,
	onRetry,
	noun,
	start,
}: Readonly<{
	sentinel: RefObject<HTMLDivElement | null>;
	/** Older history remains to be loaded. */
	more: boolean;
	loading: boolean;
	error: string | undefined;
	onRetry: () => void;
	/** "messages" or "replies". */
	noun: string;
	/** Show the start-of-conversation marker once nothing older remains. */
	start: boolean;
}>) {
	if (!more)
		return start ? (
			<div className="bots-history-start" data-terminay-bot-history="start">
				<span>Start of conversation</span>
			</div>
		) : null;
	// The row keeps its height whether idle, loading or failed, so its
	// content changing never moves the message being read.
	return (
		<div
			className="bots-history-edge"
			data-terminay-bot-history={error ? 'error' : loading ? 'loading' : 'idle'}
		>
			<div
				ref={sentinel}
				className="bots-history-sentinel"
				aria-hidden="true"
			/>
			<div role="status" aria-live="polite">
				{error ? (
					<span className="bots-history-edge__error">
						Couldn’t load earlier {noun}.{' '}
						<button
							type="button"
							className="bots-link"
							data-terminay-bot-history-retry="true"
							onClick={onRetry}
						>
							Retry
						</button>
					</span>
				) : loading ? (
					<span className="bots-history-edge__loading">
						<LoaderCircle size={14} className="bots-spin" aria-hidden="true" />
						Loading earlier {noun}…
					</span>
				) : null}
			</div>
		</div>
	);
}
