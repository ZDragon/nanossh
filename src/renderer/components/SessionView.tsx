import { useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft } from 'lucide-react'
import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import { useSessionsStore } from '../state/sessionsStore'
import { useFsStore } from '../state/fsStore'
import { useEditorsStore } from '../state/editorsStore'
import { useForwardsStore } from '../state/forwardsStore'
import { Tabs } from './Tabs'
import { TerminalPane } from './Terminal'
import { FilePane } from './FilePane'
import { TransferPanel } from './TransferPanel'
import { EditorPanel } from './EditorPanel'
import { ForwardsDialog } from './ForwardsDialog'

export function SessionView(): JSX.Element {
  const tabs = useSessionsStore((s) => s.tabs)
  const activeId = useSessionsStore((s) => s.activeId)
  const setActive = useSessionsStore((s) => s.setActive)
  const close = useSessionsStore((s) => s.close)
  const disposeSession = useFsStore((s) => s.disposeSession)

  const [forwardsOpen, setForwardsOpen] = useState(false)

  // Subscribe to transfer / editor / forwards streams once
  useEffect(() => {
    const unsubTransfer = window.api.sftp.onTransfer((t) =>
      useFsStore.getState().addTransfer(t)
    )
    const unsubEditor = window.api.editor.onUpdate((s) =>
      useEditorsStore.getState().applyUpdate(s)
    )
    const unsubForward = window.api.forwards.onUpdate((r) =>
      useForwardsStore.getState().applyUpdate(r)
    )
    // Reconcile after hot-reload
    useEditorsStore.getState().refresh().catch(() => undefined)
    useForwardsStore.getState().refresh().catch(() => undefined)
    return () => {
      unsubTransfer()
      unsubEditor()
      unsubForward()
    }
  }, [])

  const forwardsCount = useForwardsStore((s) =>
    Object.values(s.rules).filter((r) => r.sessionId === activeId).length
  )

  // When a tab is closed, wipe its fs state
  useEffect(() => {
    const currentIds = new Set(tabs.map((t) => t.id))
    const remote = useFsStore.getState().remoteBySession
    for (const id of Object.keys(remote)) {
      if (!currentIds.has(id)) disposeSession(id)
    }
  }, [tabs, disposeSession])

  if (tabs.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted">
        <div className="text-center">
          <div className="text-lg">No session open</div>
          <div className="text-xs mt-1">
            Double-click a saved connection in the sidebar to connect.
          </div>
        </div>
      </div>
    )
  }

  const activeTab = tabs.find((t) => t.id === activeId)

  return (
    <div className="h-full flex flex-col min-w-0">
      <Tabs
        tabs={tabs}
        activeId={activeId}
        onActivate={setActive}
        onClose={close}
        rightSlot={
          activeTab?.status === 'open' ? (
            <button
              className="px-3 py-2 text-xs text-muted hover:text-fg hover:bg-[rgb(var(--bg))] flex items-center gap-1.5"
              title="Port forwards for this session"
              onClick={() => setForwardsOpen(true)}
            >
              <ArrowRightLeft size={13} />
              Forwards
              {forwardsCount > 0 && (
                <span className="bg-accent/25 text-accent rounded px-1.5 py-0.5 text-[10px] tabular-nums">
                  {forwardsCount}
                </span>
              )}
            </button>
          ) : undefined
        }
      />
      {forwardsOpen && activeId && activeTab?.status === 'open' && (
        <ForwardsDialog sessionId={activeId} onClose={() => setForwardsOpen(false)} />
      )}
      <div className="flex-1 min-h-0 relative">
        {tabs.map((t) => {
          if (t.id !== activeId) {
            // Keep terminals alive when hidden; other statuses render nothing when inactive
            if (t.status === 'open') {
              return (
                <div key={t.id} className="absolute inset-0" style={{ display: 'none' }}>
                  <TerminalPane sessionId={t.id} active={false} />
                </div>
              )
            }
            return null
          }
          if (t.status === 'connecting' || t.status === 'error' || t.status === 'closed') {
            return (
              <div
                key={t.id}
                className="absolute inset-0 flex items-center justify-center text-muted"
              >
                <div className="text-center">
                  <div className="text-sm">{statusLine(t.status)}</div>
                  {t.error && <div className="text-xs mt-1 text-red-400">{t.error}</div>}
                </div>
              </div>
            )
          }
          return (
            <div key={t.id} className="absolute inset-0">
              <Allotment vertical defaultSizes={[2, 1]}>
                <Allotment.Pane minSize={120}>
                  <TerminalPane sessionId={t.id} active={true} />
                </Allotment.Pane>
                <Allotment.Pane minSize={160}>
                  <div className="h-full flex flex-col">
                    <div className="flex-1 min-h-0">
                      <Allotment defaultSizes={[1, 1]}>
                        <Allotment.Pane minSize={200}>
                          <FilePane mode="local" sessionId={t.id} title="Local" />
                        </Allotment.Pane>
                        <Allotment.Pane minSize={200}>
                          <FilePane mode="remote" sessionId={t.id} title="Remote" />
                        </Allotment.Pane>
                      </Allotment>
                    </div>
                    <EditorPanel />
                    <TransferPanel />
                  </div>
                </Allotment.Pane>
              </Allotment>
            </div>
          )
        })}
        {!activeTab && (
          <div className="absolute inset-0 flex items-center justify-center text-muted text-sm">
            Select a tab
          </div>
        )}
      </div>
    </div>
  )
}

function statusLine(s: 'connecting' | 'error' | 'closed'): string {
  if (s === 'connecting') return 'Connecting…'
  if (s === 'error') return 'Connection failed'
  return 'Session closed'
}
