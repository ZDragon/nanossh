import { X, Loader2, CircleAlert, PowerOff } from 'lucide-react'
import type { SessionTab } from '../state/sessionsStore'

interface Props {
  tabs: SessionTab[]
  activeId: string | null
  onActivate: (id: string) => void
  onClose: (id: string) => void
  rightSlot?: React.ReactNode
}

export function Tabs({
  tabs,
  activeId,
  onActivate,
  onClose,
  rightSlot
}: Props): JSX.Element | null {
  if (tabs.length === 0) return null

  return (
    <div className="flex border-b border-border bg-panel">
      <div className="flex flex-1 min-w-0 overflow-x-auto">
        {tabs.map((t) => {
        const isActive = t.id === activeId
        return (
          <div
            key={t.id}
            onClick={() => onActivate(t.id)}
            title={t.error ? `${t.host} — ${t.error}` : t.host}
            className={`
              flex items-center gap-2 pl-3 pr-2 py-2 text-xs cursor-pointer
              border-r border-border select-none shrink-0 max-w-[220px]
              ${isActive ? 'bg-bg text-fg' : 'text-muted hover:text-fg'}
            `}
          >
            <StatusIcon status={t.status} />
            <span className="truncate">{t.label}</span>
            <button
              className="btn-ghost"
              onClick={(e) => {
                e.stopPropagation()
                onClose(t.id)
              }}
              title="Close"
            >
              <X size={12} />
            </button>
          </div>
        )
      })}
      </div>
      {rightSlot && (
        <div className="flex items-center border-l border-border shrink-0">{rightSlot}</div>
      )}
    </div>
  )
}

function StatusIcon({ status }: { status: SessionTab['status'] }): JSX.Element {
  switch (status) {
    case 'connecting':
      return <Loader2 size={12} className="animate-spin text-muted shrink-0" />
    case 'open':
      return <span className="inline-block w-2 h-2 rounded-full bg-green-500 shrink-0" />
    case 'error':
      return <CircleAlert size={12} className="text-red-400 shrink-0" />
    case 'closed':
      return <PowerOff size={12} className="text-muted shrink-0" />
  }
}
