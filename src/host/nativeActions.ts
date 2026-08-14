import type {
	TerminayHostAction,
	TerminayHostActionRequest,
	TerminayHostContext,
} from '@terminay/protocol';
import type { AppUpdateStatus } from '../types/terminay';

type NativeHostBridge = Readonly<{
	getContext(): Promise<TerminayHostContext>;
	requestAction(request: TerminayHostActionRequest): Promise<unknown>;
}>;

function bridge(): NativeHostBridge | undefined {
	return window.terminayHost as unknown as NativeHostBridge | undefined;
}

async function request(
	action: TerminayHostAction,
): Promise<Readonly<{ handled: false }> | Readonly<{ handled: true; result: unknown }>> {
	const host = bridge();
	if (host === undefined) return { handled: false };
	const context = await host.getContext();
	const result = await host.requestAction({
		schemaVersion: 1,
		bridgeVersion: 1,
		sourceId: context.sourceId,
		windowId: context.windowId,
		profileId: context.profileId,
		serverId: context.serverId,
		userGesture: true,
		action,
	});
	return { handled: true, result };
}

/** Clipboard writes are semantic user actions. Desktop owns the privileged
 * write; browser sessions use their exact-origin Clipboard API. */
export async function writeClipboardText(text: string): Promise<void> {
	if ((await request({ type: 'clipboard.write', text })).handled) return;
	await navigator.clipboard.writeText(text);
}

/** Clipboard reads remain an exact-document, user-gesture browser capability.
 * They are deliberately not elevated through the privileged Desktop host. */
export async function readClipboardText(): Promise<string> {
	if (navigator.clipboard?.readText === undefined) return '';
	return navigator.clipboard.readText();
}

export function canReadClipboardText(): boolean {
	return navigator.clipboard?.readText !== undefined;
}

/** External navigation is privileged in Desktop and ordinary browser
 * navigation elsewhere. Only HTTPS/mail/tel URLs pass the protocol parser. */
export async function openExternalUrl(url: string): Promise<void> {
	if ((await request({ type: 'os.open-external', url })).handled) return;
	window.open(url, '_blank', 'noopener,noreferrer');
}

function parseUpdateStatus(value: unknown): AppUpdateStatus {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new TypeError('native updater returned an invalid status');
	const status = value as Record<string, unknown>;
	if (
		(status.checkedAt !== null && typeof status.checkedAt !== 'string') ||
		typeof status.currentVersion !== 'string' ||
		(status.errorMessage !== null && typeof status.errorMessage !== 'string') ||
		typeof status.hasUpdate !== 'boolean' ||
		(status.latestVersion !== null && typeof status.latestVersion !== 'string') ||
		(status.releaseUrl !== null && typeof status.releaseUrl !== 'string')
	)
		throw new TypeError('native updater returned an invalid status');
	return status as AppUpdateStatus;
}

export async function checkForAppUpdate(): Promise<AppUpdateStatus | null> {
	const response = await request({ type: 'updater.check' });
	return response.handled ? parseUpdateStatus(response.result) : null;
}

export async function closeHostPresentation(): Promise<void> {
	if ((await request({ type: 'route.close' })).handled) return;
	window.close();
}
