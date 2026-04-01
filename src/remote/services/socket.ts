import type { RemoteClientMessage, RemoteServerMessage } from '../protocol'

type OutboundClientMessage =
  | Omit<Extract<RemoteClientMessage, { type: 'list-sessions' }>, 'connectionId' | 'seq'>
  | Omit<Extract<RemoteClientMessage, { type: 'attach-session' }>, 'connectionId' | 'seq'>
  | Omit<Extract<RemoteClientMessage, { type: 'detach-session' }>, 'connectionId' | 'seq'>
  | Omit<Extract<RemoteClientMessage, { type: 'write' }>, 'connectionId' | 'seq'>
  | Omit<Extract<RemoteClientMessage, { type: 'resize' }>, 'connectionId' | 'seq'>
  | Omit<Extract<RemoteClientMessage, { type: 'ping' }>, 'connectionId' | 'seq'>

export class RemoteSocket {
  private connectionId = ''
  private sequence = 0
  private socket: WebSocket | null = null
  private hasHandshake = false

  constructor(
    private readonly websocketUrl: string,
    private readonly onMessage: (message: RemoteServerMessage) => void,
    private readonly onStateChange: (state: 'connecting' | 'live' | 'closed') => void,
  ) {}

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      this.connectionId = ''
      this.sequence = 0
      this.hasHandshake = false
      const socket = new WebSocket(this.websocketUrl)
      this.socket = socket
      this.onStateChange('connecting')

      socket.addEventListener('open', () => {
        // Wait for the server's first session-list so outbound messages
        // always carry the negotiated connection identity.
      })

      socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data) as RemoteServerMessage
        if (message.type === 'session-list') {
          this.connectionId = message.connectionId
          if (!this.hasHandshake) {
            this.hasHandshake = true
            if (!settled) {
              settled = true
              this.onStateChange('live')
              resolve()
            }
          }
        }
        this.onMessage(message)
      })

      socket.addEventListener('close', () => {
        if (!settled) {
          settled = true
          reject(new Error('WebSocket connection closed before initialization completed.'))
        }
        this.hasHandshake = false
        this.connectionId = ''
        this.onStateChange('closed')
      })

      socket.addEventListener('error', () => {
        if (!settled) {
          settled = true
          reject(new Error('WebSocket connection failed.'))
        }
      })
    })
  }

  close(): void {
    this.socket?.close()
    this.socket = null
  }

  send(message: OutboundClientMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.hasHandshake || !this.connectionId) {
      throw new Error('The remote connection is not open.')
    }

    this.sequence += 1
    this.socket.send(
      JSON.stringify({
        ...message,
        connectionId: this.connectionId,
        seq: this.sequence,
      }),
    )
  }
}
