import { create } from 'zustand'
import type { CreateForwardInput, ForwardRule } from '@shared/types'

interface ForwardsState {
  rules: Record<string, ForwardRule>
  start: (input: CreateForwardInput) => Promise<string>
  stop: (id: string) => Promise<void>
  applyUpdate: (rule: ForwardRule) => void
  refresh: () => Promise<void>
}

export const useForwardsStore = create<ForwardsState>((set) => ({
  rules: {},

  async start(input) {
    return window.api.forwards.start(input)
  },

  async stop(id) {
    await window.api.forwards.stop(id)
    set((s) => {
      const { [id]: _, ...rest } = s.rules
      return { rules: rest }
    })
  },

  applyUpdate(rule) {
    set((s) => {
      if (rule.status === 'stopped') {
        const { [rule.id]: _, ...rest } = s.rules
        return { rules: rest }
      }
      return { rules: { ...s.rules, [rule.id]: rule } }
    })
  },

  async refresh() {
    const list = await window.api.forwards.list()
    const map: Record<string, ForwardRule> = {}
    for (const r of list) map[r.id] = r
    set({ rules: map })
  }
}))
