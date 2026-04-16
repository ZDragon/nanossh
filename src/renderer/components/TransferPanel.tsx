import { X, ArrowDownToLine, ArrowUpToLine } from 'lucide-react'
import { useFsStore } from '../state/fsStore'
import type { TransferTask } from '@shared/types'

function statusColor(s: TransferTask['status']): string {
  switch (s) {
    case 'done':
      return 'bg-green-500'
    case 'error':
      return 'bg-red-500'
    case 'cancelled':
      return 'bg-yellow-500'
    case 'running':
      return 'bg-accent'
    default:
      return 'bg-muted'
  }
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export function TransferPanel(): JSX.Element | null {
  const transfers = useFsStore((s) => s.transfers)
  const cancel = useFsStore((s) => s.cancelTransfer)
  const clear = useFsStore((s) => s.clearFinishedTransfers)

  const list = Object.values(transfers).sort(
    (a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)
  )
  if (list.length === 0) return null

  return (
    <div className="border-t border-border bg-panel text-xs max-h-52 overflow-y-auto">
      <div className="flex items-center px-3 py-1 border-b border-border text-muted">
        <span>Transfers</span>
        <div className="flex-1" />
        <button className="btn-ghost" onClick={() => clear()} title="Clear finished">
          Clear
        </button>
      </div>
      <ul>
        {list.map((t) => {
          const pct = t.total > 0 ? Math.floor((t.transferred / t.total) * 100) : 0
          const IconComp = t.direction === 'upload' ? ArrowUpToLine : ArrowDownToLine
          return (
            <li key={t.id} className="px-3 py-1.5 border-b border-border/50">
              <div className="flex items-center gap-2">
                <IconComp size={12} className="text-muted shrink-0" />
                <span className="truncate flex-1">
                  {t.direction === 'upload' ? t.localPath : t.remotePath}
                  <span className="text-muted"> → </span>
                  {t.direction === 'upload' ? t.remotePath : t.localPath}
                </span>
                <span className="tabular-nums text-muted">
                  {formatSize(t.transferred)}/{formatSize(t.total)} ({pct}%)
                </span>
                {(t.status === 'running' || t.status === 'pending') && (
                  <button className="btn-ghost" onClick={() => cancel(t.id)} title="Cancel">
                    <X size={12} />
                  </button>
                )}
              </div>
              <div className="mt-1 h-1 rounded bg-[rgb(var(--border))] overflow-hidden">
                <div
                  className={`h-full ${statusColor(t.status)}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {t.error && <div className="text-red-400 mt-0.5">{t.error}</div>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
