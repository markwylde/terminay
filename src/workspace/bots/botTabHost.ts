/**
 * What a Bots tab may ask of Home.
 *
 * The Bots section and each bot's tab are Home tabs, so Home owns opening,
 * titling, and closing them. A bot tab is named by its server and bot, so
 * opening a bot that already has a tab brings that tab forward.
 */

export type BotTabTarget = Readonly<{
	serverId: string;
	botId: string;
	/** Open in this mode; omitted keeps the tab's remembered mode. */
	mode?: 'chat' | 'configure';
	/** Bring this session forward in the tab, for a Needs you entry. */
	sessionId?: string;
}>;

export type BotTabHost = Readonly<{
	/** Open a bot's tab, or bring it forward. */
	openBot: (target: BotTabTarget) => void;
	/** Rename this tab, as a bot's rename retitles it. */
	setTitle: (title: string) => void;
	/** Close this tab, saying why when it was not the user's choice. */
	close: (why?: string) => void;
	/** Whether this tab is on screen; hidden tabs stay mounted. */
	isVisible: boolean;
	compact: boolean;
}>;
