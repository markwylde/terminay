export const BOUNDED_LOAD_PROFILE = Object.freeze({
  sessionCount: 24,
  clientsPerSession: 4,
  outputEventsPerSession: 96,
  reconnectMissedEvents: 2,
  inputWritesPerSession: 12,
  resizesPerSession: 4,
  maxReplayBytes: 2 * 1024,
  maxQueuedOutputBytes: 256,
  // Four push clients plus one pull consumer fill the session exactly. The
  // probe deliberately attempts one further subscription below to verify the
  // admission limit fails without retaining any unbounded waiter.
  maxSubscribersPerSession: 5,
  outputChunkBytes: 48,
})

export async function runBoundedLoadProbe({ TerminalService, TerminalServiceAdapter }) {
  const profile = BOUNDED_LOAD_PROFILE
  const pty = createDeterministicPtyFleet()
  const counts = {
    adapterAttachOperations: 0,
    adapterDetachOperations: 0,
    clientOutputDeliveries: 0,
    inputWrites: 0,
    outputEvents: 0,
    outputBytes: 0,
    pullOutputEvents: 0,
    reconnects: 0,
    resizes: 0,
    sessionsCreated: 0,
    subscriberAdmissionRejections: 0,
    subscriptionCloseEvents: 0,
  }
  let maxLiveAttachments = 0
  let maxLiveSubscriptions = 0
  let maxQueuedOutputBytes = 0
  let maxRetainedReplayBytes = 0
  let exitEvents = 0

  const service = new TerminalService({
    serverId: 'task20-load-server',
    ptyFactory: pty,
    maxReplayBytes: profile.maxReplayBytes,
    maxQueuedOutputBytes: profile.maxQueuedOutputBytes,
    maxSubscribersPerSession: profile.maxSubscribersPerSession,
    onEvent(event) {
      if (event.type === 'output') {
        counts.outputEvents += 1
        counts.outputBytes += event.bytes.byteLength
      } else if (event.type === 'exit') {
        exitEvents += 1
      }
    },
  })
  const adapter = new TerminalServiceAdapter(service)
  const pullSubscriptions = []
  const attachments = []

  for (let sessionIndex = 0; sessionIndex < profile.sessionCount; sessionIndex += 1) {
    const identity = {
      serverId: 'task20-load-server',
      projectId: `project-${String(sessionIndex).padStart(2, '0')}`,
      sessionId: `session-${String(sessionIndex).padStart(2, '0')}`,
    }
    const session = await service.createSession({
      ...identity,
      cols: 120,
      rows: 40,
      shellPath: 'test-double-shell',
      createdAt: 1_000 + sessionIndex,
    })
    counts.sessionsCreated += 1

    const sessionAttachments = []
    for (let clientIndex = 0; clientIndex < profile.clientsPerSession; clientIndex += 1) {
      const clientId = `client-${String(sessionIndex).padStart(2, '0')}-${clientIndex}`
      const attachment = adapter.attach(
        {
          clientId,
          identity,
          authorization: { ...identity, clientId, scope: 'read' },
        },
        {
          onEvent(event) {
            if (event.type === 'output') counts.clientOutputDeliveries += 1
          },
          onClose() {
            counts.subscriptionCloseEvents += 1
          },
        },
      )
      counts.adapterAttachOperations += 1
      sessionAttachments.push({ clientId, attachment })
      attachments.push(attachment)
    }

    const pull = session.subscribe({
      authorization: { ...identity, clientId: `pull-${sessionIndex}`, scope: 'read' },
      maxQueuedBytes: profile.maxQueuedOutputBytes,
    })
    pullSubscriptions.push(pull)
    try {
      session.subscribe({
        authorization: { ...identity, clientId: `over-capacity-${sessionIndex}`, scope: 'read' },
        maxQueuedBytes: profile.maxQueuedOutputBytes,
      })
      throw new Error('terminal subscriber admission unexpectedly exceeded its configured bound')
    } catch (error) {
      if (error?.code !== 'subscriber_limit' || error?.details?.max !== profile.maxSubscribersPerSession) throw error
      counts.subscriberAdmissionRejections += 1
    }
    maxLiveAttachments = Math.max(maxLiveAttachments, adapter.size)
    maxLiveSubscriptions = Math.max(maxLiveSubscriptions, adapter.size + pullSubscriptions.length)

    for (let writeIndex = 0; writeIndex < profile.inputWritesPerSession; writeIndex += 1) {
      const clientId = `writer-${sessionIndex}-${writeIndex % profile.clientsPerSession}`
      await session.input(`input-${String(writeIndex).padStart(2, '0')}`, {
        ...identity,
        clientId,
        scope: 'write',
      })
      counts.inputWrites += 1
    }

    for (let resizeIndex = 0; resizeIndex < profile.resizesPerSession; resizeIndex += 1) {
      await session.resize({ cols: 120 + resizeIndex, rows: 40 + resizeIndex }, {
        ...identity,
        clientId: `writer-${sessionIndex}-${resizeIndex % profile.clientsPerSession}`,
        scope: 'write',
      })
      counts.resizes += 1
    }

    const process = pty.processes[sessionIndex]
    for (let eventIndex = 0; eventIndex < profile.outputEventsPerSession; eventIndex += 1) {
      if (eventIndex === 40) {
        const reconnecting = sessionAttachments[0]
        const cursor = reconnecting.attachment.position
        adapter.detach(reconnecting.attachment)
        counts.adapterDetachOperations += 1

        for (let missedIndex = 0; missedIndex < profile.reconnectMissedEvents; missedIndex += 1) {
          process.emit(outputPayload(sessionIndex, profile.outputEventsPerSession + missedIndex))
          recordBounds(service, session, pull, profile, (value) => {
            maxQueuedOutputBytes = Math.max(maxQueuedOutputBytes, value.queued)
            maxRetainedReplayBytes = Math.max(maxRetainedReplayBytes, value.retained)
          })
        }
        counts.pullOutputEvents += pull.drain().filter((event) => event.type === 'output').length

        const resumed = adapter.resume(
          {
            clientId: reconnecting.clientId,
            identity,
            authorization: { ...identity, clientId: reconnecting.clientId, scope: 'read' },
            fromPosition: cursor,
          },
          {
            onEvent(event) {
              if (event.type === 'output') counts.clientOutputDeliveries += 1
            },
            onClose() {
              counts.subscriptionCloseEvents += 1
            },
          },
        )
        counts.adapterAttachOperations += 1
        counts.reconnects += 1
        reconnecting.attachment = resumed
        attachments.push(resumed)
      }

      process.emit(outputPayload(sessionIndex, eventIndex))
      const bounds = recordBounds(service, session, pull, profile, (value) => {
        maxQueuedOutputBytes = Math.max(maxQueuedOutputBytes, value.queued)
        maxRetainedReplayBytes = Math.max(maxRetainedReplayBytes, value.retained)
      })
      if ((eventIndex + 1) % 4 === 0) {
        counts.pullOutputEvents += pull.drain().filter((event) => event.type === 'output').length
      }
      if (bounds.queued > profile.maxQueuedOutputBytes) {
        throw new Error('deterministic pull queue exceeded its configured bound')
      }
    }
  }

  for (const pull of pullSubscriptions) {
    counts.pullOutputEvents += pull.drain().filter((event) => event.type === 'output').length
    pull.close()
  }
  for (const attachment of [...attachments]) {
    if (!attachment.closed) {
      adapter.detach(attachment)
      counts.adapterDetachOperations += 1
    }
  }

  const shutdownEvents = await service.shutdown({ at: 10_000 })
  const result = {
    ...counts,
    exitEvents,
    maxLiveAttachments,
    maxLiveSubscriptions,
    maxQueuedOutputBytes,
    maxRetainedReplayBytes,
    ptysCreated: pty.processes.length,
    ptyWrites: pty.processes.reduce((total, process) => total + process.writes.length, 0),
    ptyResizes: pty.processes.reduce((total, process) => total + process.resizes.length, 0),
    activePtysAfterShutdown: pty.processes.filter((process) => !process.exited).length,
    serviceSessionsAfterShutdown: service.size,
    serviceStopped: service.stopped,
    shutdownExitEvents: shutdownEvents.length,
  }

  for (const process of pty.processes) {
    if (process.writes.length !== profile.inputWritesPerSession) throw new Error('PTY write count drifted')
    if (process.resizes.length !== profile.resizesPerSession) throw new Error('PTY resize count drifted')
  }
  return Object.freeze(result)
}

