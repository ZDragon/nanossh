import { useEffect, useMemo, useState } from 'react'
import {
  ArrowUp,
  Edit3,
  File as FileIcon,
  Folder,
  FolderPlus,
  HardDrive,
  Link2,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
  Download as DownloadIcon
} from 'lucide-react'
import type { SftpEntry } from '@shared/types'
import { fsHelpers, useFsStore } from '../state/fsStore'
import { useEditorsStore } from '../state/editorsStore'

type Mode = 'remote' | 'local'

interface Props {
  mode: Mode
  sessionId?: string // required when mode === 'remote'
  title?: string
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

function formatTime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  return d.toLocaleString()
}

function TypeIcon({ type }: { type: SftpEntry['type'] }): JSX.Element {
  if (type === 'dir') return <Folder size={14} className="text-accent shrink-0" />
  if (type === 'symlink') return <Link2 size={14} className="text-cyan-400 shrink-0" />
  return <FileIcon size={14} className="text-muted shrink-0" />
}

export function FilePane({ mode, sessionId, title }: Props): JSX.Element {
  const local = useFsStore((s) => s.local)
  const remotePane = useFsStore((s) =>
    sessionId ? s.remoteBySession[sessionId] : undefined
  )
  const state = mode === 'remote' ? remotePane : local

  // Narrow action selectors — actions have stable references in zustand,
  // so these selectors do NOT trigger re-renders when state changes.
  const ensureRemote = useFsStore((s) => s.ensureRemote)
  const localInit = useFsStore((s) => s.localInit)
  const remoteCd = useFsStore((s) => s.remoteCd)
  const localCd = useFsStore((s) => s.localCd)
  const remoteRefresh = useFsStore((s) => s.remoteRefresh)
  const localRefresh = useFsStore((s) => s.localRefresh)
  const remoteMkdir = useFsStore((s) => s.remoteMkdir)
  const remoteDelete = useFsStore((s) => s.remoteDelete)
  const remoteRename = useFsStore((s) => s.remoteRename)
  const upload = useFsStore((s) => s.upload)
  const download = useFsStore((s) => s.download)
  const openEditor = useEditorsStore((s) => s.openFor)

  const [pathInput, setPathInput] = useState('')
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  useEffect(() => {
    if (mode === 'local') localInit()
    else if (sessionId) ensureRemote(sessionId)
  }, [mode, sessionId, ensureRemote, localInit])

  useEffect(() => {
    if (state?.cwd) setPathInput(state.cwd)
  }, [state?.cwd])

  const join = mode === 'remote' ? fsHelpers.posixJoin : fsHelpers.winJoin
  const parent = mode === 'remote' ? fsHelpers.posixParent : fsHelpers.winParent

  function cd(path: string): void {
    if (mode === 'remote' && sessionId) remoteCd(sessionId, path)
    else if (mode === 'local') localCd(path)
  }
  function refresh(): void {
    if (mode === 'remote' && sessionId) remoteRefresh(sessionId)
    else if (mode === 'local') localRefresh()
  }
  function up(): void {
    if (!state?.cwd) return
    cd(parent(state.cwd))
  }

  async function onMkdir(): Promise<void> {
    const name = prompt('New folder name:')
    if (!name) return
    if (mode === 'remote' && sessionId) {
      await remoteMkdir(sessionId, name)
    } else if (mode === 'local') {
      alert('Creating local folders not implemented in this pane.')
    }
  }

  async function onDelete(e: SftpEntry): Promise<void> {
    const recursive = e.type === 'dir'
    const msg = recursive ? `Delete "${e.name}" and all its contents?` : `Delete "${e.name}"?`
    if (!confirm(msg)) return
    if (mode === 'remote' && sessionId) await remoteDelete(sessionId, e.path, recursive)
  }

  async function startRename(e: SftpEntry): Promise<void> {
    setRenameTarget(e.path)
    setRenameValue(e.name)
  }

  async function commitRename(): Promise<void> {
    if (!renameTarget) return
    const target = renameTarget
    const val = renameValue.trim()
    setRenameTarget(null)
    if (!val) return
    if (mode === 'remote' && sessionId) await remoteRename(sessionId, target, val)
  }

  async function onRowAction(entry: SftpEntry): Promise<void> {
    if (entry.type === 'dir') {
      cd(entry.path)
      return
    }
    if (mode === 'remote' && sessionId) {
      // download to local cwd
      const localCwd = useFsStore.getState().local.cwd
      if (!localCwd) return
      await download(sessionId, entry.path, localCwd)
    } else if (mode === 'local') {
      // upload to remote cwd of current remote pane
      if (sessionId) {
        const rp = useFsStore.getState().remoteBySession[sessionId]
        if (rp?.cwd) await upload(sessionId, entry.path, rp.cwd)
      }
    }
  }

  async function onDropFromOs(ev: React.DragEvent): Promise<void> {
    ev.preventDefault()
    if (mode !== 'remote' || !sessionId || !state?.cwd) return
    const files = Array.from(ev.dataTransfer.files)
    for (const f of files) {
      const path = window.api.local.pathForFile(f)
      if (!path) continue
      await upload(sessionId, path, state.cwd)
    }
  }

  function onDragStart(ev: React.DragEvent, entry: SftpEntry): void {
    ev.dataTransfer.setData('application/x-ssh-client', JSON.stringify({ mode, sessionId, path: entry.path }))
    ev.dataTransfer.effectAllowed = 'copy'
  }

  async function onDropInternal(ev: React.DragEvent): Promise<void> {
    const raw = ev.dataTransfer.getData('application/x-ssh-client')
    if (!raw) return onDropFromOs(ev)
    ev.preventDefault()
    try {
      const payload = JSON.parse(raw) as { mode: Mode; sessionId?: string; path: string }
      // remote -> local: download into this pane's cwd
      if (mode === 'local' && payload.mode === 'remote' && payload.sessionId && state?.cwd) {
        await download(payload.sessionId, payload.path, state.cwd)
        return
      }
      // local -> remote: upload to this pane's cwd
      if (mode === 'remote' && payload.mode === 'local' && sessionId && state?.cwd) {
        await upload(sessionId, payload.path, state.cwd)
      }
    } catch {
      /* ignore */
    }
  }

  const rows = useMemo(() => state?.entries ?? [], [state?.entries])

  return (
    <div
      className="h-full flex flex-col bg-panel min-w-0"
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={onDropInternal}
    >
      <div className="flex items-center gap-1 p-1.5 border-b border-border">
        <HardDrive size={14} className="text-muted" />
        <span className="text-xs text-muted px-1">{title ?? (mode === 'remote' ? 'Remote' : 'Local')}</span>
        <div className="flex-1" />
        <button className="btn-ghost" onClick={up} title="Up"><ArrowUp size={14} /></button>
        <button className="btn-ghost" onClick={refresh} title="Refresh"><RefreshCw size={14} /></button>
        {mode === 'remote' && (
          <button className="btn-ghost" onClick={onMkdir} title="New folder">
            <FolderPlus size={14} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-1 px-2 py-1 border-b border-border">
        <input
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') cd(pathInput)
          }}
          className="input flex-1 text-xs"
          spellCheck={false}
        />
      </div>

      {state?.error && (
        <div className="px-3 py-2 text-xs text-red-400 border-b border-border">{state.error}</div>
      )}

      <div className="flex-1 overflow-y-auto text-xs">
        {state?.loading && <div className="p-3 text-muted">Loading…</div>}
        <table className="w-full">
          <tbody>
            {rows.map((e) => (
              <tr
                key={e.path}
                draggable
                onDragStart={(ev) => onDragStart(ev, e)}
                className="hover:bg-[rgb(var(--bg))] cursor-default group"
                onDoubleClick={() => onRowAction(e)}
              >
                <td className="pl-2 py-1 flex items-center gap-1.5">
                  <TypeIcon type={e.type} />
                  {renameTarget === e.path ? (
                    <input
                      className="input flex-1 text-xs h-6 py-0"
                      value={renameValue}
                      autoFocus
                      onChange={(ev) => setRenameValue(ev.target.value)}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter') commitRename()
                        if (ev.key === 'Escape') setRenameTarget(null)
                      }}
                      onBlur={commitRename}
                    />
                  ) : (
                    <span className="truncate flex-1">{e.name}</span>
                  )}
                </td>
                <td className="px-2 text-muted text-right w-[90px]">
                  {e.type === 'dir' ? '' : formatSize(e.size)}
                </td>
                <td className="px-2 text-muted w-[170px]">{formatTime(e.mtime)}</td>
                <td className="pr-1 w-[90px] text-right">
                  <span className="inline-flex gap-0.5 opacity-0 group-hover:opacity-100">
                    {mode === 'remote' && e.type === 'file' && sessionId && (
                      <button
                        className="btn-ghost"
                        title="Edit in external editor"
                        onClick={() => openEditor(sessionId, e.path)}
                      >
                        <Edit3 size={12} />
                      </button>
                    )}
                    {mode === 'remote' && e.type !== 'dir' && (
                      <button className="btn-ghost" title="Download" onClick={() => onRowAction(e)}>
                        <DownloadIcon size={12} />
                      </button>
                    )}
                    {mode === 'local' && e.type !== 'dir' && sessionId && (
                      <button className="btn-ghost" title="Upload" onClick={() => onRowAction(e)}>
                        <Upload size={12} />
                      </button>
                    )}
                    {mode === 'remote' && (
                      <button className="btn-ghost" title="Rename" onClick={() => startRename(e)}>
                        <Pencil size={12} />
                      </button>
                    )}
                    {mode === 'remote' && (
                      <button className="btn-ghost" title="Delete" onClick={() => onDelete(e)}>
                        <Trash2 size={12} />
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!state?.loading && rows.length === 0 && (
          <div className="p-3 text-muted">Empty directory</div>
        )}
      </div>
    </div>
  )
}
