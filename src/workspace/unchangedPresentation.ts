import { sameJsonValue } from '../shared/sameJsonValue.ts';

/**
 * Presenting a workspace change without disturbing what it did not change
 * (ADR-0059). Each helper answers "is this the thing already presented?" and
 * hands back the presented thing when it is, so whatever is keyed on it, or
 * rendered from it, is left alone.
 */

/** `presented`, or `existing` when the two say the same thing. */
export function keepIfUnchanged<T>(existing: T | undefined, presented: T): T {
	return existing !== undefined && sameJsonValue(existing, presented)
		? existing
		: presented;
}

/** `ordered`, or `current` when it holds the same members in the same order. */
export function keepListIfUnchanged<T>(
	current: readonly T[],
	ordered: readonly T[],
): readonly T[] {
	return ordered.length === current.length &&
		ordered.every((member, index) => member === current[index])
		? current
		: ordered;
}

/** What a terminal's tab is told about how the terminal looks. */
export const TERMINAL_APPEARANCE_PARAMETERS = [
	'emoji',
	'color',
	'inheritsProjectColor',
	'activityIndicatorsEnabled',
] as const;

/**
 * The appearance parameters a panel must be handed to match the workspace:
 * those the workspace defines and the panel does not already hold. Dockview
 * renders a panel and its tab again for every parameter update, changed or
 * not, so an empty answer means the panel is not touched.
 */
export function changedTerminalAppearance(
	held: Readonly<Record<string, unknown>> | undefined,
	canonical: Readonly<
		Partial<Record<(typeof TERMINAL_APPEARANCE_PARAMETERS)[number], unknown>>
	>,
): Record<string, unknown> {
	const changed: Record<string, unknown> = {};
	for (const key of TERMINAL_APPEARANCE_PARAMETERS) {
		const value = canonical[key];
		if (value !== undefined && held?.[key] !== value) changed[key] = value;
	}
	return changed;
}
