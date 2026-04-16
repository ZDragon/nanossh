import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { IpcChannels, type TransferTask } from '../../shared/types'
import type { SshSession } from './SshSession'

/**
 * Tracks SFTP transfers and broadcasts progress to a WebContents.
 *
 * Current semantics (MVP):
 *   - tasks run independently (no concurrency limit beyond per-session sftp)
 *   - cancel() marks the task as cancelled and does not await the underlying
 *     fastGet/fastPut, so it may continue in the background until ssh2 finishes
 *     the current chunk. The UI will stop getting updates for it.
 */
export class TransferQueue {
  private readonly tasks = new Map<string, TransferTask>()
  private readonly cancelFlags = new Set<string>()

  constructor(private readonly sender: WebContents) {}

  private broadcast(task: TransferTask): void {
    if (!this.sender.isDestroyed()) {
      this.sender.send(IpcChannels.transferUpdate, task)
    }
  }

  private update(id: string, patch: Partial<TransferTask>): TransferTask | null {
    const prev = this.tasks.get(id)
    if (!prev) return null
    const next = { ...prev, ...patch }
    this.tasks.set(id, next)
    this.broadcast(next)
    return next
  }

  enqueueUpload(session: SshSession, localPath: string, remotePath: string): string {
    const id = randomUUID()
    const task: TransferTask = {
      id,
      sessionId: session.id,
      direction: 'upload',
      localPath,
      remotePath,
      total: 0,
      transferred: 0,
      status: 'pending'
    }
    this.tasks.set(id, task)
    this.broadcast(task)
    void this.run(id, () =>
      session.sftpUpload(localPath, remotePath, (transferred, total) => {
        if (this.cancelFlags.has(id)) return
        this.update(id, { transferred, total, status: 'running' })
      })
    )
    return id
  }

  enqueueDownload(session: SshSession, remotePath: string, localPath: string): string {
    const id = randomUUID()
    const task: TransferTask = {
      id,
      sessionId: session.id,
      direction: 'download',
      localPath,
      remotePath,
      total: 0,
      transferred: 0,
      status: 'pending'
    }
    this.tasks.set(id, task)
    this.broadcast(task)
    void this.run(id, () =>
      session.sftpDownload(remotePath, localPath, (transferred, total) => {
        if (this.cancelFlags.has(id)) return
        this.update(id, { transferred, total, status: 'running' })
      })
    )
    return id
  }

  private async run(id: string, fn: () => Promise<void>): Promise<void> {
    this.update(id, { status: 'running', startedAt: Date.now() })
    try {
      await fn()
      if (this.cancelFlags.has(id)) {
        this.update(id, { status: 'cancelled', finishedAt: Date.now() })
      } else {
        this.update(id, { status: 'done', finishedAt: Date.now() })
      }
    } catch (e) {
      if (this.cancelFlags.has(id)) {
        this.update(id, { status: 'cancelled', finishedAt: Date.now() })
      } else {
        this.update(id, { status: 'error', error: String(e), finishedAt: Date.now() })
      }
    } finally {
      this.cancelFlags.delete(id)
    }
  }

  cancel(id: string): void {
    const t = this.tasks.get(id)
    if (!t) return
    if (t.status === 'done' || t.status === 'error' || t.status === 'cancelled') return
    this.cancelFlags.add(id)
    this.update(id, { status: 'cancelled' })
  }
}

let singleton: TransferQueue | null = null
/** Lazily create queue bound to a single WebContents (main window). */
export function getTransferQueue(sender: WebContents): TransferQueue {
  if (!singleton || singleton['sender'] !== sender) {
    singleton = new TransferQueue(sender)
  }
  return singleton
}
