import { create } from 'zustand'
import type { EditSession } from '@shared/types'

const CMD_KEY = 'ssh-client.editor.command'

interface EditorsState {
  sessions: Record<string, EditSession>
  editorCommand: string
  setEditorCommand: (cmd: string) => void
  openFor: (sessionId: string, remotePath: string) => Promise<void>
  close: (id: string) => Promise<void>
  applyUpdate: (s: EditSession) => void
  refresh: () => Promise<void>
}

export const useEditorsStore = create<EditorsState>((set, get) => ({
  sessions: {},
  editorCommand: localStorage.getItem(CMD_KEY) ?? '',

  setEditorCommand(cmd) {
    localStorage.setItem(CMD_KEY, cmd)
    set({ editorCommand: cmd })
  },

  async openFor(sessionId, remotePath) {
    const editorCommand = get().editorCommand
    try {
      await window.api.editor.open({ sessionId, remotePath, editorCommand })
    } catch (e) {
      alert(`Failed to start editor: ${String(e)}`)
    }
  },

  async close(id) {
    await window.api.editor.close(id)
    set((s) => {
      const { [id]: _, ...rest } = s.sessions
      return { sessions: rest }
    })
  },

  applyUpdate(ses) {
    set((s) => {
      if (ses.status === 'closed') {
        const { [ses.id]: _, ...rest } = s.sessions
        return { sessions: rest }
      }
      return { sessions: { ...s.sessions, [ses.id]: ses } }
    })
  },

  async refresh() {
    const list = await window.api.editor.list()
    const map: Record<string, EditSession> = {}
    for (const s of list) map[s.id] = s
    set({ sessions: map })
  }
}))
