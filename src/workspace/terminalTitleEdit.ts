/** The title sources a server publishes for a terminal panel. */
export type TerminalTitleSources = Readonly<{
	defaultTitle?: string;
	namedTitle?: string;
	programTitle?: string;
}>;

export type TerminalTitleDraft = Readonly<{
	/** What the name field holds: the name someone gave the tab, or nothing. */
	title: string;
	/** What the tab shows with no name: its program's title, else its default
	 * name. Absent when the server does not tell the sources apart. */
	automaticTitle?: string;
}>;

/**
 * The name field edits only the name a person gave the tab. A tab showing a
 * title its program set has no such name, so the field is empty and the
 * automatic title is its placeholder.
 */
export function terminalTitleDraft(
	sources: TerminalTitleSources | undefined,
	shownTitle: string,
): TerminalTitleDraft {
	if (sources?.defaultTitle === undefined) return { title: shownTitle };
	return {
		title: sources.namedTitle ?? '',
		automaticTitle: sources.programTitle ?? sources.defaultTitle,
	};
}

/**
 * What submitting the name field sends and shows. An empty name takes the
 * tab's name away, returning it to its automatic title.
 */
export function terminalTitleSubmission(
	draft: TerminalTitleDraft,
	entered: string,
	shownTitle: string,
): Readonly<{ patchTitle: string; shownTitle: string }> {
	const name = entered.trim();
	if (name.length > 0) return { patchTitle: name, shownTitle: name };
	return draft.automaticTitle === undefined
		? { patchTitle: shownTitle, shownTitle }
		: { patchTitle: '', shownTitle: draft.automaticTitle };
}
