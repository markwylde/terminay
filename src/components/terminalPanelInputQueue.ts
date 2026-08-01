import type { TerminalPanelAttachment } from '@terminay/client-core'

export const MAX_PANEL_INPUT_QUEUE_BYTES = 64 * 1024

interface QueuedServerTerminalInput {
	readonly data: string
	readonly byteLength: number
}

/**
 * Serializes writes for one server-backed panel. The attachment transport is
 * asynchronous, so issuing writes directly from xterm's onData handler can
 * let later input overtake an earlier write. Keep the queue bounded by the
 * encoded byte length and invalidate it when the panel's attachment lifecycle
 * ends.
 */
export class ServerTerminalInputQueue {
	private readonly encoder = new TextEncoder()
	private readonly items: QueuedServerTerminalInput[] = []
	private attachment: TerminalPanelAttachment | null = null
	private queuedBytes = 0
	private attachmentGeneration = 0
	private pumping = false
	private closed = false

	constructor(private readonly onError: (error: unknown) => void) {}

	enqueue(data: string): void {
		if (this.closed) {
			return
		}

		const byteLength = this.encoder.encode(data).byteLength
		if (this.queuedBytes + byteLength > MAX_PANEL_INPUT_QUEUE_BYTES) {
			return
		}

		this.items.push({ data, byteLength })
		this.queuedBytes += byteLength
		void this.pump()
	}

	attach(attachment: TerminalPanelAttachment): void {
		if (this.closed) {
			void attachment.detach().catch(() => {})
			return
		}

		this.attachment = attachment
		this.attachmentGeneration += 1
		void this.pump()
	}

	close(): void {
		this.closed = true
		this.attachmentGeneration += 1
		this.attachment = null
		this.items.length = 0
		this.queuedBytes = 0
	}

	private async pump(): Promise<void> {
		if (this.pumping || this.closed) {
			return
		}

		this.pumping = true
		try {
			while (!this.closed && this.items.length > 0) {
				const attachment = this.attachment
				if (attachment === null) {
					return
				}

				const generation = this.attachmentGeneration
				const item = this.items[0]
				if (!item) {
					return
				}

				// The lifecycle check immediately before the write prevents a
				// resolved attach promise from using an attachment after cleanup.
				if (this.closed || this.attachment !== attachment || this.attachmentGeneration !== generation) {
					return
				}

				try {
					await attachment.write(item.data)
				} catch (error) {
					if (!this.closed && this.attachment === attachment && this.attachmentGeneration === generation) {
						// A failed terminal write has an unknown delivery outcome. Do not
						// send later input and risk changing shell command order.
						this.close()
						this.onError(error)
					}
				} finally {
					if (this.items[0] === item) {
						this.items.shift()
					this.queuedBytes = Math.max(0, this.queuedBytes - item.byteLength)
					}
				}
			}
		} finally {
			this.pumping = false
			if (!this.closed && this.items.length > 0 && this.attachment !== null) {
				void this.pump()
			}
		}
	}
}
