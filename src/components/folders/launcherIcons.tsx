import {
	Cloud,
	Database,
	Folder,
	Info,
	KeyRound,
	type LucideIcon,
	Network,
	Server,
	TerminalSquare,
	TriangleAlert,
} from 'lucide-react';

/**
 * Terminay's icon allowlist as a launcher draws it. Extensions name an icon
 * by id and never supply artwork; an id this client does not know draws as a
 * terminal.
 */
const ALLOWLIST: Readonly<Record<string, LucideIcon>> = {
	terminal: TerminalSquare,
	server: Server,
	cloud: Cloud,
	key: KeyRound,
	folder: Folder,
	network: Network,
	database: Database,
	warning: TriangleAlert,
	info: Info,
};

/** Claude Code's mark, drawn by Terminay: an eight-ray asterisk. */
function ClaudeCodeMark({ size }: Readonly<{ size: number }>) {
	return (
		<svg
			className="launcher-icon launcher-icon--agent-claude-code"
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2.4}
			strokeLinecap="round"
			aria-hidden="true"
		>
			<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" />
		</svg>
	);
}

/** Codex's mark, drawn by Terminay: a hexagon around a dot. */
function CodexMark({ size }: Readonly<{ size: number }>) {
	return (
		<svg
			className="launcher-icon launcher-icon--agent-codex"
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M12 2.5 20.5 7.25v9.5L12 21.5 3.5 16.75v-9.5Z" />
			<circle cx="12" cy="12" r="3" />
		</svg>
	);
}

/** The icon for an allowlisted id, decorative: its button carries the name. */
export function LauncherIcon({
	icon,
	size = 13,
}: Readonly<{ icon: string; size?: number }>) {
	if (icon === 'agent-claude-code') return <ClaudeCodeMark size={size} />;
	if (icon === 'agent-codex') return <CodexMark size={size} />;
	const Icon = ALLOWLIST[icon] ?? TerminalSquare;
	return (
		<Icon
			className={`launcher-icon launcher-icon--${Object.hasOwn(ALLOWLIST, icon) ? icon : 'terminal'}`}
			size={size}
			aria-hidden="true"
		/>
	);
}