function createDeterministicPtyFleet() {
  const processes = []
  return {
    processes,
    spawn() {
      const dataListeners = new Set()
      const exitListeners = new Set()
      const process = {
        pid: 20_000 + processes.length,
        writes: [],
        resizes: [],
        exited: false,
        write(bytes) {
          process.writes.push(new Uint8Array(bytes))
        },
        resize(dimensions) {
          process.resizes.push({ ...dimensions })
        },
        kill(signal) {
          if (process.exited) return
          process.exit({ exitCode: 143, signal: typeof signal === 'number' ? signal : 15 })
        },
        onData(listener) {
          dataListeners.add(listener)
          return () => dataListeners.delete(listener)
        },
        onExit(listener) {
          exitListeners.add(listener)
          return () => exitListeners.delete(listener)
        },
        emit(value) {
          const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value)
          for (const listener of dataListeners) listener(new Uint8Array(bytes))
        },
        exit(value = {}) {
          if (process.exited) return
          process.exited = true
          for (const listener of exitListeners) listener(value)
        },
        dispose() {
          dataListeners.clear()
          exitListeners.clear()
        },
      }
      processes.push(process)
      return process
    },
  }
}

function outputPayload(sessionIndex, eventIndex) {
  return `${String(sessionIndex).padStart(2, '0')}:${String(eventIndex).padStart(3, '0')}:${'x'.repeat(41)}`
}

function recordBounds(service, session, pull, profile, observe) {
  const snapshot = service.getSession(session.identity)
  if (snapshot === undefined) throw new Error('session disappeared during deterministic probe')
  const value = {
    queued: pull.queuedBytes,
    retained: snapshot.outputPosition - snapshot.replayFrom,
  }
  observe(value)
  if (value.retained > profile.maxReplayBytes) throw new Error('replay buffer exceeded its configured bound')
  return value
}
