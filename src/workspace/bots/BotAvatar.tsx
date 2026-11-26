import { Avatar } from '@markwylde/chara-react';
import type { BotProfile } from '@terminay/protocol';
import { type BotActivity, botAvatarStyle, initials } from './botsModel';

const ACTIVITY_DOT: Readonly<Record<BotActivity, string>> = {
	idle: 'var(--bots-done-dot)',
	'needs-you': 'var(--bots-need-dot)',
	queued: 'var(--bots-start)',
	stopped: 'var(--bots-idle-dot)',
	working: 'var(--bots-work-dot)',
};

/** A bot's Chara Critter or character/picture badge, with an activity dot. */
export function BotAvatar({
	bot,
	activity,
	size = 'md',
}: Readonly<{
	bot: Pick<BotProfile, 'name' | 'colour' | 'avatar' | 'avatarStyle'>;
	activity?: BotActivity;
	size?: 'sm' | 'md' | 'lg';
}>) {
	const picture = /^data:image\/(png|jpeg|webp|gif);base64,/.test(bot.avatar)
		? bot.avatar
		: undefined;
	const style = picture === undefined ? botAvatarStyle(bot) : 'character';
	return (
		<span
			className={`bots-avatar bots-avatar--${size}${style === 'critter' ? ' bots-avatar--critter' : ''}`}
			style={
				style === 'critter'
					? undefined
					: { background: bot.colour || '#7cc4f5' }
			}
			data-terminay-bot-avatar-style={style}
			aria-hidden="true"
		>
			{picture !== undefined ? (
				<img src={picture} alt="" />
			) : style === 'critter' ? (
				<Avatar name={bot.name} theme="critter" radius={0} />
			) : (
				bot.avatar.trim() || initials(bot.name)
			)}
			{activity === undefined ? null : (
				<i style={{ background: ACTIVITY_DOT[activity] }} />
			)}
		</span>
	);
}
