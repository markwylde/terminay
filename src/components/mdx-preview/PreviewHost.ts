export type PreviewHostCapability = Readonly<{
	available: boolean;
	dedicatedOrigin: boolean;
	persistentStorage: boolean;
	governedDownloads: boolean;
	isolatedExecution: boolean;
	sandbox: string;
}>;

export interface PreviewHost {
	readonly kind: 'desktop' | 'web';
	readonly capability: PreviewHostCapability;
	destroy(): void;
}

export function previewCapabilityForOrigin(
	origin: string | null,
): PreviewHostCapability {
	if (origin === null)
		return Object.freeze({
			available: true,
			dedicatedOrigin: false,
			persistentStorage: true,
			governedDownloads: true,
			isolatedExecution: true,
			sandbox: 'allow-scripts',
		});
	return Object.freeze({
		available: true,
		dedicatedOrigin: true,
		persistentStorage: true,
		governedDownloads: true,
		isolatedExecution: true,
		sandbox: 'allow-scripts allow-same-origin',
	});
}

export function unavailablePreviewCapability(): PreviewHostCapability {
	return Object.freeze({
		available: false,
		dedicatedOrigin: false,
		persistentStorage: false,
		governedDownloads: false,
		isolatedExecution: false,
		sandbox: '',
	});
}

export function previewCombinesScriptsAndSameOriginOn(
	capability: PreviewHostCapability,
	applicationOrigin: string,
	previewOrigin: string | null,
): boolean {
	if (!capability.available) return false;
	const sandbox = capability.sandbox;
	const scripts = /(?:^|\s)allow-scripts(?:\s|$)/u.test(sandbox);
	const sameOrigin = /(?:^|\s)allow-same-origin(?:\s|$)/u.test(sandbox);
	if (!scripts || !sameOrigin) return false;
	return previewOrigin === applicationOrigin;
}

/** Web keeps the opaque sandbox rather than weakening it with
 * allow-same-origin. Project-scoped component storage is brokered by the
 * parent; browser downloads use a Blob flow after the host fetches bytes. */
export class SandboxedWebPreviewHost implements PreviewHost {
	readonly kind = 'web' as const;
	readonly capability: PreviewHostCapability;
	private readonly frame: { src: string };
	constructor(frame: { src: string }, origin: string | null = null) {
		this.frame = frame;
		this.capability = previewCapabilityForOrigin(origin);
	}
	destroy(): void {
		this.frame.src = 'about:blank';
	}
}

/** Desktop currently renders the same opaque hosted bundle. Storage mutations
 * remain parent-brokered and downloads traverse the native save dialog; the
 * distinct host keeps future dedicated-origin webContents isolated from editor
 * callers. */
export class DesktopPreviewHost implements PreviewHost {
	readonly kind = 'desktop' as const;
	readonly capability: PreviewHostCapability;
	private readonly frame: { src: string };
	constructor(frame: { src: string }, origin: string | null = null) {
		this.frame = frame;
		this.capability = previewCapabilityForOrigin(origin);
	}
	destroy(): void {
		this.frame.src = 'about:blank';
	}
}

export class UnavailablePreviewHost implements PreviewHost {
	readonly kind: 'desktop' | 'web';
	readonly capability = unavailablePreviewCapability();
	constructor(kind: 'desktop' | 'web' = 'web') {
		this.kind = kind;
	}
	destroy(): void {}
}
