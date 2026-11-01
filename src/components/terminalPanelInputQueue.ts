import type { TerminalPanelAttachment } from '@terminay/client-core'

export const MAX_PANEL_INPUT_QUEUE_BYTES = 64 * 1024
export const MAX_PANEL_PASTE_CHUNK_BYTES = 16 * 1024
export const MAX_PANEL_PENDING_PASTE_BYTES = 16 * 1024 * 1024

export interface TerminalInputNotice {
	readonly kind: 'overflow' | 'unknown_outcome'
	readonly message: string
	readonly canContinue: boolean
}

interface QueuedServerTerminalInput {
	readonly data: string | Uint8Array
	readonly byteLength: number
}

interface QueuedServerTerminalPaste {
	readonly data: string
	readonly totalBytes: number
	readonly onProgress: (progress: TerminalPasteProgress) => void
	offset: number
	sentBytes: number
	cancelled: boolean
	released: boolean
}

type QueuedServerTerminalInputItem =
	| QueuedServerTerminalInput
	| QueuedServerTerminalPaste

export interface TerminalPasteProgress {
	readonly completedBytes: number
	readonly status: 'cancelled' | 'complete' | 'in_progress'
	readonly totalBytes: number
}

export type TerminalPasteChunkScheduler = () => Promise<void>

/**
 * Whether the panel's own attachment may write to the PTY. `pending` is the
 * state of a panel whose attachment is being established or replaced: it has
 * not yet been told whether it holds the interactive presentation lease, so
 * what the user types is held rather than sent or refused.
 */
export type TerminalInputPresentationRole = 'controller' | 'pending' | 'read_only'

/**
 * Serializes writes for one server-backed panel. The attachment transport is
 * asynchronous, so issuing writes directly from xterm's onData handler can
 * let later input overtake an earlier write. Keep the queue bounded by the
 * encoded byte length.
 *
 * The queue belongs to the mounted panel, not to one attachment. Replacing the
 * panel's attachment (congestion recovery, a refused resume, a rebind onto a
 * replacement connection) is a `handoff`: input already queued, and input
 * typed while the replacement is attaching, is held and then delivered in
 * order, once, by the replacement when it holds the presentation. Unknown delivery outcomes discard successors; overflow pauses admission
 * with a visible notice. A read-only presentation refuses input. Transport
 * failure or disposal closes the queue.
 */
export class ServerTerminalInputQueue {
	private readonly encoder = new TextEncoder()
	private readonly items: QueuedServerTerminalInputItem[] = []
	private attachment: TerminalPanelAttachment | null = null
	// The panel applies each attachment's presentation before it attaches that
	// attachment here, so a queue that is never told otherwise writes to what
	// it is attached to.
	private role: TerminalInputPresentationRole = 'controller'
	private queuedBytes = 0
	private retainedPasteBytes = 0
	private activeItem: QueuedServerTerminalInputItem | null = null
	private overflowPaused = false
	private waitingForHydration = false
	private notice: Omit<TerminalInputNotice, 'canContinue'> | null = null
	private attachmentGeneration = 0
	private pumping = false
	private closed = false

	constructor(
		private readonly onError: (error: unknown) => void,
		private readonly waitForNextPasteChunk: TerminalPasteChunkScheduler =
			async () => {},
		private readonly onNotice: (notice: TerminalInputNotice) => void = () => {},
	) {}

	get isClosed(): boolean {
		return this.closed
	}

	/** Returns whether the input was accepted for delivery. */
	enqueue(data: string | Uint8Array): boolean {
		if (this.closed || this.role === 'read_only' || this.overflowPaused || this.waitingForHydration) {
			return false
		}

		const byteLength = typeof data === 'string'
			? this.encoder.encode(data).byteLength
			: data.byteLength
		if (this.queuedBytes + byteLength > MAX_PANEL_INPUT_QUEUE_BYTES) {
			this.interruptOverflow()
			return false
		}

		this.items.push({
			data: typeof data === 'string' ? data : new Uint8Array(data),
			byteLength,
		})
		this.queuedBytes += byteLength
		void this.pump()
		return true
	}

	/**
	 * A clipboard paste can be much larger than one bounded terminal-input
	 * frame. Keep only its next frame in flight while preserving its position
	 * ahead of later keyboard input, so the PTY observes one ordered stream.
	 */
	enqueuePaste(
		data: string,
		onProgress: (progress: TerminalPasteProgress) => void,
	): void {
		if (this.closed || this.role === 'read_only' || this.overflowPaused || this.waitingForHydration || data.length === 0) return
		// UTF-8 uses at least as many bytes as UTF-16 code units. Refuse an
		// oversized string before allocating its encoded copy.
		if (data.length > MAX_PANEL_PENDING_PASTE_BYTES - this.retainedPasteBytes) {
			this.interruptOverflow()
			return
		}

		const totalBytes = this.encoder.encode(data).byteLength
		if (totalBytes <= MAX_PANEL_INPUT_QUEUE_BYTES) {
			this.enqueue(data)
			return
		}
		if (this.retainedPasteBytes + totalBytes > MAX_PANEL_PENDING_PASTE_BYTES) {
			this.interruptOverflow()
			return
		}
		const item: QueuedServerTerminalPaste = {
			data,
			offset: 0,
			onProgress,
			sentBytes: 0,
			totalBytes,
			cancelled: false,
			released: false,
		}
		this.retainedPasteBytes += totalBytes
		this.items.push(item)
		onProgress({
			completedBytes: 0,
			status: 'in_progress',
			totalBytes,
		})
		void this.pump()
	}

