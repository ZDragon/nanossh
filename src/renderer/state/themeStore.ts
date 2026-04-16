import { create } from 'zustand'

type Theme = 'dark' | 'light'
const STORAGE_KEY = 'ssh-client.theme'

function apply(t: Theme): void {
  document.documentElement.setAttribute('data-theme', t)
}

function read(): Theme {
  const v = localStorage.getItem(STORAGE_KEY)
  return v === 'light' ? 'light' : 'dark'
}

interface ThemeState {
  theme: Theme
  toggle: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const initial = read()
  apply(initial)
  return {
    theme: initial,
    toggle() {
      const next: Theme = get().theme === 'dark' ? 'light' : 'dark'
      localStorage.setItem(STORAGE_KEY, next)
      apply(next)
      set({ theme: next })
    }
  }
})
