import { BotEnvironmentClient } from '@terminay/client-core';
import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { EngineSummary } from './BotsSection';
import { recoveryNotice } from './botsModel';
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
	const [busy, setBusy] = useState<'start' | 'recreate'>();
	const [confirm, setConfirm] = useState(false);
	const state = server.environments.get(botId);
	// An out-of-date image is a routine update, built on the next start: only a
	// missing or failed image, or an engine fault, needs the engine card.
	const problem =
		!engine.status?.available ||
		engine.status.image.state === 'missing' ||
		engine.status.image.state === 'failed';
	const name = server.bots.find((bot) => bot.id === botId)?.name ?? 'This bot';
	const usable =
		engine.status?.available === true &&
		engine.status.image.state !== 'building';
	// Container updates are told on Environment › Overview from the bot's own
	// container; the shared image's state says nothing about this bot.
	const notice = usable ? recoveryNotice(name, state) : undefined;
	const action = async (recreate: boolean) => {
		setBusy(recreate ? 'recreate' : 'start');
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
			setBusy(undefined);
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
			{notice ? (
				<div
					className={`bots-alert bots-alert--${notice.tone}`}
					role="alert"
					data-terminay-bot-recovery-notice={notice.kind}
				>
					<TriangleAlert
						className="bots-alert__icon"
						size={16}
						aria-hidden="true"
					/>
					<div className="bots-alert__body">
						<strong>{notice.title}</strong>
						<span>{notice.detail}</span>
						{error ? (
							<span
								className="bots-alert__error"
								data-terminay-bot-recovery-error
							>
								{error}
							</span>
						) : null}
					</div>
					<div className="bots-alert__actions">
						{notice.recreate ? (
							<button
								type="button"
								className={`bots-btn bots-btn--sm${notice.create ? '' : ' bots-btn--primary'}`}
								disabled={busy !== undefined}
								onClick={() => setConfirm(true)}
							>
								{busy === 'recreate' ? 'Recreating…' : 'Recreate container'}
							</button>
						) : null}
						{notice.create ? (
							<button
								type="button"
								className="bots-btn bots-btn--sm bots-btn--primary"
								disabled={busy !== undefined}
								onClick={() => void action(false)}
							>
								{busy === 'start' ? 'Creating…' : notice.create}
							</button>
						) : null}
					</div>
					{confirm ? (
						<div
							className="bots-alert__confirm"
							role="alertdialog"
							aria-label="Recreate container?"
						>
							<span>
								Recreating stops active sessions and keeps the bot home.
							</span>
							<button
								type="button"
								className="bots-btn bots-btn--sm"
								onClick={() => setConfirm(false)}
							>
								Cancel
							</button>
							<button
								type="button"
								className="bots-btn bots-btn--sm bots-btn--primary"
								onClick={() => void action(true)}
							>
								Confirm recreate
							</button>
						</div>
					) : null}
				</div>
			) : error ? (
				<p role="alert" className="bots-note bots-note--error">
					{error}
				</p>
			) : null}
		</div>
	);
}
