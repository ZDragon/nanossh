import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { SshSession } from './SshSession'
import { getFullConnection } from '../storage/connections'
import {
  IpcChannels,
  type SessionExitInfo,
  type TerminalSize
} from '../../shared/types'

export class SessionManager {
  private readonly sessions = new Map<string, SshSession>()

  async open(
    connectionId: string,
    sender: WebContents,
    size: TerminalSize
  ): Promise<string> {
    const cfg = await getFullConnection(connectionId)
    if (!cfg) throw new Error(`Connection ${connectionId} not found`)

    const id = randomUUID()
    const session = new SshSession(id, {
      onData: (chunk: string) => {
        if (!sender.isDestroyed()) sender.send(IpcChannels.sessionData(id), chunk)
      },
      onExit: (info: SessionExitInfo) => {
        if (!sender.isDestroyed()) sender.send(IpcChannels.sessionExit(id), info)
      }
    })

    try {
      await session.connect(cfg, size)
    } catch (e) {
      session.close().catch(() => undefined)
      throw e
    }
    this.sessions.set(id, session)
    return id
  }

  async close(id: string): Promise<void> {
    const s = this.sessions.get(id)
    if (!s) return
    this.sessions.delete(id)
    await s.close()
  }

  async closeAll(): Promise<void> {
    await Promise.all(
      [...this.sessions.values()].map((s) => s.close().catch(() => undefined))
    )
    this.sessions.clear()
  }

  get(id: string): SshSession {
    const s = this.sessions.get(id)
    if (!s) throw new Error(`Session ${id} not found`)
    return s
  }

  resize(id: string, size: TerminalSize): void {
    this.get(id).resize(size)
  }

  write(id: string, data: string): void {
    this.get(id).write(data)
  }
}

let manager: SessionManager | null = null
export function getSessionManager(): SessionManager {
  if (!manager) manager = new SessionManager()
  return manager
}
