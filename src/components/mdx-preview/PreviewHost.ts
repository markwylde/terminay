/** A rendering host intentionally receives bytes and opaque runtime identity,
 * never a project path or a privileged renderer capability.  Desktop can
 * replace this with a dedicated Electron webContents; browsers use the same
 * capability contract through a sandboxed frame. */
export type PreviewHostCapability = Readonly<{
	persistentStorage: boolean;
	governedDownloads: boolean;
}>;

export interface PreviewHost {
	readonly kind: 'desktop' | 'web';
	readonly capability: PreviewHostCapability;
	destroy(): void;
}

/** Web keeps the opaque sandbox rather than weakening it with
 * allow-same-origin. Project-scoped component storage is brokered by the
 * parent; browser downloads use a Blob flow after the host fetches bytes. */
export class SandboxedWebPreviewHost implements PreviewHost {
	readonly kind = 'web' as const;
	readonly capability = Object.freeze({ persistentStorage: true, governedDownloads: true });
	constructor(private readonly frame: HTMLIFrameElement) {}
	destroy(): void { this.frame.src = 'about:blank'; }
}

/** Desktop currently renders the same opaque hosted bundle. Storage mutations
 * remain parent-brokered and downloads traverse the native save dialog; the
 * distinct host keeps future dedicated-origin webContents isolated from editor
 * callers. */
export class DesktopPreviewHost implements PreviewHost {
	readonly kind = 'desktop' as const;
	readonly capability = Object.freeze({ persistentStorage: true, governedDownloads: true });
	constructor(private readonly frame: HTMLIFrameElement) {}
	destroy(): void { this.frame.src = 'about:blank'; }
}
