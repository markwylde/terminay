import { Avatar, type AvatarState } from '@markwylde/chara-react';
import type { BotProfile } from '@terminay/protocol';
import { useId } from 'react';
import { type BotActivity, botAvatarStyle, initials } from './botsModel';
import { useBotAvatarsAnimated } from './useBotAvatarsAnimated';

const ACTIVITY_DOT: Readonly<Record<BotActivity, string>> = {
	idle: 'var(--bots-done-dot)',
	'needs-you': 'var(--bots-need-dot)',
	queued: 'var(--bots-start)',
	stopped: 'var(--bots-idle-dot)',
	working: 'var(--bots-work-dot)',
};

/** Activities in which a bot is not doing anything: its avatar loses its colour. */
const DORMANT: ReadonlySet<BotActivity> = new Set(['idle', 'stopped']);

/** What an animated Critter does for each activity. */
const CRITTER_STATE: Readonly<Record<BotActivity, AvatarState>> = {
	idle: 'idle',
	'needs-you': 'idle',
	queued: 'thinking',
	stopped: 'sleeping',
	working: 'working',
};

/** A `#rgb`/`#rrggbb` colour as the grey of the same luminance. */
function greyOf(colour: string): string {
	const hex = colour.trim().replace(/^#/, '');
	const full =
		hex.length === 3
			? hex
					.split('')
					.map((c) => c + c)
					.join('')
			: hex;
	if (!/^[0-9a-f]{6}$/i.test(full)) return '#7f8794';
	const [r, g, b] = [0, 2, 4].map((i) =>
		Number.parseInt(full.slice(i, i + 2), 16),
	);
	const y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
	return `rgb(${y}, ${y}, ${y})`;
}

/**
 * A bot's Chara Critter or character/picture badge, with an activity dot.
 * While the bot is idle or stopped the avatar is drawn in greyscale; the
 * activity dot keeps its colour. A Critter given an activity animates it,
 * unless the `animateBotAvatars` setting is off.
 */
export function BotAvatar({
	bot,
	activity,
	size = 'md',
}: Readonly<{
	bot: Pick<BotProfile, 'name' | 'colour' | 'avatar' | 'avatarStyle'>;
	activity?: BotActivity;
	size?: 'sm' | 'md' | 'lg';
}>) {
	const rawId = useId();
	const animate = useBotAvatarsAnimated();
	// Isolate internal SVG <defs>/<clipPath> ids per mounted avatar so a hidden
	// copy (e.g. an inactive tab) can never break clipping on visible copies.
	const idPrefix = `ba_${rawId.replace(/[^A-Za-z0-9_-]/g, '')}_`;
	const picture = /^data:image\/(png|jpeg|webp|gif);base64,/.test(bot.avatar)
		? bot.avatar
		: undefined;
	const style = picture === undefined ? botAvatarStyle(bot) : 'character';
	const dormant = activity !== undefined && DORMANT.has(activity);
	const colour = bot.colour || '#7cc4f5';
	return (
		<span
			className={`bots-avatar bots-avatar--${size}${style === 'critter' ? ' bots-avatar--critter' : ''}${dormant ? ' bots-avatar--dormant' : ''}`}
			style={
				style === 'critter'
					? undefined
					: { background: dormant ? greyOf(colour) : colour }
			}
			data-terminay-bot-avatar-style={style}
			data-terminay-bot-avatar-dormant={dormant ? 'true' : undefined}
			aria-hidden="true"
		>
			{picture !== undefined ? (
				<img src={picture} alt="" />
			) : style === 'critter' ? (
				<Avatar
					name={bot.name}
					theme="critter"
					variant="standalone"
					idPrefix={idPrefix}
					mono={dormant}
					animated={animate && activity !== undefined}
					state={activity === undefined ? 'idle' : CRITTER_STATE[activity]}
				/>
			) : (
				bot.avatar.trim() || initials(bot.name)
			)}
			{activity === undefined ? null : (
				<i style={{ background: ACTIVITY_DOT[activity] }} />
			)}
		</span>
	);
}
