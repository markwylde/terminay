import {
  validateTransportFrame,
  type ByteTransport,
  type TransportCloseReason,
  type TransportState,
} from '@terminay/protocol'

export interface ServerMessagePort {
  onmessage: ((event: { readonly data: unknown }) => void) | null
  onmessageerror: (() => void) | null
  onclose?: (() => void) | null
  postMessage(message: unknown): void
  start?(): void
  close?(): void
}

type EventEmitterMessagePort = ServerMessagePort & {
  on?: (event: 'message' | 'messageerror' | 'close', listener: (event: unknown) => void) => unknown
}

interface ServerFramePacket {
  readonly type: 'terminay.server-frame'
  readonly version: 1
  readonly serverId: string
  readonly frame: Uint8Array
}

/** Fixed server scope carried over the private Desktop bootstrap port. */
export class ServerScopedMessagePort implements ServerMessagePort {
  private messageListener: ((event: { readonly data: unknown }) => void) | null = null
  private messageErrorListener: (() => void) | null = null
  private closeListener: (() => void) | null = null

  get onmessage(): ((event: { readonly data: unknown }) => void) | null {
    return this.messageListener
  }

  set onmessage(listener: ((event: { readonly data: unknown }) => void) | null) {
    this.messageListener = listener
  }

  get onmessageerror(): (() => void) | null {
    return this.messageErrorListener
  }

  set onmessageerror(listener: (() => void) | null) {
    this.messageErrorListener = listener
  }

  get onclose(): (() => void) | null {
    return this.closeListener
  }

  set onclose(listener: (() => void) | null) {
    this.closeListener = listener
  }

  constructor(private readonly port: ServerMessagePort, readonly serverId: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(serverId)) throw new TypeError('server id is invalid')
    const receive = (event: { readonly data: unknown }) => {
      const packet = event.data
      const frame = packetFrame(packet)
      if (frame === undefined || (packet as ServerFramePacket).serverId !== this.serverId) {
        this.messageErrorListener?.()
        return
      }
      this.messageListener?.({ data: frame })
    }
    const receiveError = () => this.messageErrorListener?.()
    const receiveClose = () => this.closeListener?.()
    // Renderer MessagePorts use DOM callbacks. Electron's MessagePortMain is
    // EventEmitter-based and silently ignores onmessage assignment, so bridge
    // it explicitly without changing the transport contract above it.
    const eventPort = port as EventEmitterMessagePort
    if (typeof eventPort.on === 'function') {
      eventPort.on('message', (event) => receive(normalizeMessageEvent(event)))
      eventPort.on('messageerror', receiveError)
      eventPort.on('close', receiveClose)
    } else {
      port.onmessage = receive
      port.onmessageerror = receiveError
      port.onclose = receiveClose
    }
  }

  postMessage(message: unknown): void {
    if (!(message instanceof Uint8Array) || message.byteLength === 0) throw new TypeError('server frame must be non-empty bytes')
    const packet: ServerFramePacket = Object.freeze({ type: 'terminay.server-frame', version: 1, serverId: this.serverId, frame: message.slice() })
    this.port.postMessage(packet)
  }

  start(): void { this.port.start?.() }
  close(): void { this.port.close?.() }
}

function normalizeMessageEvent(event: unknown): { readonly data: unknown } {
  if (typeof event === 'object' && event !== null && 'data' in event) {
    return event as { readonly data: unknown }
  }
  return { data: event }
}

/** Bounded framed ByteTransport shared by the privileged host and renderer. */
export class ServerPortTransport implements ByteTransport {
  private currentState: TransportState = 'opening'
  private readonly maxFrameBytes: number
  private readonly maxQueuedBytes: number
  private queued = 0
  private ended = false
  private readonly inbound: Uint8Array[] = []
  private readonly waiters: Array<{ resolve: (result: IteratorResult<Uint8Array>) => void; reject: (reason?: unknown) => void }> = []
  private readonly writableWaiters: Array<{ bytes: number; resolve: () => void; reject: (reason?: unknown) => void }> = []
  private readonly listeners = new Set<(state: TransportState, reason?: TransportCloseReason) => void>()

  constructor(private readonly port: ServerMessagePort, options: { readonly maxFrameBytes?: number; readonly maxQueuedBytes?: number } = {}) {
    this.maxFrameBytes = options.maxFrameBytes ?? 8 * 1024 * 1024
    this.maxQueuedBytes = options.maxQueuedBytes ?? 16 * 1024 * 1024
    if (!Number.isSafeInteger(this.maxFrameBytes) || this.maxFrameBytes <= 0) throw new RangeError('maxFrameBytes must be positive')
    if (!Number.isSafeInteger(this.maxQueuedBytes) || this.maxQueuedBytes <= 0) throw new RangeError('maxQueuedBytes must be positive')
    port.onmessage = (event) => this.receive(event.data)
    port.onmessageerror = () => this.fail({ code: 'unavailable', message: 'server message could not be decoded' })
    port.onclose = () => {
      if (this.currentState === 'opening' || this.currentState === 'open') {
        this.fail({ code: 'unavailable', message: 'server port closed' })
      }
    }
  }