	attach(attachment: TerminalPanelAttachment): void {
		if (this.closed) {
			void attachment.detach().catch(() => {})
			return
		}

		this.attachment = attachment
		this.attachmentGeneration += 1
		this.resumeAfterHydration()
		void this.pump()
	}

	/**
	 * The panel's attachment is being replaced. Stop writing to the old one
	 * but keep everything not yet sent; it goes to the replacement once that
	 * is attached and holds the presentation. A write already in flight on the
	 * old attachment settles there first, so nothing overtakes it.
	 */
	handoff(): void {
		if (this.closed) return
		this.attachment = null
		this.attachmentGeneration += 1
		this.role = 'pending'
		this.publishNotice()
	}

	/**
	 * Apply the presentation the server reported for the panel's current
	 * attachment. A controller delivers what is queued; a read-only observer
	 * may not write, so queued input is discarded and new input refused, which
	 * the observer's control bar makes visible.
	 */
	setPresentationRole(role: 'controller' | 'read_only'): void {
		if (this.closed) return
		this.role = role
		this.resumeAfterHydration()
		if (role === 'read_only') {
			this.discardItems()
			this.queuedBytes = 0
			return
		}
		void this.pump()
	}

	close(): void {
		this.closed = true
		this.attachmentGeneration += 1
		this.attachment = null
		this.discardItems()
		this.queuedBytes = 0
	}

	discardPending(): void {
		if (this.closed) return
		this.attachmentGeneration += 1
		this.discardItems()
		this.queuedBytes = 0
	}

	/** Overflow does not interrupt output or replace a healthy attachment. */
	resumeInput(): boolean {
		if (this.closed || this.attachment === null || this.role !== 'controller' || this.waitingForHydration) return false
		this.overflowPaused = false
		this.notice = null
		void this.pump()
		return true
	}

	/**
	 * Stops the unsent portion of the active clipboard paste without throwing
	 * away keyboard input that was queued after it. A write already handed to
	 * the attachment may still reach the PTY, but no later paste chunk is sent.
	 */
	cancelPaste(): void {
		if (this.closed) return
		const index = this.items.findIndex(isQueuedPaste)
		if (index === -1) return
		const [item] = this.items.splice(index, 1)
		if (!item || !isQueuedPaste(item)) return
		item.cancelled = true
		this.releasePaste(item)
		item.onProgress({
			completedBytes: item.sentBytes,
			status: 'cancelled',
			totalBytes: item.totalBytes,
		})
	}

