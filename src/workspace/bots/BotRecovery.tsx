import { BotEnvironmentClient } from '@terminay/client-core';
import { useState } from 'react';
import { EngineSummary } from './BotsSection';
import { useBotEngine } from './useBotEngine';
import { refusalText, type ServerBots } from './useServerBots';

/** Shared recovery stays visible above Chat and every Configure panel. */
export function BotRecovery({
	server,
	botId,
	visible = true,
}: {
	server: ServerBots;
	botId: string;
	visible?: boolean;
}) {
	const engine = useBotEngine(server);
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState(false);
	const [confirm, setConfirm] = useState(false);
	const state = server.environments.get(botId);
	const problem =
		!engine.status?.available || engine.status.image.state !== 'current';
	const action = async (recreate: boolean) => {
		setBusy(true);
		setError(undefined);
		setConfirm(false);
		try {
			await new BotEnvironmentClient(server.transport as never).lifecycle(
				botId,
				recreate ? 'recreate' : 'start',
				{ confirmed: recreate },
			);
			server.refreshBot(botId);
		} catch (cause) {
			setError(refusalText(cause));
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="bots-recovery" data-terminay-bot-recovery>
			<EngineSummary
				engine={engine}
				label={undefined}
				compact
				hideReady={!problem && !engine.error}
				visible={visible}
			/>
			{engine.status?.available && engine.status.image.state !== 'building' ? (
				<div className="bots-engine__actions">
					{state === 'not-created' || state === 'failed' ? (
						<button
							type="button"
							className="bots-btn bots-btn--sm"
							disabled={busy}
							onClick={() => void action(false)}
						>
							Create environment
						</button>
					) : null}
					{engine.status.image.state === 'outdated' || state === 'failed' ? (
						<button
							type="button"
							className="bots-btn bots-btn--sm"
							disabled={busy}
							onClick={() => setConfirm(true)}
						>
							Recreate container
						</button>
					) : null}
					{confirm ? (
						<div role="alertdialog" aria-label="Recreate container?">
							Recreating stops active sessions and keeps the bot home.{' '}
							<button
								type="button"
								className="bots-btn"
								onClick={() => void action(true)}
							>
								Confirm recreate
							</button>
							<button
								type="button"
								className="bots-btn"
								onClick={() => setConfirm(false)}
							>
								Cancel
							</button>
						</div>
					) : null}
				</div>
			) : null}
			{error ? (
				<p role="alert" className="bots-note bots-note--warn">
					{error}
				</p>
			) : null}
		</div>
	);
}