  get state(): TransportState { return this.currentState }
  get queuedBytes(): number { return this.queued }
  get bufferedBytes(): number { return this.inbound.reduce((sum, value) => sum + value.byteLength, 0) }
  get incoming(): AsyncIterable<Uint8Array> {
    return { [Symbol.asyncIterator]: () => ({ next: () => this.next(), return: async () => { this.finish(); return { done: true, value: undefined } as IteratorResult<Uint8Array> } }) }
  }

  async open(): Promise<void> {
    if (this.currentState === 'open') return
    if (this.currentState !== 'opening') throw new Error(`server port is ${this.currentState}`)
    this.currentState = 'open'
    this.port.start?.()
    this.notify()
  }

  async send(frame: Uint8Array): Promise<void> {
    validateTransportFrame(frame, this.maxFrameBytes)
    if (this.currentState !== 'open') throw new Error(`server port is ${this.currentState}`)
    await this.waitForWritable(frame.byteLength)
    this.queued += frame.byteLength
    this.port.postMessage(frame.slice())
    queueMicrotask(() => { this.queued = Math.max(0, this.queued - frame.byteLength); this.notifyWritable() })
  }

  async waitForWritable(requiredBytes = 1): Promise<void> {
    if (!Number.isSafeInteger(requiredBytes) || requiredBytes <= 0 || requiredBytes > this.maxQueuedBytes) throw new RangeError('requiredBytes out of bounds')
    if (this.currentState !== 'open') throw new Error(`server port is ${this.currentState}`)
    if (this.queued + requiredBytes <= this.maxQueuedBytes) return
    await new Promise<void>((resolve, reject) => this.writableWaiters.push({ bytes: requiredBytes, resolve, reject }))
  }

  async close(reason: TransportCloseReason = { code: 'normal' }): Promise<void> {
    if (this.currentState === 'closed' || this.currentState === 'failed') return
    this.currentState = 'closing'
    this.notify(reason)
    this.finish(new Error(reason.message ?? 'server port closed'))
    this.port.close?.()
    this.currentState = 'closed'
    this.notify(reason)
    for (const waiter of this.writableWaiters.splice(0)) waiter.reject(new Error(reason.message ?? 'server port closed'))
  }

  onStateChange(listener: (state: TransportState, reason?: TransportCloseReason) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  fail(reason: TransportCloseReason = { code: 'internal', message: 'server port failed' }): void {
    if (this.currentState === 'closed' || this.currentState === 'failed') return
    this.currentState = 'failed'
    this.finish(new Error(reason.message ?? 'server port failed'))
    this.notify(reason)
  }

  private receive(value: unknown): void {
    const bytes = toUint8Array(value)
    if (this.currentState !== 'open' || bytes === undefined) {
      if (this.currentState === 'open') this.fail({ code: 'protocol_error', message: 'invalid server frame' })
      return
    }
    try { validateTransportFrame(bytes, this.maxFrameBytes) } catch { this.fail({ code: 'protocol_error', message: 'invalid server frame' }); return }
    const waiter = this.waiters.shift()
    if (waiter !== undefined) waiter.resolve({ done: false, value: bytes.slice() })
    else this.inbound.push(bytes.slice())
  }

  private next(): Promise<IteratorResult<Uint8Array>> {
    const value = this.inbound.shift()
    if (value !== undefined) return Promise.resolve({ done: false, value })
    if (this.ended) return Promise.resolve({ done: true, value: undefined } as IteratorResult<Uint8Array>)
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }))
  }

  private finish(error?: Error): void {
    if (this.ended) return
    this.ended = true
    for (const waiter of this.waiters.splice(0)) error === undefined ? waiter.resolve({ done: true, value: undefined } as IteratorResult<Uint8Array>) : waiter.reject(error)
  }

  private notify(reason?: TransportCloseReason): void { for (const listener of this.listeners) listener(this.currentState, reason) }
  private notifyWritable(): void { for (const waiter of [...this.writableWaiters]) if (this.queued + waiter.bytes <= this.maxQueuedBytes) { this.writableWaiters.splice(this.writableWaiters.indexOf(waiter), 1); waiter.resolve() } }
}

function packetFrame(value: unknown): Uint8Array | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const packet = value as Record<string, unknown>
  if (packet.type !== 'terminay.server-frame' || packet.version !== 1 || typeof packet.serverId !== 'string') return undefined
  const frame = toUint8Array(packet.frame)
  return frame === undefined || frame.byteLength === 0 ? undefined : frame.slice()
}

/** Context-isolated Electron renderers use different JS realms, so
 * `instanceof Uint8Array` is not a safe protocol boundary check. */
function toUint8Array(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (!ArrayBuffer.isView(value)) return undefined
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
}