	private async pump(): Promise<void> {
		if (this.pumping || this.closed || this.overflowPaused || this.waitingForHydration) {
			return
		}

		this.pumping = true
		try {
			while (!this.closed && this.items.length > 0) {
				const attachment = this.attachment
				if (attachment === null || this.role !== 'controller' || this.overflowPaused || this.waitingForHydration) {
					return
				}

				const generation = this.attachmentGeneration
				const item = this.items[0]
				if (!item) {
					return
				}
				const chunk = isQueuedPaste(item)
					? takePasteChunk(item)
					: { data: item.data, byteLength: item.byteLength, nextOffset: null }

				// The lifecycle check immediately before the write prevents a
				// resolved attach promise from using an attachment after cleanup.
				if (this.closed || this.attachment !== attachment || this.attachmentGeneration !== generation) {
					return
				}

				let delivered = false
				this.activeItem = item
				try {
					await attachment.write(chunk.data)
					delivered = true
				} catch (error) {
					if (this.closed) return
					if (this.attachment === attachment && this.attachmentGeneration === generation) {
						if (isTerminalPresentationOwnershipError(error)) {
							// The server definitively rejected this write before PTY delivery
							// because control changed after it was queued. This is normal
							// read-only state, not a transport failure.
							this.discardPending()
							continue
						}
						// A failed terminal write has an unknown delivery outcome. Do not
						// send later input and risk changing shell command order.
						this.close()
						this.onError(error)
					} else if (isOutcomeUnknownWriteError(error)) {
						// Hydrating a replacement cannot tell us whether the old write
						// reached the PTY. Its successors could complete a different
						// command, so none are sent. Keep healthy output streaming.
						this.waitingForHydration = true
						this.overflowPaused = false
						this.discardPending()
						this.resumeAfterHydration()
						this.notice = { kind: 'unknown_outcome', message: 'Some input was not sent after the connection was interrupted. Check the command before continuing.' }
						this.publishNotice()
					}
					// Otherwise the replaced attachment definitively refused the write
					// before it reached the PTY. It stays first in line and is sent,
					// once, by the replacement.
				} finally {
					this.activeItem = null
					if (isQueuedPaste(item) && item.cancelled) this.releasePaste(item)
				}
				if (!delivered || this.items[0] !== item) continue

				if (isQueuedPaste(item)) {
					if (chunk.nextOffset === null) continue
					item.offset = chunk.nextOffset
					item.sentBytes += chunk.byteLength
					const complete = item.offset >= item.data.length
					item.onProgress({
						completedBytes: item.sentBytes,
						status: complete ? 'complete' : 'in_progress',
						totalBytes: item.totalBytes,
					})
					if (complete) {
						this.items.shift()
						this.releasePaste(item)
					} else {
						// Yield after each delivered frame so the renderer can paint the
						// newly reported percentage before more input is buffered. Without
						// this, a local PTY can accept an entire paste in one task and make
						// the progress UI appear frozen at its initial value.
						await this.waitForNextPasteChunk()
					}
				} else {
					this.items.shift()
					this.queuedBytes = Math.max(0, this.queuedBytes - item.byteLength)
				}
			}
		} finally {
			this.pumping = false
			if (
				!this.closed &&
				!this.overflowPaused &&
				!this.waitingForHydration &&
				this.items.length > 0 &&
				this.attachment !== null &&
				this.role === 'controller'
			) {
				void this.pump()
			}
		}
	}

	private discardItems(): void {
		for (const item of this.items) {
			if (!isQueuedPaste(item)) continue
			item.cancelled = true
			this.releasePaste(item)
			item.onProgress({
				completedBytes: item.sentBytes,
				status: 'cancelled',
				totalBytes: item.totalBytes,
			})
		}
		this.items.length = 0
	}

	private releasePaste(item: QueuedServerTerminalPaste): void {
		if (item.released || this.activeItem === item) return
		item.released = true
		this.retainedPasteBytes = Math.max(0, this.retainedPasteBytes - item.totalBytes)
	}

	private resumeAfterHydration(): void {
		if (this.attachment !== null && this.role === 'controller') this.waitingForHydration = false
		this.publishNotice()
	}

	private publishNotice(): void {
		if (this.notice) this.onNotice({ ...this.notice, canContinue: !this.closed && this.attachment !== null && this.role === 'controller' && !this.waitingForHydration })
	}

	private interruptOverflow(): void {
		this.overflowPaused = true
		// Admission failure does not replace the attachment. A write already
		// in flight must still report a real current-attachment failure.
		this.discardItems()
		this.queuedBytes = 0
		this.notice = { kind: 'overflow', message: 'Input paused because delivery could not keep up. Pending input was not sent. Check the command before continuing.' }
		this.publishNotice()
	}
}

function isQueuedPaste(
	item: QueuedServerTerminalInputItem,
): item is QueuedServerTerminalPaste {
	return 'totalBytes' in item
}

function takePasteChunk(item: QueuedServerTerminalPaste): {
	readonly byteLength: number
	readonly data: string
	readonly nextOffset: number
} {
	let byteLength = 0
	let nextOffset = item.offset
	while (nextOffset < item.data.length) {
		const codePoint = item.data.codePointAt(nextOffset)
		if (codePoint === undefined) break
		const characterBytes = utf8CodePointBytes(codePoint)
		if (byteLength + characterBytes > MAX_PANEL_PASTE_CHUNK_BYTES) break
		byteLength += characterBytes
		nextOffset += codePoint > 0xffff ? 2 : 1
	}

	return {
		byteLength,
		data: item.data.slice(item.offset, nextOffset),
		nextOffset,
	}
}

function utf8CodePointBytes(codePoint: number): number {
	if (codePoint <= 0x7f) return 1
	if (codePoint <= 0x7ff) return 2
	if (codePoint <= 0xffff) return 3
	return 4
}

/**
 * A write whose result never came back: the transport went away after it was
 * sent, or the reply could not be read. It may have reached the PTY.
 */
function isOutcomeUnknownWriteError(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) return false
	const code = (error as { code?: unknown }).code
	return code === 'unknown_command_outcome' || code === 'invalid_response'
}

export function isTerminalPresentationOwnershipError(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) return false
	const candidate = error as { code?: unknown; details?: unknown }
	if (candidate.code !== 'forbidden' || typeof candidate.details !== 'object' || candidate.details === null) return false
	return (candidate.details as { reason?: unknown }).reason === 'presentation_owner'
}
