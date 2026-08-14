import type {
	TerminayHostAction,
	TerminayHostActionRequest,
	TerminayHostContext,
	TerminayHostMenuAccelerator,
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
): Promise<
	Readonly<{ handled: false }> | Readonly<{ handled: true; result: unknown }>
> {
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
		(status.latestVersion !== null &&
			typeof status.latestVersion !== 'string') ||
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

export async function updateNativeMenuAccelerators(
	accelerators: readonly TerminayHostMenuAccelerator[],
): Promise<void> {
	await request({ type: 'menu.accelerators.update', accelerators });
}

export type WorkspaceDragDecision =
	| Readonly<{ action: 'reorder' }>
	| Readonly<{ action: 'merge'; targetViewId: string }>
	| Readonly<{ action: 'popout'; x: number; y: number }>;

export async function beginWorkspaceDrag(input: {
	viewId: string;
	preview: { title: string; emoji: string; color: string; width: number };
}): Promise<void> {
	await request({ type: 'workspace.drag.start', ...input });
}

export async function endWorkspaceDrag(): Promise<WorkspaceDragDecision> {
	const response = await request({ type: 'workspace.drag.end' });
	if (!response.handled) return { action: 'reorder' };
	const value = response.result;
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new TypeError('native workspace drag result is invalid');
	const result = value as Record<string, unknown>;
	if (result.action === 'reorder' && Object.keys(result).length === 1)
		return { action: 'reorder' };
	if (
		result.action === 'merge' &&
		Object.keys(result).length === 2 &&
		typeof result.targetViewId === 'string'
	)
		return { action: 'merge', targetViewId: result.targetViewId };
	if (
		result.action === 'popout' &&
		Object.keys(result).length === 3 &&
		typeof result.x === 'number' &&
		Number.isFinite(result.x) &&
		typeof result.y === 'number' &&
		Number.isFinite(result.y)
	)
		return { action: 'popout', x: result.x, y: result.y };
	throw new TypeError('native workspace drag result is invalid');
}

export async function presentWorkspaceView(
	viewId: string,
	position: { x: number; y: number },
): Promise<void> {
	const query = new URLSearchParams({
		view: viewId,
		x: String(position.x),
		y: String(position.y),
	});
	const response = await request({
		type: 'route.present',
		route: `/?${query.toString()}`,
		disposition: 'native-window',
		logicalViewId: `workspace:${viewId}`,
	});
	if (!response.handled)
		throw new Error('Native workspace windows are unavailable.');
}
