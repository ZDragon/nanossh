import { ipcMain, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  IpcChannels,
  type CreateForwardInput,
  type OpenEditorInput,
  type SftpEntry,
  type TerminalSize
} from '../shared/types'
import {
  listConnections,
  removeConnection,
  saveConnection
} from './storage/connections'
import { getSessionManager } from './ssh/SessionManager'
import { getTransferQueue } from './ssh/TransferQueue'
import { getEditorManager } from './editor'
import { getPortForwardManager } from './ssh/PortForwardManager'

async function readLocalDir(dir: string): Promise<SftpEntry[]> {
  const full = resolve(dir)
  const names = await fs.readdir(full)
  const entries = await Promise.all(
    names.map(async (name): Promise<SftpEntry | null> => {
      const p = join(full, name)
      try {
        const st = await fs.lstat(p)
        let type: SftpEntry['type'] = 'other'
        if (st.isFile()) type = 'file'
        else if (st.isDirectory()) type = 'dir'
        else if (st.isSymbolicLink()) type = 'symlink'
        return {
          name,
          path: p,
          size: st.size,
          mtime: Math.floor(st.mtimeMs),
          type,
          mode: st.mode
        }
      } catch {
        return null
      }
    })
  )
  return entries.filter((e): e is SftpEntry => e !== null)
}

export function registerIpcHandlers(): void {
  ipcMain.handle('app:ping', () => 'pong')

  // Connections
  ipcMain.handle(IpcChannels.connectionsList, () => listConnections())
  ipcMain.handle(IpcChannels.connectionsSave, async (_e, input) => {
    const saved = await saveConnection(input)
    return { id: saved.id }
  })
  ipcMain.handle(IpcChannels.connectionsRemove, (_e, id: string) => removeConnection(id))

  // Local FS
  ipcMain.handle(IpcChannels.localHome, () => homedir())
  ipcMain.handle(IpcChannels.localList, (_e, path: string) => readLocalDir(path))
  ipcMain.handle(IpcChannels.localShow, async (_e, path: string) => {
    shell.showItemInFolder(path)
  })

  // Sessions
  ipcMain.handle(
    IpcChannels.sessionOpen,
    async (e, connectionId: string, size?: TerminalSize) => {
      const initial: TerminalSize = size ?? { cols: 80, rows: 24 }
      return getSessionManager().open(connectionId, e.sender, initial)
    }
  )
  ipcMain.handle(IpcChannels.sessionClose, async (_e, id: string) => {
    await getPortForwardManager().stopForSession(id)
    await getEditorManager().closeForSession(id)
    await getSessionManager().close(id)
  })
  ipcMain.handle(IpcChannels.sessionResize, (_e, id: string, size: TerminalSize) => {
    getSessionManager().resize(id, size)
  })
  ipcMain.handle(IpcChannels.sessionWrite, (_e, id: string, data: string) => {
    getSessionManager().write(id, data)
  })

  // SFTP
  ipcMain.handle(IpcChannels.sftpList, async (_e, id: string, path: string) => {
    const s = getSessionManager().get(id)
    const target = path && path.length > 0 ? path : await s.sftpRealpath('.')
    return s.sftpList(target)
  })
  ipcMain.handle(IpcChannels.sftpMkdir, (_e, id: string, path: string) =>
    getSessionManager().get(id).sftpMkdir(path)
  )
  ipcMain.handle(IpcChannels.sftpRm, (_e, id: string, path: string, recursive: boolean) =>
    getSessionManager().get(id).sftpRemove(path, recursive)
  )
  ipcMain.handle(
    IpcChannels.sftpRename,
    (_e, id: string, oldPath: string, newPath: string) =>
      getSessionManager().get(id).sftpRename(oldPath, newPath)
  )
  ipcMain.handle(
    IpcChannels.sftpUpload,
    (e, id: string, localPath: string, remotePath: string) => {
      const s = getSessionManager().get(id)
      return getTransferQueue(e.sender).enqueueUpload(s, localPath, remotePath)
    }
  )
  ipcMain.handle(
    IpcChannels.sftpDownload,
    (e, id: string, remotePath: string, localPath: string) => {
      const s = getSessionManager().get(id)
      return getTransferQueue(e.sender).enqueueDownload(s, remotePath, localPath)
    }
  )
  ipcMain.handle(IpcChannels.sftpCancel, (e, taskId: string) => {
    getTransferQueue(e.sender).cancel(taskId)
  })

  // Editor (download → open in external editor → watch → auto-upload)
  ipcMain.handle(IpcChannels.editorOpen, async (e, input: OpenEditorInput) => {
    const mgr = getEditorManager()
    mgr.attachSender(e.sender)
    return mgr.open(getSessionManager(), input.sessionId, input.remotePath, input.editorCommand)
  })
  ipcMain.handle(IpcChannels.editorClose, (_e, id: string) =>
    getEditorManager().close(id)
  )
  ipcMain.handle(IpcChannels.editorList, () => getEditorManager().list())

  // Port forwarding (-L / -R / -D)
  ipcMain.handle(IpcChannels.forwardStart, async (e, input: CreateForwardInput) => {
    const mgr = getPortForwardManager()
    mgr.attachSender(e.sender)
    return mgr.start(getSessionManager(), input)
  })
  ipcMain.handle(IpcChannels.forwardStop, (_e, id: string) => getPortForwardManager().stop(id))
  ipcMain.handle(IpcChannels.forwardList, () => getPortForwardManager().list())
}
