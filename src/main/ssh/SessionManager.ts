import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { SshSession } from './SshSession'
import { SessionLog } from './SessionLog'
import { getFullConnection } from '../storage/connections'
import {
  IpcChannels,
  type SessionExitInfo,
  type TerminalSize
} from '../../shared/types'

interface Entry {
  session: SshSession
  log: SessionLog
}

export class SessionManager {
  private readonly entries = new Map<string, Entry>()

  async open(
    connectionId: string,
    sender: WebContents,
    size: TerminalSize
  ): Promise<string> {
    const cfg = await getFullConnection(connectionId)
    if (!cfg) throw new Error(`Connection ${connectionId} not found`)

    const id = randomUUID()
    const log = new SessionLog(id)
    await log.open()

    const session = new SshSession(id, {
      onData: (chunk: string) => {
        if (!sender.isDestroyed()) sender.send(IpcChannels.sessionData(id), chunk)
        log.append(chunk)
      },
      onExit: (info: SessionExitInfo) => {
        if (!sender.isDestroyed()) sender.send(IpcChannels.sessionExit(id), info)
      }
    })

    try {
      await session.connect(cfg, size)
    } catch (e) {
      session.close().catch(() => undefined)
      log.close().catch(() => undefined)
      throw e
    }
    this.entries.set(id, { session, log })
    return id
  }

  async close(id: string): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry) return
    this.entries.delete(id)
    await entry.session.close()
    await entry.log.close()
  }

  async closeAll(): Promise<void> {
    await Promise.all(
      [...this.entries.values()].map(async (e) => {
        await e.session.close().catch(() => undefined)
        await e.log.close().catch(() => undefined)
      })
    )
    this.entries.clear()
  }

  get(id: string): SshSession {
    const e = this.entries.get(id)
    if (!e) throw new Error(`Session ${id} not found`)
    return e.session
  }

  getLog(id: string): SessionLog {
    const e = this.entries.get(id)
    if (!e) throw new Error(`Session ${id} not found`)
    return e.log
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
