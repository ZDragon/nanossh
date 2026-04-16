import { createServer, createConnection, type Server, type Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import {
  IpcChannels,
  type CreateForwardInput,
  type ForwardRule
} from '../../shared/types'
import { getSessionManager, type SessionManager } from './SessionManager'
import type { SshSession } from './SshSession'

interface LocalState {
  rule: ForwardRule
  server: Server
}

interface RemoteState {
  rule: ForwardRule
  /** Exact bind values used with the server (after forwardIn resolves the port). */
  remoteBind: string
  remotePort: number
}

interface SessionRouter {
  /** Unsubscribe for the shared tcp-connection listener on SshSession. */
  unsubscribe: () => void
  /** Keyed by `destIP|destPort` — the values the server will announce. */
  routes: Map<string, RemoteState>
}

/**
 * Tracks all port-forward rules across sessions.
 *
 * - **Local (-L)**: we open a TCP listener in the Electron process, then for
 *   every inbound socket open a forwarded-tcpip channel on the SSH client and
 *   pipe the two together.
 * - **Remote (-R)**: we ask the server to listen on `bindHost:bindPort`; when
 *   it accepts a connection, we connect locally to `destHost:destPort` and
 *   pipe.
 * - **Dynamic (-D)**: a local SOCKS5 server; every accepted client performs a
 *   SOCKS5 handshake and we `forwardOut` to the requested host:port. Only
 *   CONNECT (command 0x01) is supported. IPv4 + domain address types only
 *   (IPv6 rejected for now).
 */
export class PortForwardManager {
  private readonly local = new Map<string, LocalState>()
  private readonly remote = new Map<string, RemoteState>()
  private readonly routersBySession = new Map<string, SessionRouter>()
  private sender: WebContents | null = null

  attachSender(s: WebContents): void {
    this.sender = s
  }

  list(): ForwardRule[] {
    return [
      ...[...this.local.values()].map((s) => ({ ...s.rule })),
      ...[...this.remote.values()].map((s) => ({ ...s.rule }))
    ]
  }

  async start(mgr: SessionManager, input: CreateForwardInput): Promise<string> {
    const session = mgr.get(input.sessionId)
    if (input.kind === 'local') return this.startLocal(session, input)
    if (input.kind === 'remote') return this.startRemote(session, input)
    if (input.kind === 'dynamic') return this.startDynamic(session, input)
    throw new Error(`Unknown forward kind: ${input.kind}`)
  }

  async stop(id: string): Promise<void> {
    const l = this.local.get(id)
    if (l) {
      l.rule.status = 'stopped'
      this.broadcast(l.rule)
      await new Promise<void>((resolve) => l.server.close(() => resolve()))
      this.local.delete(id)
      return
    }
    const r = this.remote.get(id)
    if (r) {
      r.rule.status = 'stopped'
      this.broadcast(r.rule)
      const session = this.getSessionSafe(r.rule.sessionId)
      if (session) {
        try {
          await session.unforwardIn(r.remoteBind, r.remotePort)
        } catch {
          /* server may have already gone away */
        }
      }
      this.removeRemoteRoute(r.rule.sessionId, r.remoteBind, r.remotePort)
      this.remote.delete(id)
    }
  }

  async stopForSession(sessionId: string): Promise<void> {
    const ids = [
      ...[...this.local.values()].filter((s) => s.rule.sessionId === sessionId).map((s) => s.rule.id),
      ...[...this.remote.values()].filter((s) => s.rule.sessionId === sessionId).map((s) => s.rule.id)
    ]
    await Promise.all(ids.map((id) => this.stop(id).catch(() => undefined)))
    // drop any leftover router
    const router = this.routersBySession.get(sessionId)
    if (router) {
      router.unsubscribe()
      this.routersBySession.delete(sessionId)
    }
  }

  async stopAll(): Promise<void> {
    const ids = [
      ...[...this.local.keys()],
      ...[...this.remote.keys()]
    ]
    await Promise.all(ids.map((id) => this.stop(id).catch(() => undefined)))
    for (const r of this.routersBySession.values()) r.unsubscribe()
    this.routersBySession.clear()
  }

  // ────────────────────────────────────────────────────────────────
  // LOCAL (-L)
  // ────────────────────────────────────────────────────────────────

  private startLocal(session: SshSession, input: CreateForwardInput): Promise<string> {
    if (!input.destHost || input.destPort === undefined) {
      return Promise.reject(new Error('Local forward requires destHost and destPort'))
    }

    const rule: ForwardRule = {
      id: randomUUID(),
      sessionId: input.sessionId,
      kind: 'local',
      label: input.label,
      bindHost: input.bindHost || '127.0.0.1',
      bindPort: input.bindPort,
      destHost: input.destHost,
      destPort: input.destPort,
      status: 'starting',
      connections: 0,
      bytesIn: 0,
      bytesOut: 0,
      startedAt: Date.now()
    }

    const server = createServer((socket) => {
      rule.connections += 1
      this.broadcast(rule)
      session
        .forwardOut(
          socket.remoteAddress || '127.0.0.1',
          socket.remotePort || 0,
          rule.destHost!,
          rule.destPort!
        )
        .then((stream) => {
          this.pipeWithCounters(socket, stream, rule)
        })
        .catch((err) => {
          socket.destroy()
          rule.error = `forwardOut failed: ${String(err)}`
          this.broadcast(rule)
        })
    })

    server.on('error', (err) => {
      rule.status = 'error'
      rule.error = String(err)
      this.broadcast(rule)
    })

    const state: LocalState = { rule, server }
    this.local.set(rule.id, state)

    return new Promise<string>((resolve, reject) => {
      server.once('listening', () => {
        rule.status = 'active'
        this.broadcast(rule)
        resolve(rule.id)
      })
      server.once('error', (err) => {
        this.local.delete(rule.id)
        reject(err)
      })
      server.listen(rule.bindPort, rule.bindHost)
    })
  }

  // ────────────────────────────────────────────────────────────────
  // REMOTE (-R)
  // ────────────────────────────────────────────────────────────────

  private async startRemote(
    session: SshSession,
    input: CreateForwardInput
  ): Promise<string> {
    if (!input.destHost || input.destPort === undefined) {
      throw new Error('Remote forward requires destHost and destPort (local target)')
    }

    const rule: ForwardRule = {
      id: randomUUID(),
      sessionId: input.sessionId,
      kind: 'remote',
      label: input.label,
      bindHost: input.bindHost || '127.0.0.1',
      bindPort: input.bindPort,
      destHost: input.destHost,
      destPort: input.destPort,
      status: 'starting',
      connections: 0,
      bytesIn: 0,
      bytesOut: 0,
      startedAt: Date.now()
    }

    this.ensureRouter(session, input.sessionId)

    try {
      const actualPort = await session.forwardIn(rule.bindHost, rule.bindPort)
      const state: RemoteState = {
        rule,
        remoteBind: rule.bindHost,
        remotePort: actualPort
      }
      rule.bindPort = actualPort // update in case user passed 0 (any port)
      const router = this.routersBySession.get(input.sessionId)!
      router.routes.set(routeKey(rule.bindHost, actualPort), state)
      this.remote.set(rule.id, state)
      rule.status = 'active'
      this.broadcast(rule)
      return rule.id
    } catch (e) {
      rule.status = 'error'
      rule.error = String(e)
      this.broadcast(rule)
      throw e
    }
  }

  private ensureRouter(session: SshSession, sessionId: string): void {
    if (this.routersBySession.has(sessionId)) return
    const routes = new Map<string, RemoteState>()
    const unsubscribe = session.onTcpConnection((info, accept, reject) => {
      const key = routeKey(info.destIP, info.destPort)
      const state = routes.get(key)
      if (!state) {
        reject()
        return
      }
      state.rule.connections += 1
      this.broadcast(state.rule)

      const stream = accept()
      const sock: Socket = createConnection({
        host: state.rule.destHost!,
        port: state.rule.destPort!
      })
      sock.on('error', () => {
        try {
          stream.end()
        } catch {
          /* ignore */
        }
      })
      stream.on('error', () => sock.destroy())
      this.pipeWithCounters(sock, stream, state.rule, { swap: true })
    })
    this.routersBySession.set(sessionId, { unsubscribe, routes })
  }

  private removeRemoteRoute(sessionId: string, bind: string, port: number): void {
    const router = this.routersBySession.get(sessionId)
    if (!router) return
    router.routes.delete(routeKey(bind, port))
    if (router.routes.size === 0) {
      router.unsubscribe()
      this.routersBySession.delete(sessionId)
    }
  }

  // ────────────────────────────────────────────────────────────────
  // DYNAMIC (-D, SOCKS5 CONNECT)
  // ────────────────────────────────────────────────────────────────

  private startDynamic(session: SshSession, input: CreateForwardInput): Promise<string> {
    const rule: ForwardRule = {
      id: randomUUID(),
      sessionId: input.sessionId,
      kind: 'dynamic',
      label: input.label,
      bindHost: input.bindHost || '127.0.0.1',
      bindPort: input.bindPort,
      status: 'starting',
      connections: 0,
      bytesIn: 0,
      bytesOut: 0,
      startedAt: Date.now()
    }

    const server = createServer((socket) => this.handleSocks5(socket, session, rule))

    server.on('error', (err) => {
      rule.status = 'error'
      rule.error = String(err)
      this.broadcast(rule)
    })

    const state: LocalState = { rule, server }
    this.local.set(rule.id, state)

    return new Promise<string>((resolve, reject) => {
      server.once('listening', () => {
        rule.status = 'active'
        this.broadcast(rule)
        resolve(rule.id)
      })
      server.once('error', (err) => {
        this.local.delete(rule.id)
        reject(err)
      })
      server.listen(rule.bindPort, rule.bindHost)
    })
  }

  private handleSocks5(socket: Socket, session: SshSession, rule: ForwardRule): void {
    rule.connections += 1
    this.broadcast(rule)

    let phase: 'greeting' | 'request' | 'streaming' = 'greeting'
    let buffer = Buffer.alloc(0)

    socket.on('error', () => undefined)

    socket.on('data', (chunk) => {
      if (phase === 'streaming') return
      buffer = Buffer.concat([buffer, chunk])

      if (phase === 'greeting') {
        if (buffer.length < 2) return
        if (buffer[0] !== 0x05) {
          socket.destroy()
          return
        }
        const nMethods = buffer[1]
        if (buffer.length < 2 + nMethods) return
        // respond: SOCKS5, NO AUTH
        socket.write(Buffer.from([0x05, 0x00]))
        buffer = buffer.subarray(2 + nMethods)
        phase = 'request'
      }

      if (phase === 'request') {
        if (buffer.length < 4) return
        if (buffer[0] !== 0x05) {
          socket.destroy()
          return
        }
        const cmd = buffer[1]
        if (cmd !== 0x01) {
          // 0x07 = Command not supported
          socket.end(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
          return
        }
        const atyp = buffer[3]
        let addr: string
        let addrLen: number
        if (atyp === 0x01) {
          // IPv4
          if (buffer.length < 4 + 4 + 2) return
          addr = `${buffer[4]}.${buffer[5]}.${buffer[6]}.${buffer[7]}`
          addrLen = 4
        } else if (atyp === 0x03) {
          // domain
          if (buffer.length < 5) return
          const dLen = buffer[4]
          if (buffer.length < 5 + dLen + 2) return
          addr = buffer.subarray(5, 5 + dLen).toString('utf8')
          addrLen = 1 + dLen
        } else {
          // IPv6 not supported
          socket.end(Buffer.from([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
          return
        }
        const portOffset = 4 + addrLen
        const port = buffer.readUInt16BE(portOffset)

        session
          .forwardOut(socket.remoteAddress || '127.0.0.1', socket.remotePort || 0, addr, port)
          .then((stream) => {
            // Success reply
            socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
            phase = 'streaming'
            this.pipeWithCounters(socket, stream, rule)
          })
          .catch(() => {
            // General failure
            try {
              socket.end(Buffer.from([0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
            } catch {
              /* ignore */
            }
          })
      }
    })
  }

  // ────────────────────────────────────────────────────────────────

  private pipeWithCounters(
    a: Socket,
    b: NodeJS.ReadWriteStream,
    rule: ForwardRule,
    opts: { swap?: boolean } = {}
  ): void {
    // For local/dynamic: a = client socket, b = ssh stream. Upload = a→b, download = b→a.
    // For remote (swap): a = local target socket, b = ssh stream. From the user's POV the
    // remote initiator uploads to us, so b→a is "upload through tunnel", a→b is "download".
    const { swap = false } = opts
    a.on('data', (d) => {
      if (swap) rule.bytesIn += d.length
      else rule.bytesOut += d.length
    })
    b.on('data', (d: Buffer) => {
      if (swap) rule.bytesOut += d.length
      else rule.bytesIn += d.length
    })
    const cleanup = (): void => this.broadcast(rule)
    a.on('close', cleanup)
    b.on('close', cleanup)
    a.pipe(b as unknown as NodeJS.WritableStream)
    ;(b as unknown as NodeJS.ReadableStream).pipe(a)
  }

  private getSessionSafe(sessionId: string): SshSession | null {
    try {
      return getSessionManager().get(sessionId)
    } catch {
      return null
    }
  }

  private broadcast(rule: ForwardRule): void {
    if (this.sender && !this.sender.isDestroyed()) {
      this.sender.send(IpcChannels.forwardUpdate, { ...rule })
    }
  }
}

function routeKey(host: string, port: number): string {
  return `${host}|${port}`
}

let singleton: PortForwardManager | null = null
export function getPortForwardManager(): PortForwardManager {
  if (!singleton) singleton = new PortForwardManager()
  return singleton
}
