import type {
	TerminayBundleCompatibilityResult,
	TerminayHostCapability,
} from '@terminay/protocol';

export const BROWSER_BOOTSTRAP_STEPS = [
	'host-runtime',
	'session-host',
	'workspace-preparation',
	'bundle-installation',
	'route-activation',
	'application-registration',
	'application-mount',
] as const;

export type BrowserBootstrapStep = (typeof BROWSER_BOOTSTRAP_STEPS)[number];

export interface BrowserBootstrapFailure {
	readonly kind: 'browser-bootstrap-failure';
	readonly step: BrowserBootstrapStep;
	readonly stepLabel: string;
	readonly summary: string;
	readonly details: readonly string[];
	readonly missingRequiredCapabilities: readonly TerminayHostCapability[];
}

type CompatibilityFailure = Exclude<
	TerminayBundleCompatibilityResult,
	{ compatible: true }
>;

/**
 * Converts an untrusted bootstrap exception into bounded, user-visible
 * recovery copy. The underlying exception is deliberately not rendered: it
 * can originate from a remote server or transport and must not become page
 * content or leak connection material.
 */
export function describeBrowserBootstrapFailure(
	input: Readonly<{
		step: BrowserBootstrapStep;
		error: unknown;
	}>,
): BrowserBootstrapFailure {
	const failures = compatibilityFailures(input.error);
	const missingRequiredCapabilities = Object.freeze(
		[
			...new Set(
				failures.flatMap((failure) =>
					failure.component === 'host-capability' &&
					failure.code === 'missing-capability' &&
					failure.capability !== undefined
						? [failure.capability]
						: [],
				),
			),
		].sort(),
	);
	const details = Object.freeze([
		...missingRequiredCapabilities.map(
			(capability) =>
				`Missing required browser capability: ${capabilityLabel(capability)}.`,
		),
		...failures
			.filter(
				(failure) =>
					!(
						failure.component === 'host-capability' &&
						failure.code === 'missing-capability'
					),
			)
			.map(compatibilityDetail),
	]);
	const stepLabel = stepLabels[input.step];
	return Object.freeze({
		kind: 'browser-bootstrap-failure',
		step: input.step,
		stepLabel,
		summary:
			missingRequiredCapabilities.length > 0
				? 'This server workspace requires browser capabilities that are unavailable.'
				: `Terminay could not complete ${stepLabel.toLowerCase()}.`,
		details,
		missingRequiredCapabilities,
	});
}

const stepLabels: Readonly<Record<BrowserBootstrapStep, string>> =
	Object.freeze({
		'host-runtime': 'browser capability negotiation',
		'session-host': 'the secure session host check',
		'workspace-preparation': 'workspace bootstrap preparation',
		'bundle-installation': 'verified workspace bundle installation',
		'route-activation': 'workspace route activation',
		'application-registration': 'application connection registration',
		'application-mount': 'workspace presentation',
	});

function compatibilityFailures(
	error: unknown,
): readonly CompatibilityFailure[] {
	if (typeof error !== 'object' || error === null) return [];
	const candidate = error as Readonly<{
		failure?: unknown;
		failures?: unknown;
	}>;
	const values = Array.isArray(candidate.failures)
		? candidate.failures
		: candidate.failure === undefined
			? []
			: [candidate.failure];
	return Object.freeze(values.filter(isCompatibilityFailure));
}

function isCompatibilityFailure(value: unknown): value is CompatibilityFailure {
	if (typeof value !== 'object' || value === null) return false;
	const candidate = value as Readonly<{
		compatible?: unknown;
		component?: unknown;
		code?: unknown;
		capability?: unknown;
		required?: unknown;
	}>;
	if (
		candidate.compatible !== false ||
		typeof candidate.component !== 'string' ||
		typeof candidate.code !== 'string'
	)
		return false;
	if (
		candidate.component === 'host-capability' &&
		candidate.code === 'missing-capability'
	)
		return typeof candidate.capability === 'string';
	return (
		candidate.component !== 'host-capability' ||
		candidate.required !== undefined
	);
}

function compatibilityDetail(failure: CompatibilityFailure): string {
	if (
		failure.component === 'host-capability' &&
		failure.capability !== undefined
	)
		return `Required browser capability is incompatible: ${capabilityLabel(failure.capability)}.`;
	if (failure.component === 'application-protocol')
		return 'The server application protocol is not compatible with this workspace host.';
	if (
		failure.component === 'bundle-manifest' ||
		failure.component === 'bundle-binding'
	)
		return 'The server workspace bundle could not be verified for this session.';
	return `The ${failure.component.replaceAll('-', ' ')} compatibility requirement is not met.`;
}

function capabilityLabel(capability: TerminayHostCapability): string {
	return capability.replace(/([a-z])([A-Z])/gu, '$1 $2');
}
