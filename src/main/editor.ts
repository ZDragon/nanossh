import { app, shell, type WebContents } from 'electron'
import { spawn } from 'node:child_process'
import { promises as fs, watchFile, unwatchFile } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, posix } from 'node:path'
import { IpcChannels, type EditSession } from '../shared/types'
import type { SessionManager } from './ssh/SessionManager'

interface EditState extends EditSession {
  lastKnownMtimeMs: number
  uploading: boolean
  pendingUpload: boolean
}

/**
 * Edit-in-place: download a remote file to a private temp dir, open it in
 * an editor, watch the local copy for saves, upload changes back.
 */
export class EditorManager {
  private readonly sessions = new Map<string, EditState>()
  private sender: WebContents | null = null

  attachSender(s: WebContents): void {
    this.sender = s
  }

  list(): EditSession[] {
    return [...this.sessions.values()].map(toPublic)
  }

  async open(
    sshMgr: SessionManager,
    sessionId: string,
    remotePath: string,
    editorCommand?: string
  ): Promise<string> {
    const id = randomUUID()
    const tmpDir = join(app.getPath('temp'), 'ssh-client-edit', id)
    await fs.mkdir(tmpDir, { recursive: true })
    const fileName = posix.basename(remotePath) || 'file'
    const localPath = join(tmpDir, fileName)

    const state: EditState = {
      id,
      sessionId,
      remotePath,
      localPath,
      status: 'downloading',
      uploads: 0,
      startedAt: Date.now(),
      lastKnownMtimeMs: 0,
      uploading: false,
      pendingUpload: false
    }
    this.sessions.set(id, state)
    this.broadcast(state)

    const sshSession = sshMgr.get(sessionId)

    try {
      await sshSession.sftpDownload(remotePath, localPath, () => undefined)
    } catch (e) {
      state.status = 'error'
      state.error = `Download failed: ${String(e)}`
      this.broadcast(state)
      return id
    }

    try {
      const st = await fs.stat(localPath)
      state.lastKnownMtimeMs = st.mtimeMs
    } catch {
      /* ignore */
    }

    // Start watching BEFORE opening the editor so we don't miss the first save
    watchFile(localPath, { interval: 1000 }, (curr, prev) => {
      // Ignore removals (size 0 + mtime 0)
      if (curr.mtimeMs === 0 && prev.mtimeMs !== 0) return
      if (curr.mtimeMs <= state.lastKnownMtimeMs) return
      state.lastKnownMtimeMs = curr.mtimeMs
      void this.uploadBack(state, sshMgr)
    })

    // Launch editor
    try {
      if (editorCommand && editorCommand.trim().length > 0) {
        const parts = parseCommand(editorCommand, localPath)
        const [cmd, ...args] = parts
        const child = spawn(cmd, args, {
          detached: true,
          stdio: 'ignore',
          windowsHide: false
        })
        child.on('error', (err) => {
          console.error('[editor] failed to launch custom editor:', err)
          shell.openPath(localPath).catch(() => undefined)
        })
        child.unref()
      } else {
        const errMsg = await shell.openPath(localPath)
        if (errMsg) throw new Error(errMsg)
      }
    } catch (e) {
      state.status = 'error'
      state.error = `Failed to launch editor: ${String(e)}`
      this.broadcast(state)
      unwatchFile(localPath)
      return id
    }

    state.status = 'open'
    this.broadcast(state)
    return id
  }

  private async uploadBack(state: EditState, sshMgr: SessionManager): Promise<void> {
    if (state.status === 'closed' || state.status === 'error') return

    if (state.uploading) {
      // coalesce into one follow-up upload
      state.pendingUpload = true
      return
    }

    state.uploading = true
    state.status = 'uploading'
    this.broadcast(state)

    try {
      const sshSession = sshMgr.get(state.sessionId)
      await sshSession.sftpUpload(state.localPath, state.remotePath, () => undefined)
      state.uploads += 1
      state.lastSavedAt = Date.now()
      state.status = 'open'
      state.error = undefined
      this.broadcast(state)
    } catch (e) {
      state.status = 'error'
      state.error = `Upload failed: ${String(e)}`
      this.broadcast(state)
    } finally {
      state.uploading = false
      if (state.pendingUpload) {
        state.pendingUpload = false
        void this.uploadBack(state, sshMgr)
      }
    }
  }

  async close(id: string): Promise<void> {
    const state = this.sessions.get(id)
    if (!state) return
    try {
      unwatchFile(state.localPath)
    } catch {
      /* ignore */
    }
    try {
      await fs.rm(dirname(state.localPath), { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    state.status = 'closed'
    this.broadcast(state)
    this.sessions.delete(id)
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id)))
  }

  /** Close edits belonging to the given ssh session (when the tab is closed). */
  async closeForSession(sessionId: string): Promise<void> {
    const ids = [...this.sessions.values()]
      .filter((s) => s.sessionId === sessionId)
      .map((s) => s.id)
    await Promise.all(ids.map((id) => this.close(id)))
  }

  private broadcast(state: EditState): void {
    if (this.sender && !this.sender.isDestroyed()) {
      this.sender.send(IpcChannels.editorUpdate, toPublic(state))
    }
  }
}

function toPublic(state: EditState): EditSession {
  const { lastKnownMtimeMs: _a, uploading: _b, pendingUpload: _c, ...pub } = state
  return pub
}

/**
 * Split a command line, respecting "quoted tokens". If any token contains the
 * literal "{file}", substitute it; otherwise append the path as the last arg.
 * Examples:
 *   `code --wait {file}`
 *   `"C:\\Program Files\\Notepad++\\notepad++.exe"`
 *   `notepad`
 */
function parseCommand(cmd: string, filePath: string): string[] {
  const raw = cmd.match(/"[^"]*"|\S+/g) ?? []
  const tokens = raw.map((t) => (t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t))
  if (tokens.length === 0) return [filePath]
  const hasToken = tokens.some((t) => t.includes('{file}'))
  if (hasToken) return tokens.map((t) => t.replace('{file}', filePath))
  return [...tokens, filePath]
}

let singleton: EditorManager | null = null
export function getEditorManager(): EditorManager {
  if (!singleton) singleton = new EditorManager()
  return singleton
}
