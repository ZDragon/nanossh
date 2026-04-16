import { create } from 'zustand'
import type { ConnectionMeta } from '@shared/types'

export interface SessionTab {
  id: string
  connectionId: string
  label: string
  host: string
  status: 'connecting' | 'open' | 'error' | 'closed'
  error?: string
}

interface SessionsState {
  tabs: SessionTab[]
  activeId: string | null
  open: (meta: ConnectionMeta) => Promise<void>
  close: (id: string) => Promise<void>
  setActive: (id: string) => void
  markOpen: (id: string) => void
  markClosed: (id: string, reason?: string) => void
  markError: (id: string, err: string) => void
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  tabs: [],
  activeId: null,

  async open(meta) {
    const placeholder: SessionTab = {
      id: `pending-${Math.random().toString(36).slice(2)}`,
      connectionId: meta.id,
      label: meta.label,
      host: `${meta.username}@${meta.host}:${meta.port}`,
      status: 'connecting'
    }
    set((s) => ({ tabs: [...s.tabs, placeholder], activeId: placeholder.id }))

    try {
      const realId = await window.api.sessions.open(meta.id, { cols: 80, rows: 24 })
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === placeholder.id ? { ...t, id: realId, status: 'open' } : t
        ),
        activeId: s.activeId === placeholder.id ? realId : s.activeId
      }))

      window.api.sessions.onExit(realId, (info) => {
        const reason =
          info.reason ??
          (info.signal ? `signal ${info.signal}` : info.code !== null ? `exit ${info.code}` : '')
        get().markClosed(realId, reason)
      })
    } catch (e) {
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === placeholder.id ? { ...t, status: 'error', error: String(e) } : t
        )
      }))
    }
  },

  async close(id) {
    try {
      if (!id.startsWith('pending-')) await window.api.sessions.close(id)
    } catch {
      /* ignore */
    }
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id)
      const activeId =
        s.activeId === id ? (tabs[tabs.length - 1]?.id ?? null) : s.activeId
      return { tabs, activeId }
    })
  },

  setActive(id) {
    set({ activeId: id })
  },
  markOpen(id) {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, status: 'open' } : t)) }))
  },
  markClosed(id, reason) {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, status: 'closed', error: reason } : t
      )
    }))
  },
  markError(id, err) {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, status: 'error', error: err } : t))
    }))
  }
}))
