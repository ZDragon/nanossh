import type { Config } from 'tailwindcss'

export default {
  content: ['./src/renderer/**/*.{html,ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        panel: 'rgb(var(--panel) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        fg: 'rgb(var(--fg) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)'
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Cascadia Mono"', 'Consolas', 'monospace'],
        sans: ['"Segoe UI"', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
} satisfies Config
