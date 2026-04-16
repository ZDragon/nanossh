import { create } from 'zustand'
import type { ConnectionMeta, SaveConnectionInput } from '@shared/types'

interface ConnectionsState {
  connections: ConnectionMeta[]
  loading: boolean
  error?: string
  refresh: () => Promise<void>
  save: (input: SaveConnectionInput) => Promise<string>
  remove: (id: string) => Promise<void>
}

export const useConnectionsStore = create<ConnectionsState>((set, get) => ({
  connections: [],
  loading: false,
  async refresh() {
    set({ loading: true, error: undefined })
    try {
      const list = await window.api.connections.list()
      set({ connections: list, loading: false })
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },
  async save(input) {
    const { id } = await window.api.connections.save(input)
    await get().refresh()
    return id
  },
  async remove(id) {
    await window.api.connections.remove(id)
    await get().refresh()
  }
}))
