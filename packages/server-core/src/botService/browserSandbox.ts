/** Playwright's Docker default-derived profile, with Chromium namespace calls.
 * Source: microsoft/playwright ae935a43d9e376e4759548f6b3c6905c7b282333
 * utils/docker/seccomp_profile.json. Apache-2.0; see LICENSE.playwright.
 * Keep the deny-by-default profile; never substitute unconfined or SYS_ADMIN.
 */
import profile from './browser-seccomp.json' with { type: 'json' };
export const BOT_BROWSER_SECCOMP = profile;
export const BOT_BROWSER_SECURITY_OPT = `seccomp=${JSON.stringify(profile)}`;
