import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import {
  IpcChannels,
  type ConnectionMeta,
  type CreateForwardInput,
  type EditSession,
  type ExportLogOptions,
  type ExportLogResult,
  type ForwardRule,
  type OpenEditorInput,
  type SaveConnectionInput,
  type SaveConnectionResult,
  type SftpEntry,
  type SessionExitInfo,
  type TerminalSize,
  type TransferTask
} from '../shared/types'

type Unsubscribe = () => void

function subscribe<T>(channel: string, cb: (value: T) => void): Unsubscribe {
  const handler = (_e: IpcRendererEvent, value: T): void => cb(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.off(channel, handler)
}

const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('app:ping'),

  connections: {
    list: (): Promise<ConnectionMeta[]> => ipcRenderer.invoke(IpcChannels.connectionsList),
    save: (cfg: SaveConnectionInput): Promise<SaveConnectionResult> =>
      ipcRenderer.invoke(IpcChannels.connectionsSave, cfg),
    remove: (id: string): Promise<void> => ipcRenderer.invoke(IpcChannels.connectionsRemove, id)
  },

  sessions: {
    open: (connectionId: string, size?: TerminalSize): Promise<string> =>
      ipcRenderer.invoke(IpcChannels.sessionOpen, connectionId, size),
    close: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.sessionClose, sessionId),
    resize: (sessionId: string, size: TerminalSize): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.sessionResize, sessionId, size),
    write: (sessionId: string, data: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.sessionWrite, sessionId, data),
    onData: (sessionId: string, cb: (data: string) => void): Unsubscribe =>
      subscribe<string>(IpcChannels.sessionData(sessionId), cb),
    onExit: (sessionId: string, cb: (info: SessionExitInfo) => void): Unsubscribe =>
      subscribe<SessionExitInfo>(IpcChannels.sessionExit(sessionId), cb),
    exportLog: (sessionId: string, opts?: ExportLogOptions): Promise<ExportLogResult> =>
      ipcRenderer.invoke(IpcChannels.sessionExportLog, sessionId, opts ?? {})
  },

  sftp: {
    list: (sessionId: string, remotePath: string): Promise<SftpEntry[]> =>
      ipcRenderer.invoke(IpcChannels.sftpList, sessionId, remotePath),
    mkdir: (sessionId: string, remotePath: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.sftpMkdir, sessionId, remotePath),
    rm: (sessionId: string, remotePath: string, recursive: boolean): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.sftpRm, sessionId, remotePath, recursive),
    rename: (sessionId: string, oldPath: string, newPath: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.sftpRename, sessionId, oldPath, newPath),
    upload: (sessionId: string, localPath: string, remotePath: string): Promise<string> =>
      ipcRenderer.invoke(IpcChannels.sftpUpload, sessionId, localPath, remotePath),
    download: (sessionId: string, remotePath: string, localPath: string): Promise<string> =>
      ipcRenderer.invoke(IpcChannels.sftpDownload, sessionId, remotePath, localPath),
    cancel: (taskId: string): Promise<void> => ipcRenderer.invoke(IpcChannels.sftpCancel, taskId),
    onTransfer: (cb: (task: TransferTask) => void): Unsubscribe =>
      subscribe<TransferTask>(IpcChannels.transferUpdate, cb)
  },

  local: {
    list: (path: string): Promise<SftpEntry[]> => ipcRenderer.invoke(IpcChannels.localList, path),
    home: (): Promise<string> => ipcRenderer.invoke(IpcChannels.localHome),
    show: (path: string): Promise<void> => ipcRenderer.invoke(IpcChannels.localShow, path),
    pathForFile: (file: File): string => webUtils.getPathForFile(file)
  },

  editor: {
    open: (input: OpenEditorInput): Promise<string> =>
      ipcRenderer.invoke(IpcChannels.editorOpen, input),
    close: (id: string): Promise<void> => ipcRenderer.invoke(IpcChannels.editorClose, id),
    list: (): Promise<EditSession[]> => ipcRenderer.invoke(IpcChannels.editorList),
    onUpdate: (cb: (s: EditSession) => void): Unsubscribe =>
      subscribe<EditSession>(IpcChannels.editorUpdate, cb)
  },

  forwards: {
    start: (input: CreateForwardInput): Promise<string> =>
      ipcRenderer.invoke(IpcChannels.forwardStart, input),
    stop: (id: string): Promise<void> => ipcRenderer.invoke(IpcChannels.forwardStop, id),
    list: (): Promise<ForwardRule[]> => ipcRenderer.invoke(IpcChannels.forwardList),
    onUpdate: (cb: (rule: ForwardRule) => void): Unsubscribe =>
      subscribe<ForwardRule>(IpcChannels.forwardUpdate, cb)
  }
} as const

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
