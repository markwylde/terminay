/**
 * Environment views that need the bot's machine running (Shell, Desktop).
 *
 * Opening one of them never starts the machine. Until it runs, the view shows
 * the machine's state and one action that brings it up, so the user decides.
 */

import type { BotProfile } from '@terminay/protocol';
import { Monitor, SquareTerminal } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { BotEnvironmentSummary } from './botsModel';
import { refusalText, type ServerBots } from './useServerBots';

export type BotMachineView = 'shell' | 'desktop';

const VIEW_NAMES: Readonly<Record<BotMachineView, string>> = {
	shell: 'shell',
	desktop: 'desktop',
};

/** Words for the not-running panel. Exported for tests. */
export function machinePanelText(
	state: BotEnvironmentSummary,
	view: BotMachineView,
	starting: boolean,
): {
	title: string;
	detail: string;
	action?: string;
	actionDisabled?: boolean;
} {
	const name = VIEW_NAMES[view];
	if (starting || state === 'starting' || state === 'building')
		return {
			title:
				state === 'building'
					? 'Creating the machine…'
					: 'Starting the machine…',
			detail: `The ${name} opens when it is ready.`,
			action: 'Starting…',
			actionDisabled: true,
		};
	switch (state) {
		case 'not-created':
			return {
				title: 'Machine not created yet.',
				detail: `Create it to use the ${name}. Files work without it.`,
				action: 'Create machine',
			};
		case 'failed':
			return {
				title: 'The machine failed to start.',
				detail: 'Try again, or recreate it from Overview. The home is kept.',
				action: 'Try again',
			};
		case 'stopping':
			return {
				title: 'The machine is stopping.',
				detail: `Start it again once it has stopped to use the ${name}.`,
				action: 'Start machine',
				actionDisabled: true,
			};
		case 'unknown':
			return { title: 'Checking the machine…', detail: '' };
		default:
			return {
				title: 'Machine not started.',
				detail: `Start it to use the ${name}. Files work while it is stopped.`,
				action: 'Start machine',
			};
	}
}

export function BotMachineGate({
	server,
	bot,
	view,
	children,
}: Readonly<{
	server: ServerBots;
	bot: BotProfile;
	view: BotMachineView;
	children: ReactNode;
}>) {
	const state = server.environments.get(bot.id) ?? 'unknown';
	const [starting, setStarting] = useState(false);
	const [error, setError] = useState<string>();
	if (state === 'running') return <>{children}</>;

	const text = machinePanelText(state, view, starting);
	const start = () => {
		setStarting(true);
		setError(undefined);
		server.environment
			.lifecycle(bot.id, 'start', { confirmed: true })
			.then(() => server.refreshBot(bot.id))
			.catch((cause: unknown) => setError(refusalText(cause)))
			.finally(() => setStarting(false));
	};
	const Icon = view === 'shell' ? SquareTerminal : Monitor;

	return (
		<div
			className="bots-machine"
			data-terminay-bot-machine={state}
			data-terminay-bot-machine-view={view}
		>
			<div className={`bots-machine__icon bots-env-state--${state}`}>
				<Icon size={22} aria-hidden="true" />
			</div>
			<b className="bots-machine__title">{text.title}</b>
			{text.detail ? (
				<span className="bots-machine__detail">{text.detail}</span>
			) : null}
			{text.action ? (
				<button
					type="button"
					className="bots-btn bots-btn--primary"
					disabled={text.actionDisabled}
					onClick={start}
					data-terminay-bot-machine-start="true"
				>
					{text.action}
				</button>
			) : null}
			{error ? (
				<div className="bots-note bots-note--error bots-machine__error">
					{error}
				</div>
			) : null}
		</div>
	);
}
