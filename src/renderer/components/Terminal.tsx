import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Terminal as Xterm, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { useThemeStore } from '../state/themeStore'

interface Props {
  sessionId: string
  active: boolean
}

const darkTheme: ITheme = {
  background: '#0f1115',
  foreground: '#e6e8ee',
  cursor: '#58a6ff',
  cursorAccent: '#0f1115',
  selectionBackground: '#2a3a55',
  black: '#1e1e1e',
  red: '#f07178',
  green: '#c3e88d',
  yellow: '#ffcb6b',
  blue: '#82aaff',
  magenta: '#c792ea',
  cyan: '#89ddff',
  white: '#d0d0d0',
  brightBlack: '#5c6370',
  brightRed: '#ff8b92',
  brightGreen: '#ddffa7',
  brightYellow: '#ffe585',
  brightBlue: '#9cc4ff',
  brightMagenta: '#e1acff',
  brightCyan: '#a3f7ff',
  brightWhite: '#ffffff'
}

const lightTheme: ITheme = {
  background: '#fafafc',
  foreground: '#181c24',
  cursor: '#1d63c6',
  cursorAccent: '#fafafc',
  selectionBackground: '#c9dcf7',
  black: '#282c34',
  red: '#c7243a',
  green: '#3d8b3d',
  yellow: '#b58900',
  blue: '#1d63c6',
  magenta: '#8250df',
  cyan: '#007a96',
  white: '#3d3d3d',
  brightBlack: '#5c6370',
  brightRed: '#d7324d',
  brightGreen: '#4ba04b',
  brightYellow: '#cd9b00',
  brightBlue: '#2b7de9',
  brightMagenta: '#9b4dfa',
  brightCyan: '#00a8c6',
  brightWhite: '#1a1a1a'
}

const MIN_FONT = 9
const MAX_FONT = 24

export function TerminalPane({ sessionId, active }: Props): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Xterm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const theme = useThemeStore((s) => s.theme)
  const [fontSize, setFontSize] = useState(13)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // Create terminal
  useEffect(() => {
    if (!rootRef.current) return
    if (sessionId.startsWith('pending-')) return

    const term = new Xterm({
      theme: theme === 'dark' ? darkTheme : lightTheme,
      fontFamily: '"JetBrains Mono", "Cascadia Mono", Consolas, monospace',
      fontSize,
      cursorBlink: true,
      scrollback: 10_000,
      allowProposedApi: true
    })
    const fit = new FitAddon()
    const search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.loadAddon(search)
    term.open(rootRef.current)

    try {
      fit.fit()
    } catch {
      /* hidden container */
    }

    const unsubData = window.api.sessions.onData(sessionId, (data) => term.write(data))
    const onDataDisp = term.onData((d) => {
      window.api.sessions.write(sessionId, d).catch(() => undefined)
    })

    term.attachCustomKeyEventHandler((e) => {
      // Ctrl+Shift+C copy
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && e.key === 'C') {
        const sel = term.getSelection()
        if (sel) navigator.clipboard.writeText(sel).catch(() => undefined)
        return false
      }
      // Ctrl+Shift+V paste
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && e.key === 'V') {
        navigator.clipboard
          .readText()
          .then((txt) => term.paste(txt))
          .catch(() => undefined)
        return false
      }
      // Ctrl+F open search
      if (e.type === 'keydown' && e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
        setSearchOpen(true)
        return false
      }
      // Ctrl+= / Ctrl+- font size
      if (e.type === 'keydown' && e.ctrlKey && (e.key === '=' || e.key === '+')) {
        setFontSize((s) => Math.min(MAX_FONT, s + 1))
        return false
      }
      if (e.type === 'keydown' && e.ctrlKey && e.key === '-') {
        setFontSize((s) => Math.max(MIN_FONT, s - 1))
        return false
      }
      if (e.type === 'keydown' && e.ctrlKey && e.key === '0') {
        setFontSize(13)
        return false
      }
      // Esc closes search panel (but only if open)
      if (e.type === 'keydown' && e.key === 'Escape') {
        // Let terminal handle if search isn't open
      }
      return true
    })

    const sendResize = (): void => {
      try {
        fit.fit()
      } catch {
        return
      }
      window.api.sessions
        .resize(sessionId, { cols: term.cols, rows: term.rows })
        .catch(() => undefined)
    }

    const ro = new ResizeObserver(() => sendResize())
    ro.observe(rootRef.current)
    const raf = requestAnimationFrame(sendResize)

    termRef.current = term
    fitRef.current = fit
    searchRef.current = search

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      unsubData()
      onDataDisp.dispose()
      term.dispose()
      termRef.current = null
      fitRef.current = null
      searchRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // Theme & font updates
  useEffect(() => {
    const t = termRef.current
    if (!t) return
    t.options.theme = theme === 'dark' ? darkTheme : lightTheme
  }, [theme])

  useEffect(() => {
    const t = termRef.current
    if (!t) return
    t.options.fontSize = fontSize
    try {
      fitRef.current?.fit()
      window.api.sessions
        .resize(sessionId, { cols: t.cols, rows: t.rows })
        .catch(() => undefined)
    } catch {
      /* noop */
    }
  }, [fontSize, sessionId])

  // Active re-fit / focus
  useEffect(() => {
    if (!active) return
    const raf = requestAnimationFrame(() => {
      try {
        fitRef.current?.fit()
        const t = termRef.current
        if (t)
          window.api.sessions
            .resize(sessionId, { cols: t.cols, rows: t.rows })
            .catch(() => undefined)
        t?.focus()
      } catch {
        /* noop */
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [active, sessionId])

  function findNext(direction: 'next' | 'prev', q: string): void {
    const s = searchRef.current
    if (!s || !q) return
    if (direction === 'next') s.findNext(q)
    else s.findPrevious(q)
  }

  return (
    <div className="relative h-full w-full" style={{ display: active ? 'block' : 'none' }}>
      <div ref={rootRef} className="h-full w-full bg-[rgb(var(--bg))] p-1" />
      {searchOpen && (
        <div className="absolute top-2 right-4 z-10 bg-panel border border-border rounded px-2 py-1 flex items-center gap-1 shadow-lg">
          <Search size={12} className="text-muted" />
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') findNext(e.shiftKey ? 'prev' : 'next', searchQuery)
              if (e.key === 'Escape') setSearchOpen(false)
            }}
            className="input h-6 text-xs"
            placeholder="Search in terminal…"
          />
          <button className="btn-ghost" onClick={() => setSearchOpen(false)}>
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  )
}
