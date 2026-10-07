/**
 * Which workspace view a window presents on a server, and what it is called.
 *
 * A project is in one view, and a view is presented by one window. The first
 * window to show a server presents that server's default view. A further
 * window on the same server presents a view of its own, so no project is ever
 * in two windows; projects are moved between them by dragging.
 */

/** What a window is presenting: a server's default view, or a named one. */
export type WindowViewKey = 'default' | (string & {});

export type WindowViewChoice = Readonly<{
	/** Absent for the server's default view. */
	viewId?: string;
	/** True when the view is this window's own: the window creates it if the
	 * server does not have it yet, and stays open while it is empty. */
	ownView: boolean;
}>;

const OWN_VIEW = /^view-window-([1-9]\d*)$/u;

/**
 * Choose the view for a window that is about to show a server.
 *
 * Own views are numbered per server and reused, lowest free first. A window
 * that was closed with projects still in its view therefore gets them back
 * when a further window is next opened on that server, and views do not pile
 * up on the server.
 */
export function chooseWindowView(
	options: Readonly<{
		/** The view a torn-off window was created for, on the server it was
		 * created on. */
		tornOffViewId?: string;
		/** What every other workspace window on this server is presenting. */
		othersOnServer: readonly WindowViewKey[];
	}>,
): WindowViewChoice {
	if (options.tornOffViewId !== undefined)
		return Object.freeze({ viewId: options.tornOffViewId, ownView: false });
	if (!options.othersOnServer.includes('default'))
		return Object.freeze({ ownView: false });
	const taken = new Set(options.othersOnServer);
	let slot = 2;
	while (taken.has(`view-window-${slot}`)) slot += 1;
	return Object.freeze({ viewId: `view-window-${slot}`, ownView: true });
}

export function isOwnWindowView(viewId: string): boolean {
	return OWN_VIEW.test(viewId);
}

const TITLE_LIMIT = 160;

/**
 * A workspace window's title: the server, then what the window holds.
 *
 * The server's name is the host's own. What follows comes from the page, which
 * is not trusted with the title, so it is reduced to bounded plain text and
 * can never replace or precede the server's name.
 */
export function workspaceWindowTitle(
	serverLabel: string,
	pageTitle: string,
): string {
	const detail = [...pageTitle]
		.map((character) => {
			const code = character.codePointAt(0) ?? 0;
			return code < 0x20 || code === 0x7f ? ' ' : character;
		})
		.join('')
		.replace(/\s+/gu, ' ')
		.trim()
		.slice(0, TITLE_LIMIT);
	// Until the workspace names its contents the page's title is its own file
	// name, which says nothing about the window.
	if (detail.length === 0 || /\.html?$/iu.test(detail)) return serverLabel;
	return `${serverLabel} - ${detail}`;
}
