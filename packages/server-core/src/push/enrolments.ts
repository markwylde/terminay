import {
	chmodSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { type PushEnrolment, parsePushEnrolment } from '@terminay/protocol';

/** Where a host keeps enrolments between runs. */
export interface PushEnrolmentPersistence {
	/** Records keyed by device id, or `undefined` when nothing is stored. */
	readonly load: () => Readonly<Record<string, unknown>> | undefined;
	readonly save: (records: Readonly<Record<string, PushEnrolment>>) => void;
}

/**
 * Each paired device's push enrolment with this server (ADR-0060): a routing
 * id, the key that seals its pushes, and the token the hosted push service
 * accepts. It never holds a push subscription. An enrolment belongs to a
 * device and ends when that device's trust does.
 */
export class PushEnrolmentStore {
	private readonly records = new Map<string, PushEnrolment>();

	constructor(private readonly persistence?: PushEnrolmentPersistence) {
		let stored: Readonly<Record<string, unknown>> | undefined;
		try {
			stored = persistence?.load();
		} catch {
			// An unreadable file is the same as no enrolments: every device
			// enrols again the next time its session connects.
			stored = undefined;
		}
		for (const [deviceId, value] of Object.entries(stored ?? {})) {
			try {
				this.records.set(deviceId, parsePushEnrolment(value));
			} catch {
				// One malformed record cannot cost the others.
			}
		}
	}

	get(deviceId: string): PushEnrolment | undefined {
		return this.records.get(deviceId);
	}

	deviceIds(): readonly string[] {
		return [...this.records.keys()];
	}

	set(deviceId: string, enrolment: PushEnrolment): void {
		const existing = this.records.get(deviceId);
		if (
			existing !== undefined &&
			existing.routingId === enrolment.routingId &&
			existing.key === enrolment.key &&
			existing.token === enrolment.token &&
			existing.silent === enrolment.silent
		)
			return;
		this.records.set(deviceId, enrolment);
		this.save();
	}

	remove(deviceId: string): boolean {
		if (!this.records.delete(deviceId)) return false;
		this.save();
		return true;
	}

	clear(): void {
		if (this.records.size === 0) return;
		this.records.clear();
		this.save();
	}

	private save(): void {
		try {
			this.persistence?.save(Object.fromEntries(this.records));
		} catch {
			// Push is best effort; a failed write must not fail the request that
			// caused it. The device enrols again when its session next connects.
		}
	}
}

/**
 * Keep enrolments in one owner-only file. The keys in it let their holder
 * raise banners on the paired devices, so it is written as the host key is:
 * readable by the server's own account and no one else.
 */
export function createFilePushEnrolmentPersistence(
	filePath: string,
): PushEnrolmentPersistence {
	return {
		load: () => {
			let text: string;
			try {
				text = readFileSync(filePath, 'utf8');
			} catch {
				return undefined;
			}
			const parsed: unknown = JSON.parse(text);
			if (
				typeof parsed !== 'object' ||
				parsed === null ||
				(parsed as { version?: unknown }).version !== 1
			)
				return undefined;
			const enrolments = (parsed as { enrolments?: unknown }).enrolments;
			return typeof enrolments === 'object' &&
				enrolments !== null &&
				!Array.isArray(enrolments)
				? (enrolments as Record<string, unknown>)
				: undefined;
		},
		save: (records) => {
			mkdirSync(dirname(filePath), { recursive: true });
			const temporary = `${filePath}.tmp`;
			writeFileSync(
				temporary,
				`${JSON.stringify({ version: 1, enrolments: records })}\n`,
				{ mode: 0o600 },
			);
			chmodSync(temporary, 0o600);
			renameSync(temporary, filePath);
		},
	};
}
