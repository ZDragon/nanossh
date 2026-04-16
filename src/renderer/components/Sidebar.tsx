import { useEffect, useState } from 'react'
import {
  Plus,
  Pencil,
  Trash2,
  Server,
  Settings,
  Terminal as TerminalIcon,
  Sun,
  Moon
} from 'lucide-react'
import type { ConnectionMeta } from '@shared/types'
import { useConnectionsStore } from '../state/connectionsStore'
import { useThemeStore } from '../state/themeStore'
import { ConnectionDialog } from './ConnectionDialog'
import { SettingsDialog } from './SettingsDialog'

interface Props {
  onConnect: (meta: ConnectionMeta) => void
}

export function Sidebar({ onConnect }: Props): JSX.Element {
  const { connections, loading, error, refresh, save, remove } = useConnectionsStore()
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggle)
  const [editing, setEditing] = useState<ConnectionMeta | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <aside className="h-full border-r border-border bg-panel flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <TerminalIcon size={16} className="text-accent" />
          <span>SSH Client</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button className="btn-ghost" title="Settings" onClick={() => setSettingsOpen(true)}>
            <Settings size={14} />
          </button>
          <button className="btn-ghost" title="Toggle theme" onClick={toggleTheme}>
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <button
            className="btn-ghost"
            title="New connection"
            onClick={() => {
              setEditing(null)
              setDialogOpen(true)
            }}
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <div className="p-3 text-xs text-muted">Loading…</div>}
        {error && <div className="p-3 text-xs text-red-400">{error}</div>}
        {!loading && connections.length === 0 && (
          <div className="p-4 text-xs text-muted leading-relaxed">
            No saved connections yet.
            <br />
            Click <span className="text-accent">+</span> to add one.
          </div>
        )}
        <ul className="py-1">
          {connections.map((c) => (
            <li
              key={c.id}
              className="group px-3 py-2 hover:bg-[rgb(var(--bg))] cursor-pointer flex items-center gap-2"
              onDoubleClick={() => onConnect(c)}
              title="Double-click to connect"
            >
              <Server size={14} className="text-muted shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm truncate">{c.label}</div>
                <div className="text-[11px] text-muted truncate">
                  {c.username}@{c.host}:{c.port}
                </div>
              </div>
              <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
                <button
                  className="btn-ghost"
                  title="Edit"
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditing(c)
                    setDialogOpen(true)
                  }}
                >
                  <Pencil size={13} />
                </button>
                <button
                  className="btn-ghost"
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirm(`Delete "${c.label}"?`)) remove(c.id)
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {dialogOpen && (
        <ConnectionDialog
          initial={editing ?? undefined}
          onClose={() => setDialogOpen(false)}
          onSubmit={async (cfg) => {
            await save(cfg)
          }}
        />
      )}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </aside>
  )
}
