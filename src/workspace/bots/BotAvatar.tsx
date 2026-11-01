import type { BotProfile } from '@terminay/protocol';
import { type BotActivity, initials } from './botsModel';

const ACTIVITY_DOT: Readonly<Record<BotActivity, string>> = {
	idle: 'var(--bots-done-dot)',
	'needs-you': 'var(--bots-need-dot)',
	queued: 'var(--bots-start)',
	stopped: 'var(--bots-idle-dot)',
	working: 'var(--bots-work-dot)',
};

/** A bot's picture or initials on its colour, with an activity dot. */
export function BotAvatar({
	bot,
	activity,
	size = 'md',
}: Readonly<{
	bot: Pick<BotProfile, 'name' | 'colour' | 'avatar'>;
	activity?: BotActivity;
	size?: 'sm' | 'md' | 'lg';
}>) {
	const picture = /^data:image\/(png|jpeg|webp|gif);base64,/.test(bot.avatar)
		? bot.avatar
		: undefined;
	return (
		<span
			className={`bots-avatar bots-avatar--${size}`}
			style={{ background: bot.colour || '#7cc4f5' }}
			aria-hidden="true"
		>
			{picture === undefined ? (
				bot.avatar.trim() || initials(bot.name)
			) : (
				<img src={picture} alt="" />
			)}
			{activity === undefined ? null : (
				<i style={{ background: ACTIVITY_DOT[activity] }} />
			)}
		</span>
	);
}
