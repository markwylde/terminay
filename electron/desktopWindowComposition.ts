import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
	parseTerminayWorkspaceComposition,
	type TerminayWorkspaceComposition,
} from '@terminay/protocol';

/**
 * Device-local presentation state for a Desktop window: which servers it has
 * attached, the workspace view chosen on each, and its interleaved tab order.
 *
 * This is the same class of host-local record as window geometry and the
 * window-to-server binding, and it stays inside Desktop's closed persistence
 * allowlist: it carries profile ids, server ids, project ids, and view ids and
 * nothing else. Workspace snapshots, DTOs, project roots, and panel or
 * terminal state are never written here — the protocol parser rejects any
 * record that carries them.
 *
 * A profile that is unreachable at restore keeps its place in the record. The
 * renderer greys those tabs rather than dropping them, so the composition is
 * stable across a server being offline.
 */
export class DesktopWindowCompositionStore {
	private readonly compositions = new Map<
		string,
		TerminayWorkspaceComposition
	>();
	private loaded = false;

	constructor(private readonly filePath: string) {}

	read(key: string): TerminayWorkspaceComposition | undefined {
		this.load();
		return this.compositions.get(key);
	}

	write(key: string, composition: TerminayWorkspaceComposition): void {
		this.load();
		this.compositions.set(key, parseTerminayWorkspaceComposition(composition));
		this.persist();
	}

	private load(): void {
		if (this.loaded) return;
		this.loaded = true;
		let raw: unknown;
		try {
			raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
		} catch {
			// A missing or malformed presentation record is an empty one. It holds
			// no credentials and must never prevent a window from opening.
			return;
		}
		if (
			typeof raw !== 'object' ||
			raw === null ||
			Array.isArray(raw) ||
			(raw as { schemaVersion?: unknown }).schemaVersion !== 1
		)
			return;
		const windows = (raw as { windows?: unknown }).windows;
		if (typeof windows !== 'object' || windows === null || Array.isArray(windows))
			return;
		for (const [key, value] of Object.entries(
			windows as Record<string, unknown>,
		)) {
			if (!isCompositionKey(key)) continue;
			try {
				this.compositions.set(key, parseTerminayWorkspaceComposition(value));
			} catch {
				// One unclassified window record must not discard the others.
			}
		}
	}

	private persist(): void {
		const body = JSON.stringify({
			schemaVersion: 1,
			windows: Object.fromEntries(this.compositions),
		});
		mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
		const temporary = `${this.filePath}.${randomUUID()}.tmp`;
		writeFileSync(temporary, body, {
			encoding: 'utf8',
			mode: 0o600,
			flag: 'wx',
		});
		renameSync(temporary, this.filePath);
	}
}

const COMPOSITION_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

function isCompositionKey(value: string): boolean {
	return COMPOSITION_KEY.test(value);
}

/** A window's stable presentation identity: its primary profile, the workspace
 * view it shows, and which of the windows sharing that pair it is. Two Local
 * windows show the same profile and view, so without the slot they would share
 * one record and overwrite each other's attached set and tab order.
 *
 * BrowserWindow ids never appear here, so a record survives a restart: the
 * slot is the position among the windows holding that identity, and the first
 * such window keys exactly as a single window always did. */
export function desktopWindowCompositionKey(
	profileId: string,
	workspaceViewId?: string,
	windowSlot = 0,
): string {
	const identity = `${profileId}:${workspaceViewId ?? 'primary'}`;
	return windowSlot === 0 ? identity : `${identity}:w${windowSlot}`;
}
