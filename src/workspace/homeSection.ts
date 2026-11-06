/**
 * The sections Home's sidebar offers.
 *
 * Home is the one place in a workspace that is not a project, so it is where
 * workspace-wide things live: an overview, the tab dashboard, bots,
 * automations, workflows, and recordings. The sidebar is a menu over exactly these six,
 * in this order.
 */

export const HOME_SECTIONS = [
	'home',
	'tabs',
	'bots',
	'automations',
	'workflows',
	'recordings',
] as const;
export type HomeSection = (typeof HOME_SECTIONS)[number];

/** The overview. A device with no remembered section starts here. */
export const DEFAULT_HOME_SECTION: HomeSection = 'home';

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
	recordings: 'Recordings',
	tabs: 'Tabs',
	workflows: 'Workflows',
};
