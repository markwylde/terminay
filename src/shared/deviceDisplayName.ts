/**
 * A trusted device, named the way a person recognises it.
 *
 * A browser enrols with its user agent as its name, which reads as a wall of
 * tokens ("Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) …"). The
 * lists of trusted devices show the device and browser instead and keep the
 * full string one click away. A name that is not a user agent — a Desktop's
 * computer name, say — is shown as it is.
 */

const DEVICES: ReadonlyArray<readonly [RegExp, string]> = [
	[/\biPhone\b/, 'iPhone'],
	[/\biPad\b/, 'iPad'],
	[/\bAndroid\b/, 'Android'],
	[/\bMacintosh\b|\bMac OS X\b/, 'Mac'],
	[/\bWindows\b/, 'Windows'],
	[/\bCrOS\b/, 'ChromeOS'],
	[/\bLinux\b|\bX11\b/, 'Linux'],
];

// Order matters: Edge and Opera also claim Chrome, Chrome also claims Safari.
const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
	[/\bEdg(?:e|A|iOS)?\/(\d+)/, 'Edge'],
	[/\bOPR\/(\d+)/, 'Opera'],
	[/\bFirefox\/(\d+)|\bFxiOS\/(\d+)/, 'Firefox'],
	[/\bCriOS\/(\d+)|\bChrome\/(\d+)/, 'Chrome'],
	[/\bVersion\/(\d+)[\d.]*.*\bSafari\//, 'Safari'],
	[/\bVersion\/(\d+)[\d.]*.*\bMobile\//, 'Safari'],
];

function looksLikeUserAgent(name: string): boolean {
	return /^Mozilla\/\d/.test(name.trim());
}

/** "iPhone · Safari 27" for a user agent; the name unchanged otherwise. */
export function deviceDisplayName(name: string): string {
	if (!looksLikeUserAgent(name)) return name;
	const device = DEVICES.find(([pattern]) => pattern.test(name))?.[1];
	let browser: string | undefined;
	for (const [pattern, label] of BROWSERS) {
		const match = pattern.exec(name);
		if (match === null) continue;
		const version = match.slice(1).find((part) => part !== undefined);
		browser = version === undefined ? label : `${label} ${version}`;
		break;
	}
	const parts = [device, browser].filter(
		(part): part is string => part !== undefined,
	);
	return parts.length === 0 ? 'Unknown browser' : parts.join(' · ');
}

/** Whether the shown name hides a longer original worth revealing. */
export function deviceNameIsAbbreviated(name: string): boolean {
	return deviceDisplayName(name) !== name;
}
