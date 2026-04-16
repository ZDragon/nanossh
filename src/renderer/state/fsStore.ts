import { create } from 'zustand'
import type { SftpEntry, TransferTask } from '@shared/types'

interface PaneState {
  cwd: string
  entries: SftpEntry[]
  loading: boolean
  error?: string
}

interface FsState {
  remoteBySession: Record<string, PaneState>
  local: PaneState
  transfers: Record<string, TransferTask>

  ensureRemote: (sessionId: string) => Promise<void>
  remoteCd: (sessionId: string, path: string) => Promise<void>
  remoteRefresh: (sessionId: string) => Promise<void>
  remoteMkdir: (sessionId: string, name: string) => Promise<void>
  remoteDelete: (sessionId: string, path: string, recursive: boolean) => Promise<void>
  remoteRename: (sessionId: string, oldPath: string, newName: string) => Promise<void>

  localInit: () => Promise<void>
  localCd: (path: string) => Promise<void>
  localRefresh: () => Promise<void>

  upload: (sessionId: string, localPath: string, remoteDir: string) => Promise<void>
  download: (sessionId: string, remotePath: string, localDir: string) => Promise<void>

  addTransfer: (t: TransferTask) => void
  cancelTransfer: (taskId: string) => Promise<void>
  clearFinishedTransfers: () => void

  disposeSession: (sessionId: string) => void
}

const empty: PaneState = { cwd: '', entries: [], loading: false }

function posixJoin(base: string, leaf: string): string {
  if (leaf.startsWith('/')) return leaf
  if (base.endsWith('/')) return base + leaf
  return base + '/' + leaf
}

function posixParent(path: string): string {
  if (path === '/' || path === '') return '/'
  const trimmed = path.replace(/\/+$/, '')
  const idx = trimmed.lastIndexOf('/')
  if (idx <= 0) return '/'
  return trimmed.slice(0, idx)
}

function winJoin(base: string, leaf: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(leaf) || leaf.startsWith('\\\\')) return leaf
  const sep = base.endsWith('\\') || base.endsWith('/') ? '' : '\\'
  return base + sep + leaf
}

function winParent(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  if (idx <= 2) return trimmed.slice(0, 3) // "C:\"
  return trimmed.slice(0, idx)
}

function winBasename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  return idx === -1 ? trimmed : trimmed.slice(idx + 1)
}

export const useFsStore = create<FsState>((set, get) => ({
  remoteBySession: {},
  local: empty,
  transfers: {},

  async ensureRemote(sessionId) {
    const existing = get().remoteBySession[sessionId]
    // Bail if we already have data, are loading, or previously errored.
    // User must hit refresh manually to retry after an error.
    if (existing && (existing.cwd || existing.loading || existing.error)) return
    await get().remoteCd(sessionId, '')
  },

  async remoteCd(sessionId, path) {
    set((s) => ({
      remoteBySession: {
        ...s.remoteBySession,
        [sessionId]: { ...(s.remoteBySession[sessionId] ?? empty), loading: true, error: undefined }
      }
    }))
    try {
      const entries = await window.api.sftp.list(sessionId, path)
      // if path was '' the server resolved HOME; re-query realpath via entry parent if empty list
      let cwd = path
      if (!cwd) {
        cwd = entries[0]?.path.replace(/\/[^/]+$/, '') || '/'
      }
      const sorted = sortEntries(entries)
      set((s) => ({
        remoteBySession: {
          ...s.remoteBySession,
          [sessionId]: { cwd, entries: sorted, loading: false }
        }
      }))
    } catch (e) {
      set((s) => ({
        remoteBySession: {
          ...s.remoteBySession,
          [sessionId]: {
            ...(s.remoteBySession[sessionId] ?? empty),
            loading: false,
            error: String(e)
          }
        }
      }))
    }
  },

  async remoteRefresh(sessionId) {
    const st = get().remoteBySession[sessionId]
    if (st) await get().remoteCd(sessionId, st.cwd)
  },

  async remoteMkdir(sessionId, name) {
    const st = get().remoteBySession[sessionId]
    if (!st) return
    await window.api.sftp.mkdir(sessionId, posixJoin(st.cwd, name))
    await get().remoteRefresh(sessionId)
  },

  async remoteDelete(sessionId, path, recursive) {
    await window.api.sftp.rm(sessionId, path, recursive)
    await get().remoteRefresh(sessionId)
  },

  async remoteRename(sessionId, oldPath, newName) {
    const parent = posixParent(oldPath)
    await window.api.sftp.rename(sessionId, oldPath, posixJoin(parent, newName))
    await get().remoteRefresh(sessionId)
  },

  async localInit() {
    if (get().local.cwd) return
    const home = await window.api.local.home()
    await get().localCd(home)
  },

  async localCd(path) {
    set((s) => ({ local: { ...s.local, loading: true, error: undefined } }))
    try {
      const entries = await window.api.local.list(path)
      set({ local: { cwd: path, entries: sortEntries(entries), loading: false } })
    } catch (e) {
      set((s) => ({ local: { ...s.local, loading: false, error: String(e) } }))
    }
  },

  async localRefresh() {
    const cwd = get().local.cwd
    if (cwd) await get().localCd(cwd)
  },

  async upload(sessionId, localPath, remoteDir) {
    const name = winBasename(localPath)
    const target = remoteDir.endsWith('/') ? remoteDir + name : remoteDir + '/' + name
    await window.api.sftp.upload(sessionId, localPath, target)
  },

  async download(sessionId, remotePath, localDir) {
    const name = remotePath.split('/').pop() || 'file'
    const target = winJoin(localDir, name)
    await window.api.sftp.download(sessionId, remotePath, target)
  },

  addTransfer(t) {
    set((s) => ({ transfers: { ...s.transfers, [t.id]: t } }))
    // auto-refresh target pane on completion
    if (t.status === 'done') {
      if (t.direction === 'upload') get().remoteRefresh(t.sessionId)
      else get().localRefresh()
    }
  },

  async cancelTransfer(taskId) {
    await window.api.sftp.cancel(taskId)
  },

  clearFinishedTransfers() {
    set((s) => {
      const kept: Record<string, TransferTask> = {}
      for (const [id, t] of Object.entries(s.transfers)) {
        if (t.status === 'pending' || t.status === 'running') kept[id] = t
      }
      return { transfers: kept }
    })
  },

  disposeSession(sessionId) {
    set((s) => {
      const { [sessionId]: _, ...rest } = s.remoteBySession
      return { remoteBySession: rest }
    })
  }
}))

export const fsHelpers = {
  posixJoin,
  posixParent,
  winJoin,
  winParent,
  winBasename
}

function sortEntries(entries: SftpEntry[]): SftpEntry[] {
  return [...entries].sort((a, b) => {
    if (a.type === 'dir' && b.type !== 'dir') return -1
    if (b.type === 'dir' && a.type !== 'dir') return 1
    return a.name.localeCompare(b.name)
  })
}
