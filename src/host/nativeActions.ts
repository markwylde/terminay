import type {
	TerminayHostAction,
	TerminayHostActionRequest,
	TerminayHostContext,
} from '@terminay/protocol';

type NativeHostBridge = Readonly<{
	getContext(): Promise<TerminayHostContext>;
	requestAction(request: TerminayHostActionRequest): Promise<void>;
}>;

function bridge(): NativeHostBridge | undefined {
	return window.terminayHost as unknown as NativeHostBridge | undefined;
}

async function request(action: TerminayHostAction): Promise<boolean> {
	const host = bridge();
	if (host === undefined) return false;
	const context = await host.getContext();
	await host.requestAction({
		schemaVersion: 1,
		bridgeVersion: 1,
		sourceId: context.sourceId,
		windowId: context.windowId,
		profileId: context.profileId,
		serverId: context.serverId,
		userGesture: true,
		action,
	});
	return true;
}

/** Clipboard writes are semantic user actions. Desktop owns the privileged
 * write; browser sessions use their exact-origin Clipboard API. */
export async function writeClipboardText(text: string): Promise<void> {
	if (await request({ type: 'clipboard.write', text })) return;
	await navigator.clipboard.writeText(text);
}

/** External navigation is privileged in Desktop and ordinary browser
 * navigation elsewhere. Only HTTPS/mail/tel URLs pass the protocol parser. */
export async function openExternalUrl(url: string): Promise<void> {
	if (await request({ type: 'os.open-external', url })) return;
	window.open(url, '_blank', 'noopener,noreferrer');
}
