import { useEffect, useRef } from 'react';
import {
	DesktopPreviewHost,
	SandboxedWebPreviewHost,
	UnavailablePreviewHost,
	type PreviewHost,
} from './PreviewHost';
import {
	PreviewController,
	type PreviewControllerOptions,
	type PreviewResource,
} from './PreviewController';
import { PreviewStorageBroker } from './PreviewStorageBroker';
import type { MdxPreviewMessage } from './previewMessages';
import { previewAcceptsFilesystemPath } from './previewRuntime';

export type { MdxPreviewMessage } from './previewMessages';
export { previewAcceptsFilesystemPath };

export function MdxPreview({
	runtimeId,
	bundle,
	storageKey,
	resources,
	fetchResource,
	onMessage,
	onExternalUrl,
}: {
	readonly runtimeId: string;
	readonly bundle: Uint8Array;
	readonly storageKey: string;
	readonly resources?: readonly PreviewResource[];
	readonly fetchResource?: PreviewControllerOptions['fetchResource'];
	readonly onMessage?: (message: MdxPreviewMessage) => void;
	readonly onExternalUrl?: (url: string) => void;
}) {
	const frame = useRef<HTMLIFrameElement>(null);
	useEffect(() => {
		const element = frame.current;
		if (element === null) return;
		const host: PreviewHost =
			window.terminayHost === undefined
				? new SandboxedWebPreviewHost(element)
				: new DesktopPreviewHost(element);
		if (!host.capability.available) {
			new UnavailablePreviewHost(host.kind);
			onMessage?.({
				version: 1,
				kind: 'diagnostic',
				runtimeId,
				message: 'Preview capability is unavailable on this host.',
			});
			return;
		}
		const controller = new PreviewController({
			runtimeId,
			bundle,
			storageKey,
			host,
			storage: new PreviewStorageBroker(window.localStorage),
			resources,
			fetchResource,
			onMessage,
			onExternalUrl,
		});
		const listener = (event: MessageEvent<unknown>) => {
			controller.handleMessage(event, element.contentWindow);
		};
		window.addEventListener('message', listener);
		controller.track(() => window.removeEventListener('message', listener));
		void controller.attach(element);
		return () => {
			controller.dispose();
		};
	}, [
		bundle,
		fetchResource,
		onExternalUrl,
		onMessage,
		resources,
		runtimeId,
		storageKey,
	]);
	return (
		<iframe
			ref={frame}
			title="MDX preview"
			sandbox="allow-scripts"
			referrerPolicy="no-referrer"
			style={{
				display: 'block',
				width: '100%',
				height: '100%',
				minHeight: 240,
				border: 0,
			}}
		/>
	);
}
