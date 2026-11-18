/**
 * The sections Home's sidebar offers.
 *
 * Home is the one place in a workspace that is not a project, so it is where
 * workspace-wide things live: an overview, the monthly What's New post, the
 * tab dashboard, bots,
 * automations, workflows, recordings, and the pull requests and issues of the
 * forges the server's extensions reach. The sidebar is a menu over these, in
 * this order; Pull Requests and Issues are shown only where a forge source
 * serves them (ADR-0106).
 */

export const HOME_SECTIONS = [
	'home',
	'whatsNew',
	'tabs',
	'bots',
	'automations',
	'workflows',
	'recordings',
	'pullRequests',
	'issues',
] as const;
export type HomeSection = (typeof HOME_SECTIONS)[number];

/** The overview. A device with no remembered section starts here. */
export const DEFAULT_HOME_SECTION: HomeSection = 'home';

/** The sections a sidebar lists, in order. */
export function visibleHomeSections(
	hidden: ReadonlySet<HomeSection> | undefined,
): readonly HomeSection[] {
	return hidden === undefined || hidden.size === 0
		? HOME_SECTIONS
		: HOME_SECTIONS.filter((section) => !hidden.has(section));
}

export function isHomeSection(value: unknown): value is HomeSection {
	return (
		typeof value === 'string' &&
		(HOME_SECTIONS as readonly string[]).includes(value)
	);
}

export const HOME_SECTION_LABELS: Record<HomeSection, string> = {
	automations: 'Automations',
	bots: 'Bots',
	home: 'Home',
	issues: 'Issues',
	pullRequests: 'Pull Requests',
	recordings: 'Recordings',
	tabs: 'Tabs',
	whatsNew: "What's New",
	workflows: 'Workflows',
};
