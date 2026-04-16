import { Edit3, Loader2, X, CircleAlert, CircleCheck, CloudUpload } from 'lucide-react'
import type { EditSession } from '@shared/types'
import { useEditorsStore } from '../state/editorsStore'

function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return idx === -1 ? p : p.slice(idx + 1)
}

function timeAgo(ts?: number): string {
  if (!ts) return ''
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ago`
}

function StatusBadge({ s }: { s: EditSession }): JSX.Element {
  switch (s.status) {
    case 'downloading':
      return (
        <span className="inline-flex items-center gap-1 text-muted">
          <Loader2 size={11} className="animate-spin" /> downloading
        </span>
      )
    case 'uploading':
      return (
        <span className="inline-flex items-center gap-1 text-accent">
          <CloudUpload size={11} /> uploading
        </span>
      )
    case 'error':
      return (
        <span className="inline-flex items-center gap-1 text-red-400" title={s.error}>
          <CircleAlert size={11} /> error
        </span>
      )
    case 'open':
      return (
        <span className="inline-flex items-center gap-1 text-green-500">
          <CircleCheck size={11} />
          {s.uploads > 0 ? `saved ${s.uploads}×` : 'watching'}
        </span>
      )
    case 'closed':
      return <span className="text-muted">closed</span>
  }
}

export function EditorPanel(): JSX.Element | null {
  const sessions = useEditorsStore((s) => s.sessions)
  const close = useEditorsStore((s) => s.close)

  const list = Object.values(sessions).sort((a, b) => a.startedAt - b.startedAt)
  if (list.length === 0) return null

  return (
    <div className="border-t border-border bg-panel text-xs max-h-40 overflow-y-auto">
      <div className="flex items-center px-3 py-1 border-b border-border text-muted">
        <Edit3 size={12} className="mr-1" />
        <span>Active edits ({list.length})</span>
      </div>
      <ul>
        {list.map((s) => (
          <li
            key={s.id}
            className="px-3 py-1.5 border-b border-border/50 flex items-center gap-2"
            title={s.remotePath}
          >
            <Edit3 size={12} className="text-muted shrink-0" />
            <span className="truncate flex-1">{basename(s.remotePath)}</span>
            <StatusBadge s={s} />
            {s.lastSavedAt && (
              <span className="text-muted tabular-nums w-20 text-right">
                {timeAgo(s.lastSavedAt)}
              </span>
            )}
            <button className="btn-ghost" title="Stop watching" onClick={() => close(s.id)}>
              <X size={12} />
            </button>
          </li>
        ))}
      </ul>
      {list.some((s) => s.status === 'error') && (
        <div className="px-3 py-1 text-[11px] text-red-400 border-t border-border/50">
          {list.find((s) => s.status === 'error')?.error}
        </div>
      )}
    </div>
  )
}
