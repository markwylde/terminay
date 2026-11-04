/** Playwright's Docker default-derived profile, with Chromium namespace calls.
 * Source: microsoft/playwright ae935a43d9e376e4759548f6b3c6905c7b282333
 * utils/docker/seccomp_profile.json. Apache-2.0; see LICENSE.playwright.
 * Keep the deny-by-default profile; never substitute unconfined or SYS_ADMIN.
 */
import profile from './browser-seccomp.json' with { type: 'json' };
// The supervisor uses pidfds to avoid signaling recycled PIDs. Keep those
// ordinary process-ownership operations available under the browser profile.
export const BOT_BROWSER_SECCOMP = {
	...profile,
	syscalls: [
		...profile.syscalls,
		{
			names: ['pidfd_open', 'pidfd_send_signal'],
			action: 'SCMP_ACT_ALLOW',
			args: [],
			includes: {},
			excludes: {},
		},
	],
};
export const BOT_BROWSER_SECURITY_OPT = `seccomp=${JSON.stringify(BOT_BROWSER_SECCOMP)}`;
